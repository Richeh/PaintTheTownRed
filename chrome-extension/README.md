# Town Red Chrome extension

This directory builds the working Rightmove integration as a Manifest V3 Chrome extension.

The Tampermonkey userscript remains the source of truth for the Rightmove overlay behaviour. The extension build reads `../tampermonkey/town-red-rightmove.user.js`, removes userscript metadata, swaps the Tampermonkey-specific environment pieces for extension-compatible equivalents, bundles Supabase locally, adds the early Google Maps hook and icons, and writes a loadable extension to `dist/`.

## Runtime architecture

Town Red needs access to the Google Maps objects created by Rightmove so it can use `OverlayView` projections. The extension therefore runs a tiny `map-hook.js` first at `document_start` and then the bundled Town Red client. Both currently run in Chrome's `MAIN` world because that is the proven integration path from the Tampermonkey prototype.

A later hardening refactor can move Supabase/application state into an isolated content-script world and leave only a projection bridge in `MAIN`. That is not required for the current release and is deliberately deferred until after the first packaged release is proven.

## Install dependencies

```bash
npm install
```

## Development build

```bash
npm run build
```

This produces an unpacked extension in `dist/` with inline source maps for easier local debugging.

## Production/Web Store package

```bash
npm run package
```

This performs a clean minified production build with no source map, generates Chrome icons from `../assets/logo/townred.png`, and creates a ZIP suitable for Chrome Web Store upload.

Output:

```text
dist/
├── manifest.json
├── map-hook.js
├── content.js
└── icons/
    ├── icon-16.png
    ├── icon-32.png
    ├── icon-48.png
    └── icon-128.png

release/
└── town-red-rightmove-<version>.zip
```

The ZIP root is the extension root; it contains runtime files only.

## Load unpacked in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `chrome-extension/dist/`.
5. Open or reload a supported Rightmove property map page.

After rebuilding, click the extension's **Reload** button on `chrome://extensions` and reload Rightmove.

## Development watch

```bash
npm run dev
```

This watches the Tampermonkey source, extension manifest and source icon. Chrome still needs its extension Reload button pressed after a rebuild.

## Icons

The canonical icon assets live in:

```text
../assets/logo/townred.png
../assets/logo/townred.svg
```

The PNG is the source for generated 16, 32, 48 and 128 pixel extension icons. Do not edit generated `dist/icons/` files.

## Storage

The shared userscript currently expects synchronous `GM_getValue`, `GM_setValue`, and `GM_deleteValue` calls. The extension implements those calls with a Town-Red-prefixed Rightmove `localStorage` namespace. This preserves the proven authentication/cache behaviour but means the extension and Tampermonkey prototype use separate anonymous identities and settings.

## Permissions

The manifest intentionally avoids broad Chrome API permissions. It runs only on the supported Rightmove map URL patterns and declares the Town Red Supabase project as its network host permission. Supabase's publishable key is bundled in the client by design; no secret or service-role key is included.

## Chrome Web Store material

- `STORE_LISTING.md` contains suggested listing text and permission/privacy explanations.
- `SUBMISSION_CHECKLIST.md` contains the clean-install and upload checklist.
- The standalone web app publishes `web/public/privacy.html`; deploy the web app and use its `/privacy.html` URL in the Web Store listing.

## Versioning

Increment `version` in `manifest.json` before every Web Store update. Keep `package.json` aligned for clarity. `npm run package` names the ZIP from the manifest version.

## Source relationship

Do not edit `dist/content.js`, `dist/map-hook.js`, generated icons or release ZIPs directly. Edit the Tampermonkey source for shared Rightmove behaviour, or edit `scripts/build.mjs` / `manifest.json` for extension-specific behaviour, then rebuild.
