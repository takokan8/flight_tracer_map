<template>
  <div ref="mapContainer" class="map"></div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from "vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Bounds, FlightBasic, FlightDetailed, TrailPoint, PhotoState } from "../types/flight";
import { useFlightApi } from "../composables/useFlightApi";

/** マーカーに乗せる可変状態。Leafletのポップアップは生HTMLなのでVueのreactivityは使わず、
 * このオブジェクト自体を書き換えては都度 renderPopup() で描き直す方式にする */
type TrackedMarker = L.Marker & {
  _basicFlight: FlightBasic;
  _currentFlight: FlightBasic | FlightDetailed;
  _detailLoading: boolean;
  _photoState: PhotoState | null;
  _photoDismissed: boolean;
};

const props = defineProps<{
  flights: FlightBasic[];
  watchList: string[];
  spotlightCode?: string | null;
}>();
const emit = defineEmits<{ (e: "need-refresh"): void }>();

const mapContainer = ref<HTMLDivElement | null>(null);
let map: L.Map;
const flightMarkers: Record<string, TrackedMarker> = {};
const trailPolylines: Record<string, L.Polyline[]> = {}; // 高度ごとにセグメント分割するため配列
let activeRegionBounds: Bounds | null = null; // リージョン選択中はこちらを優先
let moveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// registration -> PhotoState のクライアント側キャッシュ。同じ機体を何度ポップアップ
// 開閉しても再取得しない(サーバー側にも24時間キャッシュがあるので二重防御)
const photoCache = new Map<string, PhotoState>();

const { fetchFlightDetail, fetchAircraftPhoto } = useFlightApi();

function normalizeLng(lng: number): number {
  return (((lng + 180) % 360) + 360) % 360 - 180;
}

/** 現在のbounds文字列を組み立てる。リージョン選択中はそちらを優先する */
function getCurrentBounds(): Bounds {
  if (activeRegionBounds) return activeRegionBounds;
  const b = map.getBounds();
  return {
    tl_y: b.getNorth(),
    tl_x: normalizeLng(b.getWest()),
    br_y: b.getSouth(),
    br_x: normalizeLng(b.getEast()),
  };
}

// tar1090(html/defaults.js)のColorByAlt.air.hをそのまま踏襲した
// 高度(ft)→色相(0-359°)の折れ線補間。彩度88%・明度50%は固定。
// (Python/Flask版 flight_tracer の index.html から移植)
const ALTITUDE_HUE_STOPS = [
  { alt: 0, hue: 20 }, // オレンジ
  { alt: 2000, hue: 32.5 },
  { alt: 4000, hue: 43 },
  { alt: 6000, hue: 54 },
  { alt: 8000, hue: 72 },
  { alt: 9000, hue: 85 },
  { alt: 11000, hue: 140 }, // 緑
  { alt: 40000, hue: 300 }, // 紫/マゼンタ
  { alt: 51000, hue: 360 }, // 赤(0°と同じ)
];

function altitudeToColor(altitude: number | null | undefined): string {
  if (altitude === null || altitude === undefined) {
    return "hsl(0, 0%, 75%)"; // 高度不明
  }
  if (altitude <= 0) {
    return "hsl(220, 0%, 30%)"; // 地上待機(彩度0%のため色相は実質無視される)
  }

  const stops = ALTITUDE_HUE_STOPS;
  if (altitude <= stops[0].alt) {
    return `hsl(${stops[0].hue}, 88%, 50%)`;
  }
  if (altitude >= stops[stops.length - 1].alt) {
    return "hsl(0, 88%, 50%)"; // 360°は0°と同じ(赤)
  }
  for (let i = 0; i < stops.length - 1; i++) {
    if (altitude >= stops[i].alt && altitude <= stops[i + 1].alt) {
      const range = stops[i + 1].alt - stops[i].alt;
      const progress = (altitude - stops[i].alt) / range;
      const hue = stops[i].hue + (stops[i + 1].hue - stops[i].hue) * progress;
      return `hsl(${hue}, 88%, 50%)`;
    }
  }
  return `hsl(${stops[0].hue}, 88%, 50%)`; // 理論上到達しないフォールバック
}

function createPlaneIcon(heading: number, altitude: number | null | undefined): L.DivIcon {
  const h = heading || 0;
  const color = altitudeToColor(altitude);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"
        style="transform: rotate(${h}deg); transform-origin: center;">
        <path fill="${color}" d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
    </svg>`;
  return L.divIcon({
    html: svg,
    className: "flight-icon",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function escapeHtml(str: unknown): string {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function isSafeUrl(u: unknown): u is string {
  return typeof u === "string" && /^https?:\/\//i.test(u);
}

function buildPhotoSection(photoState: PhotoState | null, dismissed: boolean): string {
  if (!photoState || dismissed) return "";

  if (photoState.status === "loading") {
    return `
      <div class="flight-photo">
          <div class="photo-loading"><span class="photo-spinner"></span>写真を確認中...</div>
      </div>
    `;
  }

  if (photoState.status === "found") {
    if (!isSafeUrl(photoState.thumbnail_url)) return "";
    const url = escapeHtml(photoState.thumbnail_url);
    const link = isSafeUrl(photoState.link) ? escapeHtml(photoState.link) : "#";
    const photographer = escapeHtml(photoState.photographer || "Unknown");
    return `
      <div class="flight-photo">
          <button class="photo-close-btn" title="写真を閉じる">×</button>
          <a href="${link}" target="_blank" rel="noopener noreferrer">
              <img src="${url}" alt="機体写真" loading="lazy">
              <div class="photo-credit">Photo by ${photographer} / planespotters.net</div>
          </a>
      </div>
    `;
  }

  // status === "notfound"
  return `
    <div class="flight-photo">
        <button class="photo-close-btn" title="閉じる">×</button>
        <div class="photo-placeholder">📷 写真なし</div>
    </div>
  `;
}

function buildPopupContent(
  flight: FlightBasic | FlightDetailed,
  loading = false,
  photoState: PhotoState | null = null,
  photoDismissed = false
): string {
  const detailed = flight as FlightDetailed;
  const codeRow =
    detailed.origin_icao || detailed.origin_iata
      ? `
        <div class="code-row">
            <span class="icao-badge">${detailed.origin_icao || "----"}</span>
            <span class="iata-badge">${detailed.origin_iata || "-"}</span>
            <span class="code-arrow">→</span>
            <span class="icao-badge">${detailed.destination_icao || "----"}</span>
            <span class="iata-badge">${detailed.destination_iata || "-"}</span>
        </div>
    `
      : "";

  return `
    <div class="flight-popup">
        <h3>✈️ ${flight.callsign || "Unknown"}</h3>
        <p><strong>航空会社:</strong> ${flight.airline || "Unknown"}</p>
        <p><strong>機種:</strong> ${flight.aircraft || "Unknown"}</p>
        <p><strong>登録番号:</strong> ${flight.registration || "N/A"}</p>
        <div class="route">${flight.origin || "N/A"} → ${flight.destination || "N/A"}</div>
        <p><strong>高度:</strong> ${flight.altitude ? flight.altitude + " ft" : "N/A"}</p>
        <p><strong>速度:</strong> ${flight.speed ? flight.speed + " kts" : "N/A"}</p>
        <p><strong>方位:</strong> ${flight.heading || 0}°</p>
        ${codeRow}
        ${loading ? '<p class="loading-note">詳細情報を取得中...</p>' : ""}
        ${buildPhotoSection(photoState, photoDismissed)}
    </div>
    `;
}

/** ポップアップ内容を現在のマーカー状態から再描画し、閉じるボタンにリスナーを繋ぎ直す。
 * setPopupContent()はDOMを丸ごと差し替えるので、リスナーは毎回張り直す必要がある */
function renderPopup(marker: TrackedMarker) {
  marker.setPopupContent(
    buildPopupContent(marker._currentFlight, marker._detailLoading, marker._photoState, marker._photoDismissed)
  );
  const el = marker.getPopup()?.getElement();
  const closeBtn = el?.querySelector<HTMLButtonElement>(".photo-close-btn");
  closeBtn?.addEventListener("click", () => {
    marker._photoDismissed = true;
    // 重要: このクリックハンドラ内で同期的にsetPopupContent()を呼ぶと、Leafletが
    // 「ポップアップ内のクリックか」を判定する処理より先にDOMが差し替わってしまい、
    // 判定に失敗してポップアップごと閉じてしまう。1tick遅らせて回避する。
    setTimeout(() => renderPopup(marker), 0);
  });
}

async function loadAircraftPhoto(registration: string, marker: TrackedMarker) {
  const reg = (registration || "").trim().toUpperCase();

  if (!reg || reg === "N/A") {
    marker._photoState = { status: "notfound" };
    renderPopup(marker);
    return;
  }

  const cached = photoCache.get(reg);
  if (cached) {
    marker._photoState = cached;
    renderPopup(marker);
    return;
  }

  marker._photoState = { status: "loading" };
  renderPopup(marker);

  let result: PhotoState;
  try {
    const data = await fetchAircraftPhoto(reg);
    result =
      data.found && data.thumbnail_url
        ? {
            status: "found",
            thumbnail_url: data.thumbnail_url,
            photographer: data.photographer || "Unknown",
            link: data.link || "#",
          }
        : { status: "notfound" };
  } catch (error) {
    console.error("写真取得エラー:", error);
    result = { status: "notfound" };
  }

  photoCache.set(reg, result);
  marker._photoState = result;
  // ポップアップが閉じられていてもmarker._photoState自体は更新しておく
  // (再度開いたときにキャッシュとして即反映される)
  if (marker.isPopupOpen()) {
    renderPopup(marker);
  }
}

function removeTrail(flightId: string) {
  if (trailPolylines[flightId]) {
    trailPolylines[flightId].forEach((seg) => map.removeLayer(seg));
    delete trailPolylines[flightId];
  }
}

/**
 * ウォッチリスト/検索ハイライトとの一致判定を行い、マーカーへの追従tooltipと
 * 目立たせ用アイコンを同期する。Leafletのtooltipはマーカーにbindしておけば
 * setLatLng()のたびに自動で位置が追従するので、別途座標計算は不要。
 */
function syncWatchTooltip(marker: TrackedMarker, flight: FlightBasic) {
  const callsign = (flight.callsign || "").toUpperCase();
  const registration = (flight.registration || "").toUpperCase();

  const watchMatch = props.watchList.find((w) => w === callsign || w === registration) || null;
  const spotlight = (props.spotlightCode || "").toUpperCase();
  const spotlightMatch = spotlight && (registration === spotlight || callsign === spotlight) ? props.spotlightCode : null;

  const label = watchMatch || spotlightMatch;

  if (label) {
    if (marker.getTooltip()) {
      marker.setTooltipContent(label);
    } else {
      marker.bindTooltip(label, {
        permanent: true,
        direction: "top",
        offset: [0, -14],
        className: "flight-watch-tooltip",
      });
    }
  } else if (marker.getTooltip()) {
    marker.unbindTooltip();
  }

  // アイコンの塗り色は高度基準(altitudeToColor)に統一。ウォッチ中の識別は
  // 上のtooltip(追従ラベル)のみで行う
  marker.setIcon(createPlaneIcon(flight.heading || 0, flight.altitude));
}

// Leafletのpolylineは1本につき単色しか持てないため、高度に応じたグラデーション
// を表現するには2点ごとの短いセグメントに分割し、セグメントごとに
// altitudeToColor()の色を設定する(アイコンの高度配色と表現を揃えるため)。
// セグメント色は両端点の高度の平均値で決定(片方欠損時はもう片方の高度を採用)
function drawTrail(flightId: string, trailPoints: TrailPoint[] | undefined) {
  removeTrail(flightId);
  if (!trailPoints || trailPoints.length < 2) return;

  const points = trailPoints.filter(
    (p): p is TrailPoint & { lat: number; lng: number } => p.lat != null && p.lng != null,
  );
  if (points.length < 2) return;

  const segments: L.Polyline[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const alt1 = p1.alt;
    const alt2 = p2.alt;
    const segAlt = alt1 != null && alt2 != null ? (alt1 + alt2) / 2 : (alt1 != null ? alt1 : alt2);

    const segment = L.polyline(
      [
        [p1.lat, p1.lng],
        [p2.lat, p2.lng],
      ],
      {
        color: altitudeToColor(segAlt),
        weight: 3,
        opacity: 0.5,
      },
    ).addTo(map);
    segments.push(segment);
  }

  trailPolylines[flightId] = segments;
}

async function loadFlightDetails(flightId: string, marker: TrackedMarker) {
  try {
    const detail = await fetchFlightDetail(flightId, getCurrentBounds());
    if (!detail) {
      // 失敗時は基本情報のまま(フォールバック)。ローディング表示だけは消す
      marker._detailLoading = false;
      renderPopup(marker);
      return;
    }
    marker._currentFlight = detail;
    marker._detailLoading = false;
    renderPopup(marker);
    drawTrail(flightId, detail.trail);
  } catch (error) {
    console.error("詳細取得エラー:", error);
    marker._detailLoading = false;
    renderPopup(marker);
  }
}

function updateMap(flights: FlightBasic[]) {
  const currentIds = new Set(flights.map((f) => f.id));
  for (const id in flightMarkers) {
    if (!currentIds.has(id)) {
      map.removeLayer(flightMarkers[id]);
      delete flightMarkers[id];
      removeTrail(id);
    }
  }

  flights.forEach((flight) => {
    const pos: [number, number] = [flight.lat, flight.lng];
    const existing = flightMarkers[flight.id];
    if (existing) {
      existing.setLatLng(pos);
      existing._basicFlight = flight;
      syncWatchTooltip(existing, flight);
    } else {
      const marker = L.marker(pos, { icon: createPlaneIcon(flight.heading || 0, flight.altitude) }).addTo(map) as TrackedMarker;
      marker._basicFlight = flight;
      marker._currentFlight = flight;
      marker._detailLoading = false;
      marker._photoState = null;
      marker._photoDismissed = false;
      marker.bindPopup(buildPopupContent(flight));
      syncWatchTooltip(marker, flight);

      marker.on("popupopen", () => {
        marker._currentFlight = marker._basicFlight;
        marker._detailLoading = true;
        marker._photoDismissed = false;
        renderPopup(marker);

        loadFlightDetails(flight.id, marker);
        loadAircraftPhoto(marker._basicFlight.registration, marker);
      });
      marker.on("popupclose", () => {
        removeTrail(flight.id);
      });

      flightMarkers[flight.id] = marker;
    }
  });
}

watch(
  () => props.flights,
  (flights) => updateMap(flights),
  { deep: false }
);

// ウォッチリストや検索ハイライトだけが変わったとき(新しいフライト取得を待たずに)
// 既存マーカーのtooltip/アイコンを即座に反映する
watch(
  () => [props.watchList, props.spotlightCode],
  () => {
    Object.values(flightMarkers).forEach((marker) => {
      syncWatchTooltip(marker, marker._basicFlight);
    });
  },
  { deep: true }
);

function onMapMoveEnd() {
  activeRegionBounds = null; // 手動操作でリージョン固定を解除
  if (moveDebounceTimer) clearTimeout(moveDebounceTimer);
  moveDebounceTimer = setTimeout(() => emit("need-refresh"), 800);
}

onMounted(() => {
  map = L.map(mapContainer.value as HTMLDivElement).setView([35.6762, 139.6503], 5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 18,
  }).addTo(map);

  map.on("moveend", onMapMoveEnd);
  map.on("zoomend", onMapMoveEnd);

  emit("need-refresh");
});

onBeforeUnmount(() => {
  if (moveDebounceTimer) clearTimeout(moveDebounceTimer);
  map?.remove();
});

defineExpose({
  getCurrentBounds,
  jumpToRegion(bounds: Bounds) {
    activeRegionBounds = bounds;
    const b = L.latLngBounds([bounds.br_y, bounds.tl_x], [bounds.tl_y, bounds.br_x]);
    map.fitBounds(b);
  },
  flyTo(lat: number, lng: number, zoom = 8) {
    map.setView([lat, lng], zoom);
  },
});
</script>

<style scoped>
.map {
  height: 100vh;
  width: 100%;
}
</style>

<style>
/* Leafletポップアップ内はグローバルHTML文字列として描画されるため scoped 外に定義する */

/* Leafletポップアップ本体:すりガラス(グラスモーフィズム)効果 */
.leaflet-popup-content-wrapper {
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}
.leaflet-popup-tip {
  background: rgba(255, 255, 255, 0.45);
  /* backdrop-filter: blur(12px);*/
  -webkit-backdrop-filter: blur(2px);
}

.flight-popup {
  min-width: 260px;
}
.flight-popup h3 {
  margin: 0 0 8px 0;
  color: #1a73e8;
  font-size: 16px;
}
.flight-popup p {
  margin: 4px 0;
  font-size: 13px;
  color: #444;
}
.flight-popup .route {
  font-weight: bold;
  color: #333;
  margin: 8px 0;
  font-size: 14px;
}
.flight-popup .loading-note {
  color: #999;
  font-size: 11px;
  margin-top: 6px;
}
/* 登録番号行(3番目のp)のみ黒背景・白文字にして視認性を上げる。
   HTML側の行順(航空会社→機種→登録番号)が変わると対象がずれるので、
   行順を変更する場合はこのnth-of-type(3)も合わせて見直すこと */
.flight-popup p:nth-of-type(3) {
    background: #000;
    color: #fff;
    padding: 2px 8px;
    border-radius: 3px;
    display: inline-block;
}
.flight-icon {
  filter: drop-shadow(1px 1px 2px rgba(0, 0, 0, 0.3));
}
.flight-watch-tooltip {
  background: #111 !important;
  color: #fff !important;
  border: none !important;
  border-radius: 4px !important;
  font-weight: bold;
  font-size: 12px;
  padding: 2px 7px !important;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}
.flight-watch-tooltip::before {
  border-top-color: #111 !important;
}
.flight-popup .code-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 6px;
  font-size: 12px;
}
.flight-popup .icao-badge {
  background: #1a1a1a;
  color: #fff;
  font-family: "Courier New", monospace;
  font-weight: bold;
  letter-spacing: 0.5px;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
}
.flight-popup .iata-badge {
  background: #e3f2fd;
  color: #1565c0;
  font-family: "Courier New", monospace;
  font-weight: bold;
  letter-spacing: 0.5px;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
}
.flight-popup .code-arrow {
  color: #bbb;
  font-size: 11px;
}
.flight-photo {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid #eee;
  position: relative;
}
.flight-photo .photo-close-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 12px;
  line-height: 18px;
  text-align: center;
  padding: 0;
  cursor: pointer;
  z-index: 10;
}
.flight-photo .photo-close-btn:hover {
  background: rgba(0, 0, 0, 0.8);
}
.flight-photo a {
  display: block;
  text-decoration: none;
}
.flight-photo img {
  width: 100%;
  max-height: 160px;
  object-fit: cover;
  border-radius: 4px;
  display: block;
}
.flight-photo .photo-credit {
  margin-top: 4px;
  font-size: 10px;
  color: #999;
  text-align: right;
}
.flight-photo .photo-loading,
.flight-photo .photo-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 60px;
  background: #f5f5f5;
  border-radius: 4px;
  color: #aaa;
  font-size: 11px;
}
.flight-photo .photo-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid #ddd;
  border-top-color: #1a73e8;
  border-radius: 50%;
  animation: photo-spin 0.8s linear infinite;
}
@keyframes photo-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>