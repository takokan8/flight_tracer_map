<template>
  <div class="app">
    <div id="magnify-target" class="magnify-target">
      <MapView
        ref="mapRef"
        :flights="filteredFlights"
        :watch-list="watchList"
        :spotlight-code="spotlightCode"
        :lost-aircraft="lostAircraftList"
        @need-refresh="fetchFlights"
      />
      <ControlsPanel
        :total-count="allFlights.length"
        :filtered-count="filteredFlights.length"
        :last-update="lastUpdate"
        :error-msg="errorMsg"
        :watch-list="watchList"
        :watch-status="watchStatus"
        :watch-tracking="tracking"
        @update:search-query="searchQuery = $event"
        @region-change="onRegionChange"
        @registration-search="onRegistrationSearch"
        @add-watch="addToWatchlist"
        @remove-watch="removeFromWatchlist"
        @focus-position="onFocusPosition"
        @refresh="fetchFlights"
      />
    </div>

    <button class="magnifier-toggle" @click="magnifierOn = !magnifierOn">
      {{ magnifierOn ? "🔍 虫眼鏡OFF" : "🔍 虫眼鏡ON" }}
    </button>
    <Magnifier v-if="magnifierOn" target-selector="#magnify-target" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import MapView from "./components/MapView.vue";
import ControlsPanel from "./components/ControlsPanel.vue";
import Magnifier from "./components/Magnifier.vue";
import { useFlightApi } from "./composables/useFlightApi";
import { useWatchlist } from "./composables/useWatchlist";
import { useWatchlistMonitor } from "./composables/useWatchlistMonitor";
import { REGIONS, findNearestRegion, REGION_LABELS } from "./constants/regions";
import type { FlightBasic } from "./types/flight";
import { ApiError } from "./types/flight";

const { fetchFlights: apiFetchFlights, searchByRegistration } = useFlightApi();
const { watchList, watchStatus, addToWatchlist, removeFromWatchlist, checkWatchList } = useWatchlist();
const { tracking, start: startWatchMonitor, stop: stopWatchMonitor } = useWatchlistMonitor(watchList);

const mapRef = ref<InstanceType<typeof MapView> | null>(null);
const allFlights = ref<FlightBasic[]>([]);
const searchQuery = ref("");
const errorMsg = ref("");
const lastUpdate = ref("");
const magnifierOn = ref(false);
const spotlightCode = ref<string | null>(null);
let pollTimer: ReturnType<typeof setInterval> | null = null;

const filteredFlights = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return allFlights.value;
  return allFlights.value.filter((f) => {
    const text = `${f.callsign || ""} ${f.airline || ""} ${f.aircraft || ""} ${f.registration || ""}`.toLowerCase();
    return text.includes(query);
  });
});

// 消失中(status==="lost")の機体だけを地図ピン表示用に抽出
const lostAircraftList = computed(() =>
  Object.entries(tracking)
    .filter(([, entry]) => entry.status === "lost" && entry.lastLat !== null && entry.lastLng !== null)
    .map(([registration, entry]) => ({ registration, ...entry }))
);

async function fetchFlights() {
  if (!mapRef.value) return;
  errorMsg.value = "";
  try {
    const bounds = mapRef.value.getCurrentBounds();
    const flights = await apiFetchFlights(bounds);
    allFlights.value = flights;
    checkWatchList(flights);
    lastUpdate.value = new Date().toLocaleTimeString();
  } catch (error) {
    console.error("フライト取得エラー:", error);
    errorMsg.value = `取得失敗: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function onRegionChange(key: string) {
  const region = REGIONS[key];
  if (!region || !mapRef.value) return;
  mapRef.value.jumpToRegion(region);
}

async function onRegistrationSearch(registration: string) {
  errorMsg.value = "";
  try {
    const flight = await searchByRegistration(registration);
    if (!flight) {
      errorMsg.value = `検索失敗: ${registration} は現在飛行中の機体として見つかりませんでした`;
      return;
    }
    mapRef.value?.flyTo(flight.lat, flight.lng, 8);
    spotlightCode.value = flight.registration || registration;
    const nearestRegion = findNearestRegion(flight.lat, flight.lng);
    const regionLabel = (nearestRegion && REGION_LABELS[nearestRegion]) || "不明";
    alert(`${registration} を検出しました(${flight.callsign || "コールサイン不明"})\n最寄りリージョン: ${regionLabel}`);
  } catch (error) {
    console.error("登録番号検索エラー:", error);
    const message = error instanceof ApiError ? error.message : String(error);
    errorMsg.value = `検索失敗: ${message}`;
  }
}

// ウォッチリストパネルの登録番号ボタンクリック: その最終確認位置へ地図を移動。
// 位置データの鮮度に応じたマージン(km)を加味してfitさせる(ControlsPanel側で算出)
function onFocusPosition(lat: number, lng: number, marginKm: number) {
  mapRef.value?.flyToWithMargin(lat, lng, marginKm);
}

onMounted(() => {
  pollTimer = setInterval(fetchFlights, 30000);
  startWatchMonitor();
});

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer);
  stopWatchMonitor();
});
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.app {
  position: relative;
  height: 100vh;
  width: 100%;
}
.magnify-target {
  position: relative;
  height: 100%;
  width: 100%;
}
.magnifier-toggle {
  position: fixed;
  bottom: 10px;
  left: 10px;
  z-index: 1000;
  padding: 8px 12px;
  background: white;
  color: #1a73e8;
  border: 1px solid #1a73e8;
  border-radius: 6px;
  font-size: 13px;
  font-weight: bold;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}
.magnifier-toggle:hover {
  background: #e8f0fe;
}
</style>