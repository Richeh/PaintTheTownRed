# Chrome Web Store submission checklist

## Before packaging

- Pull the latest `main` branch.
- Confirm the hosted Supabase project has all repository migrations applied.
- Confirm anonymous sign-in is enabled if anonymous onboarding is still desired.
- Verify `chrome-extension/manifest.json` has the intended release version.
- Verify `assets/logo/townred.png` is the intended store/extension icon.

## Build and package

From `chrome-extension/`:

```bash
npm install
npm run package
```

This creates:

```text
dist/
  manifest.json
  map-hook.js
  content.js
  icons/
    icon-16.png
    icon-32.png
    icon-48.png
    icon-128.png

release/
  town-red-rightmove-<version>.zip
```

Upload the ZIP from `release/` to the Chrome Web Store.

## Clean-install test

Before uploading, test the exact `dist/` build as an unpacked extension:

1. Remove/disable the previously installed Town Red extension and Tampermonkey Town Red script.
2. Load `chrome-extension/dist/` as an unpacked extension.
3. Open a supported Rightmove map page.
4. Confirm the Town Red toolbar appears.
5. Confirm the Google Map reaches a connected geographic state.
6. Join a map with a fresh invitation.
7. Confirm existing paint strokes render.
8. Pan and zoom significantly and confirm strokes remain geographically aligned.
9. Paint red and blue strokes and confirm they persist after reload.
10. Confirm another client receives new strokes through Realtime.
11. Confirm Refresh reconciles data correctly.
12. Confirm owner/editor/viewer permissions behave correctly.
13. Reload the Rightmove page and confirm the anonymous session persists without errors.
14. Check the console for uncaught errors.

## Web Store listing

- Use the copy in `STORE_LISTING.md` as a starting point.
- Set distribution to **Unlisted** for the first friends-and-family release if desired.
- Supply at least the required screenshots/store artwork in the Web Store dashboard.
- Use the deployed Town Red `/privacy.html` page as the privacy-policy URL.
- Complete the Privacy Practices declarations to match the actual data described in the policy.

## Versioning future releases

For every update:

1. Increment `version` in `chrome-extension/manifest.json`.
2. Keep `chrome-extension/package.json` version aligned for clarity.
3. Run `npm run package` again.
4. Clean-install or reload-test the new `dist/` build.
5. Upload the newly generated ZIP.

Never reuse an already-published manifest version.
