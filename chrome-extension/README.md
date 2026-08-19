# Town Red Chrome extension

This directory builds the working Rightmove Tampermonkey prototype as a Manifest V3 Chrome extension.

The important design choice is that the Tampermonkey userscript remains the source of truth for the Rightmove integration. The build script reads `../tampermonkey/town-red-rightmove.user.js`, removes the userscript metadata, swaps the Tampermonkey-specific environment pieces for extension-compatible equivalents, bundles Supabase locally, and writes a loadable extension to `dist/`.

## Why MAIN world?

Town Red needs access to the actual Google Maps objects created by Rightmove so it can capture the map instance and use `OverlayView` projections. Tampermonkey provides that through `unsafeWindow`. A normal Chrome content script runs in an isolated JavaScript world and cannot directly access those page-owned objects, so the extension declares its content script with `"world": "MAIN"` and runs at `document_start`.

## Install dependencies

From this directory:

```bash
npm install
```

## Build

```bash
npm run build
```

This produces:

```text
dist/
├── manifest.json
└── content.js
```

Supabase is bundled into `content.js`; the extension does not load executable JavaScript from a CDN.

## Load unpacked in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `chrome-extension/dist/`.
5. Open or reload a Rightmove property map page.

The normal Town Red toolbar should appear over the Rightmove map.

After rebuilding, click the extension's **Reload** button on `chrome://extensions` and reload Rightmove.

## Development watch

```bash
npm run dev
```

This rebuilds whenever the Tampermonkey userscript or extension manifest changes. Chrome still needs its extension Reload button pressed after a rebuild.

## Storage

The Tampermonkey script currently expects synchronous `GM_getValue`, `GM_setValue`, and `GM_deleteValue` calls. MAIN-world scripts cannot directly use extension APIs such as `chrome.storage`, so the first extension version implements those calls using a Town-Red-prefixed `localStorage` namespace on Rightmove.

This keeps the conversion small and preserves the proven synchronous auth/cache behaviour. It also means the extension and Tampermonkey installation have separate anonymous identities and settings.

A later refactor can split Town Red into a small MAIN-world Google Maps bridge plus an isolated-world application script. That would let the app use `chrome.storage` and extension messaging while keeping page-object access confined to the bridge.

## Permissions

The extension intentionally asks only for access to Rightmove and the configured Town Red Supabase project. No broad browsing-history, tabs, or `scripting` permission is required because the Rightmove integration is declared as a static content script.

## Source relationship

Do not edit `dist/content.js` directly. Edit the Tampermonkey source when changing shared Rightmove behaviour, or edit `scripts/build.mjs` / `manifest.json` for extension-specific behaviour, then rebuild.
