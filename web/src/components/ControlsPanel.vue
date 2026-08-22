<template>
  <div id="controls" :class="{ collapsed: !isPanelOpen }">
    <div class="panel-header" @click="togglePanel">
      <span class="panel-title">🛩️ コントロール</span>
      <span class="panel-toggle">{{ isPanelOpen ? "▲" : "▼" }}</span>
    </div>

    <div class="panel-body" v-show="isPanelOpen">
      <select v-model="regionKey" @change="onRegionChange">
        <option v-for="(label, key) in regionLabels" :key="key" :value="key">{{ label }}</option>
      </select>

      <input
        type="text"
        v-model="searchQuery"
        placeholder="コールサイン・航空会社・機種で検索"
        @input="emit('update:searchQuery', searchQuery)"
      />

      <div class="watch-input-row">
        <input
          type="text"
          v-model="registrationQuery"
          placeholder="登録番号で検索 (例: N221EG)"
          @keydown.enter="submitRegistrationSearch"
        />
        <button @click="submitRegistrationSearch">🔍</button>
      </div>

      <div class="watch-input-row">
        <input
          type="text"
          v-model="watchInput"
          placeholder="コールサイン/登録番号を監視"
          @keydown.enter="submitAddWatch"
        />
        <button @click="submitAddWatch">＋</button>
      </div>

      <div id="watchlist-container">
        <span
          v-for="v in pagedWatchList"
          :key="v"
          class="watch-tag"
          :class="{
            active: watchStatus[v],
            lost: watchTracking[v]?.status === 'lost',
            untrackable: watchTracking[v]?.status === 'untrackable',
          }"
        >
          {{ statusIcon(v) }}
          <button
            class="watch-tag-reg"
            type="button"
            :disabled="!hasPosition(v)"
            :title="hasPosition(v) ? '地図をこの位置へ移動' : '位置情報なし'"
            @click="focusOnPosition(v)"
          >
            {{ v }}
          </button>
          <span v-if="hasPosition(v)" class="watch-tag-coords">{{ formatCoords(v) }}</span>
          <button class="watch-tag-remove" title="監視解除" @click="emit('remove-watch', v)">✕</button>
        </span>
      </div>
      <div id="watchlist-pagination" class="watchlist-pagination">
        <template v-if="watchList.length === 0"></template>
        <span v-else-if="watchList.length <= WATCH_PAGE_SIZE">{{ watchList.length }}/{{ WATCH_LIST_MAX }}件</span>
        <template v-else>
          <button @click="prevPage" :disabled="watchListPage === 0">◀</button>
          <span>{{ watchListPage + 1 }} / {{ totalPages }}ページ ({{ watchList.length }}/{{ WATCH_LIST_MAX }}件)</span>
          <button @click="nextPage" :disabled="watchListPage >= totalPages - 1">▶</button>
        </template>
      </div>

      <button @click="emit('refresh')">🔄 更新</button>
      <div class="info">
        {{ searchQuery ? `表示: ${filteredCount} / 全${totalCount}件` : `フライト数: ${totalCount}` }}
      </div>
      <div class="info">{{ lastUpdate ? `最終更新: ${lastUpdate}` : "最終更新: -" }}</div>
      <div class="error" :class="{ visible: !!errorMsg }">{{ errorMsg }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { REGION_LABELS } from "../constants/regions";
import { WATCH_LIST_MAX, WATCH_PAGE_SIZE } from "../composables/useWatchlist";
import { BACKOFF_STEPS } from "../composables/useWatchlistMonitor";
import type { WatchTrackEntry } from "../types/flight";

const props = defineProps<{
  totalCount: number;
  filteredCount: number;
  lastUpdate: string;
  errorMsg: string;
  watchList: string[];
  watchStatus: Record<string, boolean>;
  watchTracking: Record<string, WatchTrackEntry>;
}>();

const emit = defineEmits<{
  (e: "update:searchQuery", value: string): void;
  (e: "region-change", key: string): void;
  (e: "registration-search", value: string): void;
  (e: "add-watch", value: string): void;
  (e: "remove-watch", value: string): void;
  (e: "focus-position", lat: number, lng: number, marginKm: number): void;
  (e: "refresh"): void;
}>();

const regionLabels = REGION_LABELS;
const regionKey = ref("japan");
const searchQuery = ref("");
const registrationQuery = ref("");
const watchInput = ref("");

// パネルの開閉状態(次回訪問時も好みの状態を復元する)
const PANEL_STATE_KEY = "controlsPanelOpen";
const isPanelOpen = ref(localStorage.getItem(PANEL_STATE_KEY) !== "false");

function togglePanel() {
  isPanelOpen.value = !isPanelOpen.value;
  localStorage.setItem(PANEL_STATE_KEY, String(isPanelOpen.value));
}

// ウォッチリスト消失検知(系統2)の追跡状態を使った表示ヘルパー
function hasPosition(reg: string): boolean {
  const entry = props.watchTracking[reg];
  return !!entry && entry.lastLat !== null && entry.lastLng !== null;
}

function formatCoords(reg: string): string {
  const entry = props.watchTracking[reg];
  if (!entry || entry.lastLat === null || entry.lastLng === null) return "";
  return `${entry.lastLat.toFixed(4)}, ${entry.lastLng.toFixed(4)}`;
}

function statusIcon(reg: string): string {
  const entry = props.watchTracking[reg];
  if (entry?.status === "untrackable") return "🛑"; // 追跡不能(400km圏内で発見できず捜索終了)
  if (entry?.status === "lost") return "📡"; // 消失中(バックオフ再捜索中)
  return props.watchStatus[reg] ? "🟢" : "⚪";
}

// 位置データの鮮度に応じたジャンプ先の表示マージン(km)を決める:
// - 通常監視中: 次回ポーリングまで最大5分弱古い可能性があるため、
//   旅客機の巡航速度(5分でおよそ80km)を踏まえて余裕を持った値にする
// - 消失中: そのバックオフ段階で実際に検索している半径をそのまま使う
//   (探索中の範囲=機体がいる可能性のある範囲、という意味で理にかなっている)
const NORMAL_MARGIN_KM = 100;
const LOST_FALLBACK_MARGIN_KM = 500; // 全世界検索段階(ステップ4以降)の目安表示範囲

function marginForEntry(entry: WatchTrackEntry): number {
  if (entry.status === "normal") return NORMAL_MARGIN_KM;
  // lost(バックオフ再捜索中)・untrackable(捜索終了)はどちらも
  // 「その半径まで探しても見つからなかった」を表すbackoffStepに応じた値を使う
  const step = BACKOFF_STEPS[Math.min(entry.backoffStep, BACKOFF_STEPS.length - 1)];
  return step.radiusKm ?? LOST_FALLBACK_MARGIN_KM;
}

function focusOnPosition(reg: string) {
  const entry = props.watchTracking[reg];
  if (!entry || entry.lastLat === null || entry.lastLng === null) return;
  emit("focus-position", entry.lastLat, entry.lastLng, marginForEntry(entry));
}

// Python/Flask版(flight_tracer/index.html)のrenderWatchList()と同じ
// ページング仕様: 5件/ページで縦積み表示、上限250件
const watchListPage = ref(0); // 0始まり

const totalPages = computed(() => Math.max(1, Math.ceil(props.watchList.length / WATCH_PAGE_SIZE)));

const pagedWatchList = computed(() => {
  const start = watchListPage.value * WATCH_PAGE_SIZE;
  return props.watchList.slice(start, start + WATCH_PAGE_SIZE);
});

// watchList件数の増減に応じてページ位置を追従させる(Python版と同じ挙動):
// 追加時は新規項目が見えるよう最終ページへ、削除時は範囲外なら手前へクランプ
watch(
  () => props.watchList.length,
  (newLen, oldLen) => {
    const lastPageIndex = Math.max(0, Math.ceil(newLen / WATCH_PAGE_SIZE) - 1);
    if (newLen > oldLen) {
      watchListPage.value = lastPageIndex;
    } else if (watchListPage.value > lastPageIndex) {
      watchListPage.value = lastPageIndex;
    }
  }
);

function prevPage() {
  if (watchListPage.value > 0) watchListPage.value--;
}

function nextPage() {
  if (watchListPage.value < totalPages.value - 1) watchListPage.value++;
}

function onRegionChange() {
  emit("region-change", regionKey.value);
}

function submitRegistrationSearch() {
  if (!registrationQuery.value.trim()) return;
  emit("registration-search", registrationQuery.value.trim().toUpperCase());
}

function submitAddWatch() {
  if (!watchInput.value.trim()) return;
  emit("add-watch", watchInput.value.trim());
  watchInput.value = "";
}
</script>

<style scoped>
#controls {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1000;
  background: rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  padding: 12px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  min-width: 260px;
  max-width: 300px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  user-select: none;
  font-weight: bold;
  font-size: 14px;
  color: #1a1a1a;
  margin-bottom: 10px;
}
#controls.collapsed .panel-header {
  margin-bottom: 0;
}
.panel-toggle {
  font-size: 11px;
  color: #666;
}
#controls select,
#controls input[type="text"] {
  width: 100%;
  padding: 8px 10px;
  margin-bottom: 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 13px;
  box-sizing: border-box;
}
#controls input[type="text"]:focus {
  outline: none;
  border-color: #1a73e8;
}
#controls button {
  width: 100%;
  padding: 8px;
  background: #1a73e8;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: bold;
}
#controls button:hover {
  background: #1557b0;
}
#controls .info {
  margin-top: 8px;
  font-size: 12px;
  color: #666;
}
#controls .error {
  color: #c5221f;
  font-size: 12px;
  margin-top: 6px;
  padding: 6px;
  background: #fce8e8;
  border-radius: 4px;
  display: none;
}
#controls .error.visible {
  display: block;
}
.watch-input-row {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
}
.watch-input-row input {
  flex: 1;
  margin-bottom: 0 !important;
}
.watch-input-row button {
  width: auto !important;
  padding: 8px 12px !important;
}
#watchlist-container {
  margin-bottom: 4px;
  min-height: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.watchlist-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
  color: #666;
}
.watchlist-pagination button {
  width: auto !important;
  padding: 2px 10px !important;
  font-size: 12px;
}
.watchlist-pagination button:disabled {
  opacity: 0.4;
  cursor: default;
}
.watch-tag {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 4px;
  background: #e8f0fe;
  color: #1a73e8;
  border-radius: 12px;
  padding: 3px 8px;
  font-size: 12px;
  transition: all 0.3s ease;
}
.watch-tag.active {
  background: #d4edda;
  color: #155724;
  font-weight: bold;
  box-shadow: 0 0 4px rgba(21, 87, 36, 0.4);
}
.watch-tag.lost {
  background: #fdecea;
  color: #d32f2f;
  font-weight: bold;
  box-shadow: 0 0 4px rgba(211, 47, 47, 0.4);
}
.watch-tag.untrackable {
  background: #eceff1;
  color: #607d8b;
  font-weight: bold;
  box-shadow: 0 0 4px rgba(96, 125, 139, 0.4);
}
.watch-tag button {
  all: unset;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  width: auto !important;
  padding: 0 !important;
  background: transparent !important;
  color: inherit !important;
  opacity: 0.6;
  margin-left: 4px;
}
.watch-tag button:hover {
  opacity: 1;
}
.watch-tag-reg {
  font-weight: bold;
  text-decoration: underline;
  text-underline-offset: 2px;
  opacity: 1 !important;
  margin-left: 0 !important;
}
.watch-tag-reg:disabled {
  cursor: default;
  text-decoration: none;
  opacity: 0.8 !important;
}
.watch-tag-coords {
  font-size: 10px;
  opacity: 0.75;
  font-family: "Courier New", monospace;
}
.watch-tag-remove {
  margin-left: auto !important;
}
</style>