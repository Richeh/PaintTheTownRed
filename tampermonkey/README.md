# Town Red — Rightmove Tampermonkey prototype

This directory contains the current Town Red proof-of-concept integration for Rightmove:

- `town-red-rightmove.user.js`

It adds a geographically anchored paint layer to Rightmove's property map. Red, blue and erase strokes are stored as latitude/longitude data in Supabase, so the overlay remains aligned while the underlying map is panned and zoomed and can be shared between collaborators.

## Install

1. Install the Tampermonkey browser extension.
2. Open `town-red-rightmove.user.js` from this repository.
3. Copy its contents into a new Tampermonkey userscript and save it.
4. Open a supported Rightmove map page and reload it.

The userscript currently matches Rightmove's property-for-sale map URLs declared in its metadata header.

## Supabase

The userscript contains the Town Red Supabase **project URL** and **publishable key**. This is intentional: a browser client necessarily has access to both values, and the publishable key is not treated as a server secret.

Access control is enforced by the Row Level Security policies and RPC authorization in `../supabase/migrations/`.

Never put a Supabase secret key or service-role key in this userscript.

For a different Supabase project, change `SUPABASE_URL` and `SUPABASE_KEY` near the top of the script and apply the repository's Supabase migrations to that project.

Anonymous sign-ins must be enabled in Supabase Auth. The repository's local `supabase/config.toml` enables them for local development; the hosted project setting must also be enabled separately.

## Current workflow

On first use, Town Red creates an anonymous Supabase Auth identity and persists its session in Tampermonkey storage.

From the toolbar you can:

- create a shared map;
- paint red or blue geographic areas;
- erase earlier paint;
- create editor/viewer invitations;
- join a map using an invitation token;
- undo your own latest stroke;
- refresh the authoritative stroke set from Supabase.

New strokes are propagated through Supabase Realtime. A periodic reconciliation fetch also picks up changes such as remote deletes.

## Local data

Tampermonkey storage is used for:

- the Supabase anonymous-auth session;
- painter settings;
- a local stroke cache for faster rendering.

The shared Supabase database remains authoritative. Clearing Tampermonkey/browser extension storage will lose the local anonymous identity, so an anonymous owner should currently be treated as tied to that browser profile. A later Town Red version can allow an anonymous identity to be upgraded to a portable email-based identity.

## Development status

This is the working integration prototype, not the final browser extension. Its main purpose is to prove the geographic overlay, collaboration, permissions and Rightmove integration while Town Red's standalone web application and eventual extension are developed.
