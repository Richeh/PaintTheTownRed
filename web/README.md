# Town Red web frontend

The standalone Town Red client is a Vite-powered, framework-free JavaScript application styled with Tailwind CSS and rendered with MapLibre GL JS.

## Requirements

- Node.js and npm
- A Supabase project, or the local Supabase CLI stack from the repository root

## Install

From `web/`:

```bash
npm install
cp .env.example .env
```

The checked-in `.env.example` points at the current hosted Town Red Supabase project using its frontend-safe publishable key. To develop against local Supabase instead, run `npx supabase status` from the repository root and replace the URL/key in `web/.env` with the local API URL and anon key it reports.

Never put a Supabase secret/service-role key in a Vite environment variable or browser bundle.

## Development server

```bash
npm run dev
```

Vite listens on all interfaces at port `5173` so the app can be opened from another device on the development network when required.

Typical local URL:

```text
http://localhost:5173
```

The local Supabase Auth configuration in `../supabase/config.toml` allows this origin.

## Map renderer

The standalone map uses MapLibre GL JS. The current basemap style is OpenFreeMap's Liberty style, which does not require an application API key.

Town Red's paint is rendered on a transparent canvas above MapLibre rather than being converted to ordinary map line layers. This preserves the same ordered red / blue / erase compositing model as the Rightmove prototype while still using geographic latitude/longitude points and brush widths stored in metres.

The frontend currently:

- lists shared maps visible to the authenticated/anonymous Supabase identity;
- loads strokes in their database sequence order;
- fits MapLibre to the selected overlay;
- reprojects paint while panning and zooming;
- receives new strokes through Supabase Realtime;
- performs periodic authoritative refreshes to reconcile remote deletes/undo operations.

MapLibre GL JS v6 requires a separate worker URL when bundled with Vite. `src/map.js` uses Vite's `?worker&url` pipeline for the packaged MapLibre worker so both development and production builds load vector tiles correctly.

## Production build

```bash
npm run build
```

The static production bundle is written to `web/dist/`.

To inspect that bundle locally:

```bash
npm run preview
```

## Current limitation

The standalone client is currently a renderer/viewer. Painting and editing from the standalone MapLibre view is the next frontend milestone; those writes will use the same Supabase stroke records as the Rightmove integration.
