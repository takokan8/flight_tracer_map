import { reactive, watch, type Ref } from "vue";
import type { FlightBasic, WatchTrackEntry } from "../types/flight";
import { useFlightApi } from "./useFlightApi";

const STORAGE_KEY = "flightWatchTracking";
const INDEX_COUNTER_KEY = "flightWatchTrackingIndexCounter";

// 合意仕様: 時間・空間の二軸エクスポネンシャルバックオフ
// ステップ0(即座)〜3は直近位置を中心にした半径検索、ステップ4で全世界検索に切り替え。
// ステップ5以降(このテーブルの範囲外)は通常監視と同じ5分間隔・全世界検索に合流する。
export const BACKOFF_STEPS: { delayMs: number; radiusKm: number | null }[] = [
  { delayMs: 0, radiusKm: 50 }, // step0: 即座, 50km
  { delayMs: 30_000, radiusKm: 100 }, // step1: 30秒後, 100km
  { delayMs: 60_000, radiusKm: 200 }, // step2: 1分後, 200km
  { delayMs: 120_000, radiusKm: 400 }, // step3: 2分後, 400km
  { delayMs: 240_000, radiusKm: null }, // step4: 4分後, 全世界
];

const NORMAL_INTERVAL_MS = 5 * 60 * 1000; // 通常監視間隔(5分)。バックオフの合流先でもある
const LOST_TICK_INTERVAL_MS = 2000; // 消失中リストの「そろそろ再照会か」チェック間隔
const QUEUE_INTERVAL_MIN_MS = 1000; // キュー内リクエスト間の最小インターバル
const QUEUE_INTERVAL_MAX_MS = 5000; // キュー内リクエスト間の最大インターバル

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomQueueInterval(): number {
  return QUEUE_INTERVAL_MIN_MS + Math.random() * (QUEUE_INTERVAL_MAX_MS - QUEUE_INTERVAL_MIN_MS);
}

function loadState(): Record<string, WatchTrackEntry> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function loadIndexCounter(): number {
  const raw = localStorage.getItem(INDEX_COUNTER_KEY);
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isNaN(n) ? 0 : n;
}

export function useWatchlistMonitor(watchList: Ref<string[]>) {
  const { searchByRegistration } = useFlightApi();

  const tracking = reactive<Record<string, WatchTrackEntry>>(loadState());
  let indexCounter = loadIndexCounter();

  let normalTimer: ReturnType<typeof setInterval> | null = null;
  let lostTicker: ReturnType<typeof setInterval> | null = null;
  let normalQueueRunning = false;
  let lostQueueRunning = false;

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tracking));
    localStorage.setItem(INDEX_COUNTER_KEY, String(indexCounter));
  }

  function ensureEntry(registration: string): WatchTrackEntry {
    if (!tracking[registration]) {
      indexCounter += 1;
      tracking[registration] = {
        index: indexCounter,
        status: "normal",
        lastSeenAt: null,
        lastLat: null,
        lastLng: null,
        snapshot: null,
        backoffStep: 0,
        nextCheckAt: null,
      };
      persist();
    }
    return tracking[registration];
  }

  function removeEntry(registration: string) {
    delete tracking[registration];
    persist();
  }

  /** 1機体を照会し、結果に応じて追跡状態を更新する。見つかったかどうかを返す */
  async function pollOnce(
    registration: string,
    area: { lat: number; lng: number; radiusKm: number } | null
  ): Promise<boolean> {
    const entry = ensureEntry(registration);
    let flight: FlightBasic | null = null;
    try {
      flight = await searchByRegistration(registration, area);
    } catch (e) {
      console.warn(`[watchlist監視] ${registration} の照会に失敗:`, e);
      flight = null;
    }

    if (flight) {
      entry.status = "normal";
      entry.lastSeenAt = Date.now();
      entry.lastLat = flight.lat;
      entry.lastLng = flight.lng;
      entry.snapshot = flight;
      entry.backoffStep = 0;
      entry.nextCheckAt = null;
      persist();
      return true;
    }

    if (entry.status === "normal") {
      // 通常監視中に空振り → その瞬間に「消失」確定。直前のデータはロックされたまま
      // (snapshot/lastLat/lastLngは上書きしない)、即座にステップ0の再捜索を予約する
      entry.status = "lost";
      entry.backoffStep = 0;
      entry.nextCheckAt = Date.now() + BACKOFF_STEPS[0].delayMs;
      persist();
    }
    // status === "lost" の場合はcheckLostQueue側でバックオフを進めるので、ここでは何もしない
    return false;
  }

  /** 通常監視キュー: status==="normal"の機体を5分ごとに順次(キュー)照会する */
  async function runNormalQueueOnce() {
    if (normalQueueRunning) return;
    normalQueueRunning = true;
    try {
      const targets = watchList.value.filter((reg) => {
        const entry = tracking[reg];
        return !entry || entry.status === "normal";
      });
      for (const reg of targets) {
        await pollOnce(reg, null); // 通常監視は常に全世界検索
        await sleep(randomQueueInterval());
      }
    } finally {
      normalQueueRunning = false;
    }
  }

  /** 消失中キュー: nextCheckAtが到来した機体を順次(キュー)再捜索する */
  async function checkLostQueue() {
    if (lostQueueRunning) return;
    const now = Date.now();
    const due = watchList.value.filter((reg) => {
      const entry = tracking[reg];
      return entry && entry.status === "lost" && entry.nextCheckAt !== null && entry.nextCheckAt <= now;
    });
    if (due.length === 0) return;

    lostQueueRunning = true;
    try {
      for (const reg of due) {
        const entry = tracking[reg];
        if (!entry || entry.status !== "lost") continue;

        const stepIndex = Math.min(entry.backoffStep, BACKOFF_STEPS.length - 1);
        const step = BACKOFF_STEPS[stepIndex];
        const area =
          step.radiusKm !== null && entry.lastLat !== null && entry.lastLng !== null
            ? { lat: entry.lastLat, lng: entry.lastLng, radiusKm: step.radiusKm }
            : null; // 半径未定義 or 直近位置が無い(未発見のまま消失)場合は全世界検索

        const found = await pollOnce(reg, area);

        if (!found) {
          const nextStepIndex = entry.backoffStep + 1;
          if (nextStepIndex >= BACKOFF_STEPS.length) {
            // ステップ4を超えたら通常監視と同じ5分間隔に合流(ステータスはlostのまま、データはロック継続)
            entry.backoffStep = BACKOFF_STEPS.length;
            entry.nextCheckAt = Date.now() + NORMAL_INTERVAL_MS;
          } else {
            entry.backoffStep = nextStepIndex;
            entry.nextCheckAt = Date.now() + BACKOFF_STEPS[nextStepIndex].delayMs;
          }
          persist();
        }

        await sleep(randomQueueInterval());
      }
    } finally {
      lostQueueRunning = false;
    }
  }

  function start() {
    // 起動直後は5分待たず、少し間を置いて最初の一巡を行う(初回表示を早めるため)
    setTimeout(runNormalQueueOnce, 3000);
    normalTimer = setInterval(runNormalQueueOnce, NORMAL_INTERVAL_MS);
    lostTicker = setInterval(checkLostQueue, LOST_TICK_INTERVAL_MS);
  }

  function stop() {
    if (normalTimer) clearInterval(normalTimer);
    if (lostTicker) clearInterval(lostTicker);
    normalTimer = null;
    lostTicker = null;
  }

  // ウォッチリストの増減に追従する:
  // - 削除された機体は追跡データごと削除
  // - 追加された機体は5分周期のキューを待たず、即座に1回だけ単独で照会して
  //   位置情報を早期に埋める(通常監視キューとは独立、単発リクエストなので
  //   Cloudflare負荷への影響は軽微)
  watch(
    () => watchList.value.slice(),
    (newList, oldList) => {
      const prev = oldList || [];
      const removed = prev.filter((r) => !newList.includes(r));
      removed.forEach(removeEntry);

      const added = newList.filter((r) => !prev.includes(r));
      added.forEach((reg) => {
        pollOnce(reg, null).catch((e) => console.warn(`[watchlist監視] ${reg} の初回即時照会に失敗:`, e));
      });
    }
  );

  return { tracking, start, stop };
}