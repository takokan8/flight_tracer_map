import path from "path";
import fs from "fs";
import express, { Request, Response, NextFunction, RequestHandler } from "express";
import cors from "cors";
import { FlightRadar24API, Flight, FlightRawDetails } from "flightradarapi";
import type { PlanespottersResponse } from "./planespotters";
import type { FlightBasic, FlightDetailed, TrailPoint, Bounds, PhotoResult } from "./types";

const app = express();
app.use(cors());

const frApi = new FlightRadar24API();

// Vue(Vite)のビルド成果物(web/dist)を配信する。無ければAPIのみで起動する。
//const STATIC_DIR = path.join(__dirname, "..", "..", "web", "dist");
//const hasStaticBuild = fs.existsSync(path.join(STATIC_DIR, "index.html"));
//if (hasStaticBuild) {
//  app.use(express.static(STATIC_DIR));
//}
// vercel 向け設定
const STATIC_DIR = path.join(__dirname, "..", "public");
const hasStaticBuild = fs.existsSync(path.join(STATIC_DIR, "index.html"));
// Vercel上ではpublic/**をCDNが直接配信するのでExpress側のstaticは不要(というより効かない)。
// ローカルで node dist/index.js を単体実行して確認したい時だけ使う。
if (hasStaticBuild && !process.env.VERCEL) {
  app.use(express.static(STATIC_DIR));
}

// デフォルトbounds: 北, 西, 南, 東(日本周辺) — python版 DEFAULT_BOUNDS と同一
const DEFAULT_BOUNDS = "46.0,122.0,24.0,146.0";

// 広域取得防止用の面積上限(緯度差 × 経度差の目安値)
// DEFAULT_BOUNDS(日本周辺)の面積 = |46-24| × |146-122| = 528 を下回らない値にする
const MAX_BOUNDS_AREA = 600.0;

function parseBounds(boundsStr: string): Bounds {
  const coords = boundsStr.split(",").map((v) => parseFloat(v));
  if (coords.length !== 4 || coords.some((v) => Number.isNaN(v))) {
    throw new Error("bounds must have 4 comma-separated values: tl_y,tl_x,br_y,br_x");
  }
  const [tl_y, tl_x, br_y, br_x] = coords;
  return { tl_y, tl_x, br_y, br_x };
}

function validateBoundsArea(bounds: Bounds): { error: string; detail: string } | null {
  const { tl_y, tl_x, br_y, br_x } = bounds;
  const area = Math.abs(tl_y - br_y) * Math.abs(tl_x - br_x);
  if (area > MAX_BOUNDS_AREA) {
    return {
      error: "bounds_too_large",
      detail: `表示範囲が広すぎます(area=${area.toFixed(1)})。ズームインしてください`,
    };
  }
  return null;
}

/** bounds文字列をパース・検証し、問題があれば400レスポンスを送って null を返す */
function resolveBounds(req: Request, res: Response): Bounds | null {
  const boundsStr = (req.query.bounds as string) || DEFAULT_BOUNDS;
  let bounds: Bounds;
  try {
    bounds = parseBounds(boundsStr);
  } catch (e) {
    res.status(400).json({ error: "invalid_bounds", detail: (e as Error).message });
    return null;
  }
  const areaError = validateBoundsArea(bounds);
  if (areaError) {
    res.status(400).json(areaError);
    return null;
  }
  return bounds;
}

function serializeFlightBasic(flight: Flight): FlightBasic {
  return {
    id: flight.id,
    callsign: flight.callsign || flight.number || "",
    airline: flight.airlineIcao || flight.airlineIata || "Unknown",
    aircraft: flight.aircraftCode || "Unknown",
    registration: flight.registration || "N/A",
    origin: flight.originAirportIata || "N/A",
    destination: flight.destinationAirportIata || "N/A",
    lat: flight.latitude,
    lng: flight.longitude,
    altitude: flight.altitude,
    speed: flight.groundSpeed,
    heading: flight.heading || 0,
  };
}

function serializeFlightDetailed(flight: Flight, rawDetails: FlightRawDetails | null): FlightDetailed {
  const airport = rawDetails?.airport || {};
  const origin = airport.origin?.code || {};
  const destination = airport.destination?.code || {};

  // 実機確認: trailは新しい順(降順)で返る。ts昇順(古い→新しい)にソートしてから渡す
  const trailRaw = rawDetails?.trail || [];
  const trailSorted: TrailPoint[] = [...trailRaw]
    .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    .map((p) => ({
      lat: p.lat ?? null,
      lng: p.lng ?? null,
      alt: p.alt ?? null,
      ts: p.ts ?? null,
    }));

  return {
    ...serializeFlightBasic(flight),
    airline: flight.airlineName || flight.airlineIcao || "Unknown",
    aircraft: flight.aircraftModel || flight.aircraftCode || "Unknown",
    origin: flight.originAirportName || flight.originAirportIata || "N/A",
    destination: flight.destinationAirportName || flight.destinationAirportIata || "N/A",
    origin_icao: origin.icao ?? null,
    destination_icao: destination.icao ?? null,
    origin_iata: origin.iata ?? null,
    destination_iata: destination.iata ?? null,
    trail: trailSorted,
  };
}

/** FlightRadarAPI呼び出しの例外を共通処理するラッパー */
function withFrErrorHandling(name: string, handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return async (req, res, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (e) {
      console.error(`FlightRadarAPI error in ${name}:`, e);
      res.status(503).json({ error: "flightradar_unavailable", detail: String((e as Error).message || e) });
    }
  };
}

app.get(
  "/api/flights",
  withFrErrorHandling("getFlights", async (req, res) => {
    const bounds = resolveBounds(req, res);
    if (!bounds) return;

    const boundsParam = frApi.getBounds(bounds);
    const flights = await frApi.getFlights(null, boundsParam);
    res.json(flights.map(serializeFlightBasic));
  })
);

app.get(
  "/api/flight/:flightId",
  withFrErrorHandling("getFlightDetails", async (req, res) => {
    const { flightId } = req.params;
    const bounds = resolveBounds(req, res);
    if (!bounds) return;

    const boundsParam = frApi.getBounds(bounds);
    const flights = await frApi.getFlights(null, boundsParam);
    const target = flights.find((f) => String(f.id) === String(flightId));

    if (!target) {
      res.status(404).json({ error: "Flight not found in current bounds" });
      return;
    }

    const rawDetails = await frApi.getFlightDetails(target);
    target.setFlightDetails(rawDetails);

    res.json(serializeFlightDetailed(target, rawDetails));
  })
);

app.get(
  "/api/search",
  withFrErrorHandling("searchByRegistration", async (req, res) => {
    const registration = String(req.query.registration || "").trim().toUpperCase();
    if (!registration) {
      res.status(400).json({ error: "registration parameter is required" });
      return;
    }

    // registration検索はboundsを指定しない(= 全世界対象)。bounds限定検索より高速。
    // ただしユーザーの明示的な検索操作時のみ呼ぶこと。ポーリングには絶対に組み込まない。
    const flights = await frApi.getFlights(null, null, registration);

    if (!flights || flights.length === 0) {
      res.status(404).json({
        error: "not_found",
        detail: `${registration} は現在飛行中の機体として見つかりませんでした`,
      });
      return;
    }

    res.json(serializeFlightBasic(flights[0]));
  })
);

// === 機体写真(Planespotters.net 非公式API プロキシ) ===
const PLANESPOTTERS_API_BASE = "https://api.planespotters.net/pub/photos/reg";
const PHOTO_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24時間

const photoCache = new Map<string, { data: PhotoResult; ts: number }>();

/**
 * Planespotters.netから登録番号で写真を検索する。
 * 非公式APIのため、失敗・タイムアウト・0件は全て found: false として
 * 呼び出し元では例外を出さない(フロント側の表示を止めないため)。
 *
 * 重要: User-Agentに連絡先URL/メールを含めないと403で弾かれる
 * (https://www.planespotters.net/photo/api を参照)。
 */
async function fetchAircraftPhoto(registration: string): Promise<PhotoResult> {
  const now = Date.now();
  const cached = photoCache.get(registration);
  if (cached && now - cached.ts < PHOTO_CACHE_TTL_MS) {
    return cached.data;
  }

  let result: PhotoResult = { found: false };
  try {
    const response = await fetch(`${PLANESPOTTERS_API_BASE}/${encodeURIComponent(registration)}`, {
      headers: {
        "User-Agent": "flight_tracer/1.0 (+https://github.com/Neko-Kuroi/flight_tracer)",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const data = (await response.json()) as PlanespottersResponse;
      const photos = data.photos || [];
      if (photos.length > 0) {
        const photo = photos[0];
        const thumb = photo.thumbnail || photo.thumbnail_large || {};
        result = {
          found: true,
          thumbnail_url: thumb.src ?? null,
          photographer: photo.photographer ?? null,
          link: photo.link ?? null,
        };
      }
    }
  } catch (e) {
    console.warn(`Planespotters photo fetch failed for ${registration}:`, e);
  }

  photoCache.set(registration, { data: result, ts: now });
  return result;
}

app.get("/api/photo/:registration", async (req, res) => {
  const reg = String(req.params.registration || "").trim().toUpperCase();
  if (!reg || reg === "N/A") {
    res.json({ found: false });
    return;
  }
  const result = await fetchAircraftPhoto(reg);
  res.json(result);
});

// SPAのルーティング用フォールバック(APIパス以外はindex.htmlを返す)
//if (hasStaticBuild) {
//  app.get(/^(?!\/api\/).*/, (req, res) => {
//    res.sendFile(path.join(STATIC_DIR, "index.html"));
//  });
//}
// vercel 向け
if (hasStaticBuild && !process.env.VERCEL) {
  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.sendFile(path.join(STATIC_DIR, "index.html"));
  });
}
const PORT = process.env.PORT ? Number(process.env.PORT) : 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[起動確認] Flight Tracer server listening on port ${PORT}`);
  console.log(`[起動確認] static build: ${hasStaticBuild ? STATIC_DIR : "見つかりません(APIのみ)"}`);
});

// vercel 向け
export default app;