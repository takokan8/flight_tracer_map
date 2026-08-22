import type { Bounds, FlightBasic, FlightDetailed, PhotoResult } from "../types/flight";
import { ApiError } from "../types/flight";

const API_BASE = "/api";

export function boundsToParam(b: Bounds): string {
  return `${b.tl_y},${b.tl_x},${b.br_y},${b.br_x}`;
}

async function parseErrorResponse(response: Response): Promise<never> {
  let detail = `HTTP ${response.status}`;
  try {
    const data = await response.json();
    detail = data.detail || data.error || detail;
  } catch {
    // レスポンスがJSONでない場合はHTTPステータスのみを使う
  }
  throw new ApiError(detail);
}

export function useFlightApi() {
  async function fetchFlights(bounds: Bounds): Promise<FlightBasic[]> {
    const response = await fetch(`${API_BASE}/flights?bounds=${encodeURIComponent(boundsToParam(bounds))}`);
    if (!response.ok) return parseErrorResponse(response);
    return response.json();
  }

  async function fetchFlightDetail(flightId: string, bounds: Bounds): Promise<FlightDetailed | null> {
    const response = await fetch(
      `${API_BASE}/flight/${encodeURIComponent(flightId)}?bounds=${encodeURIComponent(boundsToParam(bounds))}`
    );
    if (!response.ok) return null; // 失敗時は基本情報のまま(フォールバック)
    return response.json();
  }

  async function searchByRegistration(
    registration: string,
    area?: { lat: number; lng: number; radiusKm: number } | null
  ): Promise<FlightBasic | null> {
    const params = new URLSearchParams({ registration });
    if (area) {
      params.set("lat", String(area.lat));
      params.set("lng", String(area.lng));
      params.set("radius", String(area.radiusKm));
    }
    const response = await fetch(`${API_BASE}/search?${params.toString()}`);
    if (response.status === 404) return null; // 見つからなかった(消失/未発見)は例外にせずnullで返す
    if (!response.ok) return parseErrorResponse(response);
    return response.json();
  }

  // registration(N/A)が取得できない機体の代替追跡用。全世界検索には対応せず、
  // エリア限定(lat/lng/radius必須)のみサポートする
  async function searchByIcao24bit(
    icao24bit: string,
    area: { lat: number; lng: number; radiusKm: number }
  ): Promise<FlightBasic | null> {
    const params = new URLSearchParams({
      icao24bit,
      lat: String(area.lat),
      lng: String(area.lng),
      radius: String(area.radiusKm),
    });
    const response = await fetch(`${API_BASE}/search-by-icao?${params.toString()}`);
    if (response.status === 404) return null;
    if (!response.ok) return parseErrorResponse(response);
    return response.json();
  }

  async function fetchAircraftPhoto(registration: string): Promise<PhotoResult> {
    const response = await fetch(`${API_BASE}/photo/${encodeURIComponent(registration)}`);
    if (!response.ok) return { found: false }; // 失敗時は「写真なし」扱い(表示を止めない)
    return response.json();
  }

  return { fetchFlights, fetchFlightDetail, searchByRegistration, searchByIcao24bit, fetchAircraftPhoto };
}