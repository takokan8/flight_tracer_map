import { reactive, ref } from "vue";
import type { FlightBasic } from "../types/flight";

const STORAGE_KEY = "flightWatchList";

function loadWatchList(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function notify(title: string, body: string) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body });
  }
  console.log(`[通知] ${title}: ${body}`);
}

export function useWatchlist() {
  const watchList = ref<string[]>(loadWatchList());
  const watchStatus = reactive<Record<string, boolean>>({});

  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(watchList.value));
  }

  function addToWatchlist(rawValue: string) {
    const value = rawValue.trim().toUpperCase();
    if (!value || watchList.value.includes(value)) return;
    watchList.value.push(value);
    watchStatus[value] = false;
    persist();
  }

  function removeFromWatchlist(value: string) {
    watchList.value = watchList.value.filter((v) => v !== value);
    delete watchStatus[value];
    persist();
  }

  /** 現在のフライト一覧と照合し、監視対象の出現/消失を検知して通知する */
  function checkWatchList(flights: FlightBasic[]) {
    if (watchList.value.length === 0) return;
    const detectedNow = new Set<string>();
    flights.forEach((f) => {
      const callsign = (f.callsign || "").toUpperCase();
      const registration = (f.registration || "").toUpperCase();
      watchList.value.forEach((w) => {
        if (callsign === w || registration === w) detectedNow.add(w);
      });
    });
    watchList.value.forEach((w) => {
      const wasActive = watchStatus[w];
      const isActive = detectedNow.has(w);
      if (!wasActive && isActive) {
        notify(`✈️ ${w} を検知しました`, "監視中の機体がレーダーに現れました");
      } else if (wasActive && !isActive) {
        notify(`📡 ${w} をロストしました`, "レーダー範囲外に出た可能性があります");
      }
      watchStatus[w] = isActive;
    });
  }

  return { watchList, watchStatus, addToWatchlist, removeFromWatchlist, checkWatchList };
}
