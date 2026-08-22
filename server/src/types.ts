declare module "flightradarapi" {
  export interface FlightTrailPoint {
    lat?: number;
    lng?: number;
    alt?: number;
    ts?: number;
    [key: string]: unknown;
  }

  export interface FlightRawDetails {
    airport?: {
      origin?: { code?: { icao?: string; iata?: string } };
      destination?: { code?: { icao?: string; iata?: string } };
    };
    trail?: FlightTrailPoint[];
    [key: string]: unknown;
  }

  export class Flight {
    id: string;
    callsign?: string;
    number?: string;
    airlineIcao?: string;
    airlineIata?: string;
    airlineName?: string;
    aircraftCode?: string;
    aircraftModel?: string;
    registration?: string;
    icao24bit?: string;
    originAirportIata?: string;
    originAirportIcao?: string;
    originAirportName?: string;
    destinationAirportIata?: string;
    destinationAirportIcao?: string;
    destinationAirportName?: string;
    latitude: number;
    longitude: number;
    altitude: number;
    groundSpeed: number;
    heading?: number;
    trail?: FlightTrailPoint[];
    setFlightDetails(raw: FlightRawDetails): void;
  }

  export interface Bounds {
    [key: string]: unknown;
  }

  export class FlightRadar24API {
    constructor();
    getBounds(box: { tl_y: number; tl_x: number; br_y: number; br_x: number }): string;
    getBoundsByPoint(latitude: number, longitude: number, radius: number): string;
    getFlights(
      airline?: string | null,
      bounds?: string | null,
      registration?: string | null
    ): Promise<Flight[]>;
    getFlightDetails(flight: Flight): Promise<FlightRawDetails>;
  }
}