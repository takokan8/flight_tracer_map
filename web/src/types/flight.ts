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
