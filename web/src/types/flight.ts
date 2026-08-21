export interface FlightBasic {
  id: string;
  callsign: string;
  airline: string;
  aircraft: string;
  registration: string;
  origin: string;
  destination: string;
  lat: number;
  lng: number;
  altitude: number;
  speed: number;
  heading: number;
}

export interface TrailPoint {
  lat: number | null;
  lng: number | null;
  alt: number | null;
  ts: number | null;
}

export interface FlightDetailed extends FlightBasic {
  origin_icao: string | null;
  destination_icao: string | null;
  origin_iata: string | null;
  destination_iata: string | null;
  trail: TrailPoint[];
}

export interface Bounds {
  tl_y: number;
  tl_x: number;
  br_y: number;
  br_x: number;
}

/** ウォッチリスト消失検知(系統2)の追跡状態。機体(登録番号/コールサイン)ごとに1件、
 *  ブラウザのlocalStorageに保存される */
export interface WatchTrackEntry {
  /** 監視追加時に割り当てられる通し番号(地図ピンのバッジ表示用) */
  index: number;
  status: "normal" | "lost";
  /** 最後に存在確認できた日時(epoch ms) */
  lastSeenAt: number | null;
  lastLat: number | null;
  lastLng: number | null;
  /** 最後に確認できた時点の全データ(ポップアップ表示用) */
  snapshot: FlightBasic | null;
  /** 消失時のバックオフ段階(0〜4、5以降は通常監視間隔に合流) */
  backoffStep: number;
  /** 次回再照会予定時刻(epoch ms)。status="lost"のときのみ意味を持つ */
  nextCheckAt: number | null;
}

export interface PhotoResult {
  found: boolean;
  thumbnail_url?: string | null;
  photographer?: string | null;
  link?: string | null;
}

export type PhotoState =
  | { status: "loading" }
  | { status: "found"; thumbnail_url: string; photographer: string; link: string }
  | { status: "notfound" };

export interface ApiErrorPayload {
  error: string;
  detail?: string;
}

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}