<template>
  <div id="controls">
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
      <span v-for="v in watchList" :key="v" class="watch-tag" :class="{ active: watchStatus[v] }">
        {{ watchStatus[v] ? "🟢" : "⚪" }} {{ v }}
        <button title="監視解除" @click="emit('remove-watch', v)">✕</button>
      </span>
    </div>

    <button @click="emit('refresh')">🔄 更新</button>
    <div class="info">
      {{ searchQuery ? `表示: ${filteredCount} / 全${totalCount}件` : `フライト数: ${totalCount}` }}
    </div>
    <div class="info">{{ lastUpdate ? `最終更新: ${lastUpdate}` : "最終更新: -" }}</div>
    <div class="error" :class="{ visible: !!errorMsg }">{{ errorMsg }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { REGION_LABELS } from "../constants/regions";

defineProps<{
  totalCount: number;
  filteredCount: number;
  lastUpdate: string;
  errorMsg: string;
  watchList: string[];
  watchStatus: Record<string, boolean>;
}>();

const emit = defineEmits<{
  (e: "update:searchQuery", value: string): void;
  (e: "region-change", key: string): void;
  (e: "registration-search", value: string): void;
  (e: "add-watch", value: string): void;
  (e: "remove-watch", value: string): void;
  (e: "refresh"): void;
}>();

const regionLabels = REGION_LABELS;
const regionKey = ref("japan");
const searchQuery = ref("");
const registrationQuery = ref("");
const watchInput = ref("");

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
  background: white;
  padding: 12px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  min-width: 260px;
  max-width: 300px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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
  margin-bottom: 8px;
  min-height: 10px;
}
.watch-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #e8f0fe;
  color: #1a73e8;
  border-radius: 12px;
  padding: 3px 8px;
  font-size: 12px;
  margin: 2px 2px 0 0;
  transition: all 0.3s ease;
}
.watch-tag.active {
  background: #d4edda;
  color: #155724;
  font-weight: bold;
  box-shadow: 0 0 4px rgba(21, 87, 36, 0.4);
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
</style>
