export interface FlightBasic {
  id: string;
  callsign: string;
  airline: string;
  aircraft: string;
  registration: string;
  /** Mode-Sトランスポンダの24bit ICAOアドレス(機体固有・不変)。
   *  registrationがFR24側で未解決(N/A)の機体でも、電波さえ出ていれば
   *  必ず取得できる恒久的な識別子。ウォッチリスト消失検知(系統2)で
   *  registrationが無い機体を追跡する際の代替キーとして使う */
  icao24bit: string;
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

export interface ApiError {
  error: string;
  detail?: string;
}

export interface PhotoResult {
  found: boolean;
  thumbnail_url?: string | null;
  photographer?: string | null;
  link?: string | null;
}