# flight_tracer (TypeScript / Vite / Vue3 版)

[Neko-Kuroi/flight_tracer](https://github.com/Neko-Kuroi/flight_tracer) の Python(Flask)版と同じ機能を、
バックエンドを Express + TypeScript、フロントエンドを Vite + Vue3 + TypeScript で再構成したものです。

## 構成

```
flight_tracer_vue/
├── server/              # Express + TypeScript バックエンド (旧 app.py 相当)
│   └── src/
│       ├── index.ts         # ルーティング本体 (/api/flights, /api/flight/:id, /api/search)
│       ├── types.ts         # レスポンス型
│       └── flightradarapi.d.ts  # 型なしnpmパッケージ用のアンビエント宣言
└── web/                  # Vite + Vue3 + TypeScript フロントエンド (旧 index.html 相当)
    └── src/
        ├── App.vue                    # 状態管理・APIポーリング・地図とパネルの橋渡し
        ├── components/
        │   ├── MapView.vue            # Leafletマップ、マーカー、ポップアップ、航跡描画
        │   └── ControlsPanel.vue      # リージョン選択・検索・ウォッチリストUI
        ├── composables/
        │   ├── useFlightApi.ts        # /api/* へのfetchラッパー
        │   └── useWatchlist.ts        # localStorageベースのウォッチリスト＋通知
        ├── constants/regions.ts       # プリセットリージョン一覧・最寄りリージョン判定
        └── types/flight.ts            # フライトのレスポンス型
```

Python版との対応関係:

| Python版 (`app.py` / `index.html`) | TS版 |
|---|---|
| `DEFAULT_BOUNDS` / `MAX_BOUNDS_AREA` / `validate_bounds_area` | `server/src/index.ts` |
| `serialize_flight_basic` / `serialize_flight_detailed` | `server/src/index.ts` |
| `/api/flights`, `/api/flight/<id>`, `/api/search` | 同名のExpressルート |
| `getCurrentBoundsParam` / `onMapMoveEnd`(800msデバウンス) | `MapView.vue` |
| `REGIONS` / `REGION_LABELS` / `findNearestRegion` | `constants/regions.ts` |
| `watchList` / `checkWatchList` (localStorage + Notification API) | `composables/useWatchlist.ts` |
| `updateMap` / マーカーの差分更新・航跡ポリライン | `MapView.vue` |

## 開発時の起動方法

```bash
# バックエンド (ポート5000)
cd server
npm install
npm run dev

# 別ターミナルでフロントエンド (ポート5173、/api は自動的に5000へプロキシ)
cd web
npm install
npm run dev
```

## 本番ビルド

```bash
cd web && npm run build     # web/dist を生成
cd ../server && npm run build && npm start
# Expressが web/dist/index.html の存在を検知し、静的配信 + SPAフォールバックする
```

## 動作確認済みの点

- `server`: `tsc --noEmit` で型エラーなし。ビルド後 `node dist/index.js` で起動し、
  `web/dist` の静的配信・SPAフォールバック・`/api/search` のバリデーションエラーを実機確認済み。
- `web`: `vue-tsc -b` で型エラーなし。`vite build` で本番ビルド成功を確認済み。
- 実際のFlightRadar24への疎通は、この開発環境のネットワーク制限上未確認です。手元の環境でお試しください。
