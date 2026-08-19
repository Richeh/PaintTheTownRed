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

Vite listens on all interfaces at port `5173`.

Typical local URL:

```text
http://localhost:5173
```

The local Supabase Auth configuration in `../supabase/config.toml` allows this origin.

## Current capabilities

The standalone application now supports:

- anonymous Supabase authentication;
- friendly collaborator display profiles;
- creating shared maps;
- joining maps by token or shareable `?invite=` URL;
- owner-created editor/viewer invitations;
- MapLibre navigation with OpenStreetMap raster tiles;
- red, blue and erase painting with geographic brush widths;
- ordered stroke rendering and erase compositing;
- Supabase Realtime updates plus periodic reconciliation;
- per-collaborator layers with browser-local visibility preferences;
- viewer/editor/owner permissions enforced by Supabase RLS.

Town Red's paint is rendered on a transparent canvas above MapLibre. This preserves ordered red / blue / erase compositing while strokes remain stored as geographic latitude/longitude points with brush widths in metres.

## Profiles and privacy

`public.profiles` stores only application-level profile data such as a display name. Authentication identity, including any future email address used to make an account persistent, remains owned by Supabase Auth rather than duplicated into the profile table.

Profile RLS permits users to update only their own profile and limits display-name reads to people who share access to a Town Red map.

## Database migrations

See `../supabase/README.md` for the local reset, hosted-project baseline, and `db push` workflow.

## Production build

```bash
npm run build
```

The static production bundle is written to `web/dist/`.

To inspect that bundle locally:

```bash
npm run preview
```
