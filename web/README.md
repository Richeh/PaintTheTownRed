# Town Red web frontend

The standalone Town Red client is a Vite-powered, framework-free JavaScript application.

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

## Production build

```bash
npm run build
```

The static production bundle is written to `web/dist/`.

To inspect that bundle locally:

```bash
npm run preview
```

## Current scaffold

The application currently provides:

- a Vite development/build environment;
- frontend Supabase configuration through environment variables;
- persisted Supabase browser sessions;
- automatic anonymous sign-in;
- a minimal Town Red application shell ready for the standalone map renderer.

The next frontend milestone is the standalone map plus shared-map/stroke loading.
