# chce.to
## iPhone share-sheet shortcuts

Both are built by `scripts/build-shortcut.mjs` from the same `js/shortcut.js` (itself generated from `js/extract.js`) and signed with `shortcuts sign --mode anyone`.

- `chce.shortcut` ("chce", daily use): the script is pasted into the Run JavaScript action as a literal. No code is fetched at run time. After any change to `js/extract.js` it must be re-downloaded and re-imported on the phone.
- `chce-dev.shortcut` ("chce-dev", for testing): fetches `https://anks.pl/chce/js/shortcut.js` at run time, so a deploy reaches it with no re-import.

Rebuild after changing `js/extract.js` or the build script:

```sh
node scripts/build-shortcut.mjs /tmp/chce-build        # rewrites js/shortcut.js; the directory must exist, gets chce.plist and chce-dev.plist
shortcuts sign --mode anyone --input /tmp/chce-build/chce.plist --output chce.shortcut
shortcuts sign --mode anyone --input /tmp/chce-build/chce-dev.plist --output chce-dev.shortcut
```

`npm run test:unit` fails when `js/shortcut.js` is stale. On macOS it also opens both signed files and fails when they differ from the build. CI runs that part in a separate macOS job, so a stale signed file fails the pull request.
