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

  async function searchByRegistration(registration: string): Promise<FlightBasic> {
    const response = await fetch(`${API_BASE}/search?registration=${encodeURIComponent(registration)}`);
    if (!response.ok) return parseErrorResponse(response);
    return response.json();
  }

  async function fetchAircraftPhoto(registration: string): Promise<PhotoResult> {
    const response = await fetch(`${API_BASE}/photo/${encodeURIComponent(registration)}`);
    if (!response.ok) return { found: false }; // 失敗時は「写真なし」扱い(表示を止めない)
    return response.json();
  }

  return { fetchFlights, fetchFlightDetail, searchByRegistration, fetchAircraftPhoto };
}
