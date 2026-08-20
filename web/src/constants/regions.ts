import type { Bounds } from "../types/flight";

export const REGIONS: Record<string, Bounds> = {
  japan: { tl_y: 46, tl_x: 122, br_y: 24, br_x: 146 }, // area=528
  us_west: { tl_y: 49, tl_x: -125, br_y: 32, br_x: -114 }, // area=187
  us_east: { tl_y: 47, tl_x: -85, br_y: 25, br_x: -66 }, // area=418
  south_america: { tl_y: -10, tl_x: -58, br_y: -35, br_x: -38 }, // area=500
  europe: { tl_y: 55, tl_x: -5, br_y: 36, br_x: 25 }, // area=570
  middle_east: { tl_y: 35, tl_x: 35, br_y: 15, br_x: 58 }, // area=460
  africa_north: { tl_y: 33, tl_x: 25, br_y: 15, br_x: 45 }, // area=360
  africa_south: { tl_y: -15, tl_x: 15, br_y: -35, br_x: 35 }, // area=400
  east_asia: { tl_y: 42, tl_x: 110, br_y: 22, br_x: 130 }, // area=400
  oceania: { tl_y: -10, tl_x: 140, br_y: -38, br_x: 155 }, // area=420
  south_asia: { tl_y: 32, tl_x: 68, br_y: 8, br_x: 90 }, // area=528 (インド)
  southeast_asia_w: { tl_y: 20, tl_x: 95, br_y: 0, br_x: 108 }, // area=260 (タイ・ベトナム方面)
  southeast_asia_e: { tl_y: 15, tl_x: 108, br_y: -8, br_x: 125 }, // area=391 (フィリピン・インドネシア方面)
  uk_ireland: { tl_y: 60, tl_x: -11, br_y: 49, br_x: 2 }, // area=143
  russia_west: { tl_y: 60, tl_x: 28, br_y: 45, br_x: 55 }, // area=405 (モスクワ方面)
  canada_east: { tl_y: 55, tl_x: -85, br_y: 42, br_x: -60 }, // area=325 (トロント・モントリオール方面)
  mexico_centam: { tl_y: 25, tl_x: -105, br_y: 8, br_x: -80 }, // area=425
  china_east: { tl_y: 42, tl_x: 108, br_y: 20, br_x: 125 }, // area=374
};

export const REGION_LABELS: Record<string, string> = {
  japan: "🇯🇵 日本",
  us_west: "🇺🇸 アメリカ西海岸",
  us_east: "🇺🇸 アメリカ東海岸",
  south_america: "🇧🇷 南米(ブラジル・アルゼンチン)",
  europe: "🇪🇺 西ヨーロッパ",
  middle_east: "🌍 中東",
  africa_north: "🇪🇬 北アフリカ",
  africa_south: "🇿🇦 南部アフリカ",
  east_asia: "🌏 東アジア",
  oceania: "🇦🇺 オセアニア",
  south_asia: "🇮🇳 南アジア(インド)",
  southeast_asia_w: "🇹🇭 東南アジア西部(タイ・ベトナム)",
  southeast_asia_e: "🇵🇭 東南アジア東部(フィリピン・インドネシア)",
  uk_ireland: "🇬🇧 英国・アイルランド",
  russia_west: "🇷🇺 ロシア西部(モスクワ方面)",
  canada_east: "🇨🇦 カナダ東部",
  mexico_centam: "🇲🇽 メキシコ・中米",
  china_east: "🇨🇳 中国東部(上海・北京方面)",
};

/** 与えられた座標に最も近いプリセットリージョンのキーを返す */
export function findNearestRegion(lat: number, lng: number): string | null {
  let nearest: string | null = null;
  let minDist = Infinity;
  for (const [key, r] of Object.entries(REGIONS)) {
    const centerLat = (r.tl_y + r.br_y) / 2;
    const centerLng = (r.tl_x + r.br_x) / 2;
    const dist = Math.sqrt((lat - centerLat) ** 2 + (lng - centerLng) ** 2);
    if (dist < minDist) {
      minDist = dist;
      nearest = key;
    }
  }
  return nearest;
}
