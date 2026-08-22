# Town Red

Town Red is a collaborative geographic overlay for house hunting. Users can paint preference areas, add labelled points, share maps with friends, and use the Chrome extension to add Rightmove properties directly from Rightmove's map.

This README is intentionally a code map as much as a setup guide. The project has several browser/database pieces that cooperate, and the comments in each source file explain the local details.

## Architecture at a glance

### Web app — `web/`

The web client is **Vue 3 + Vite + Tailwind + MapLibre + Supabase**.

- `web/src/App.vue` — application controller for maps, strokes, invites, profile onboarding and renderer lifecycle.
- `web/src/main.js` — mounts the main Vue app and the deliberately separate authentication dock.
- `web/src/map.js` — framework-agnostic MapLibre/canvas renderer, collaborator layers and point-marker UI.
- `web/src/data.js` — the database/realtime boundary. Vue components should not build PostgREST queries directly.
- `web/src/supabase.js` — the authentication boundary: anonymous-first sessions, identity claiming and email OTP sign-in.
- `web/src/components/` — small Vue dialogs/forms. Components generally collect/display state; `App.vue`, `data.js` and `supabase.js` own application/backend behavior.

The map renderer is intentionally not a Vue component internally. MapLibre, canvas pointer capture and DOM markers are imperative APIs, so `map.js` exposes a small public API (`setStrokes`, `setEditor`, `fitToStrokes`, `destroy`, etc.) that Vue controls.

### Collaborator layers and colours

Every contributor has one local-visibility layer on a shared map. That layer contains **both** the person's brush strokes and their point markers, so hiding a collaborator removes all of their map annotations from the current screen without changing shared data.

Each profile also has a stable pastel `marker_colour`. The database assigns the colour deterministically from the user's id and stores it on the profile, so the same person keeps the same visual identity across maps, browsers and devices. Point-marker backgrounds and layer-panel swatches use that colour.

### Authentication model

Town Red is anonymous-first.

1. A fresh browser receives a Supabase anonymous user and chooses a display name.
2. The user may continue indefinitely with that temporary identity.
3. **Save identity** attaches an email to the same Supabase user, preserving the same `auth.uid()` and therefore map ownership/memberships.
4. Supabase sends an email verification code; no password is used.
5. Returning users sign in by email OTP. `shouldCreateUser: false` prevents a mistyped address silently creating a new identity.

After a sign-in/identity transition the web app reloads deliberately. This avoids trying to move active MapLibre/realtime state from one `auth.uid()` to another in-place.

Supabase's email templates must expose `{{ .Token }}` for the code-based UI. OTP length is configurable; the client accepts numeric codes from 6–10 digits.

### Rightmove integration — `tampermonkey/` and `chrome-extension/`

`tampermonkey/town-red-rightmove.user.js` is the shared Rightmove geographic/stroke client. It:

- captures Rightmove's real Google Map instance;
- obtains a Google Maps `OverlayView` projection;
- converts screen coordinates to geographic coordinates;
- draws collaborative strokes over the Rightmove map;
- manages anonymous Supabase map membership and Realtime updates.

The Chrome extension deliberately reuses that userscript instead of maintaining a second copy of the map logic.

`chrome-extension/scripts/build.mjs` transforms the userscript for Manifest V3:

- `unsafeWindow` becomes normal `window` because the script runs in the page's MAIN world;
- Tampermonkey `GM_*` storage is shimmed with prefixed localStorage;
- `@supabase/supabase-js` is bundled locally (no remotely executed extension code);
- `chrome-extension/src/listing-capture.js` is injected to add Rightmove property-point controls;
- icons and the Web Store ZIP are generated from repository sources.

The source transforms fail loudly when an expected userscript anchor disappears. That is intentional: a failed build is safer than producing an extension that looks valid but silently lacks part of the integration.

The build helper normalises CRLF/LF line endings so the same transforms work on Windows and Linux/macOS checkouts.

### Rightmove property points

The extension decorates Rightmove's property popup with **Add to Town Red / Remove from Town Red**.

The geographic coordinate is captured synchronously from the original map click while the Google Maps projection and camera state are known to match. Rightmove creates its property popup asynchronously, so delayed callbacks are used only to identify/decorate the listing popup. A generation counter cancels stale callbacks from earlier clicks/pans.

Property markers store a canonical Rightmove `/properties/<id>` URL so Town Red markers can link back to the listing and duplicates can be identified reliably.

### Supabase — `supabase/`

Database changes are ordinary timestamped migrations under `supabase/migrations/`. The migrations are intentionally commented with their RLS/security rationale.

Core concepts:

- `maps` — owner and map metadata.
- `map_members` — editor/viewer memberships; ownership is implicit via `maps.owner_id`.
- `strokes` — immutable geographic paint operations with a database sequence for deterministic replay.
- `markers` — labelled geographic points, optionally linked to a Rightmove listing.
- `profiles` — collaborative display names and stable pastel marker colours; authentication/email remain in Supabase Auth.
- `map_invites` — hashed invite tokens with role, expiry and optional usage limits.

Row-level security is the real authorization boundary. Client-side role checks exist for UX but are never the security mechanism.

Invite creation/redemption and role lookup use database RPC functions where direct table access would expose too much or create race/security problems.

## Development

### Web client

Create `web/.env` from `web/.env.example` and provide the Supabase project URL/publishable key, then:

```bash
cd web
npm install
npm run dev
```

Production build:

```bash
npm run build
```

### Chrome extension

```bash
cd chrome-extension
npm install
npm run build
```

Load `chrome-extension/dist/` as an unpacked extension while developing.

For a production/Web Store package, use the package script defined in `chrome-extension/package.json`; the build pipeline creates a fresh production `dist/` before zipping it so stale files cannot leak into a release.

After changing the shared Tampermonkey userscript, always run the Chrome extension build too. The extension build deliberately verifies that its source-transform anchors still match.

### Supabase migrations

Use the Supabase CLI against the intended project and apply migrations in timestamp order. Do not edit a migration that has already been applied to a shared/production database; add a new migration instead.

## Important invariants for maintainers

- **Do not silently replace an established extension identity.** Map memberships are attached to `auth.uid()`. The extension keeps a separate established-user guard specifically to prevent a broken session from quietly becoming a new anonymous user.
- **Do not derive security from UI roles.** Keep authorization in RLS/security-definer functions.
- **Keep strokes ordered and immutable.** Erasing is an ordered `erase` stroke, not mutation of earlier strokes.
- **Keep points on their creator's layer.** `created_by` is the shared grouping key for both strokes and markers; layer visibility must apply to both.
- **Keep collaborator colours on profiles.** Do not copy `marker_colour` onto every marker row; profile lookup is the source of truth.
- **Store geographic sizes/positions, not display pixels.** Brush width is persisted in metres; coordinates are latitude/longitude.
- **Tear down Realtime when switching maps.** Both the web app and extension scope subscriptions to the selected map.
- **Treat Rightmove DOM as unstable.** Use canonical listing URLs and the captured Google Map/projection where possible; popup DOM is only a presentation hook.

## Repository notes

Generated dependency/build directories such as `node_modules`, extension/web `dist`, and Supabase temporary CLI state should remain ignored. Supabase migrations/configuration belong in version control; transient `supabase/.temp` does not.