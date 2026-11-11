# chce.to
## iPhone share-sheet shortcut

`chce.shortcut` fetches `js/shortcut.js` from the published site at run time, so a fix to `js/extract.js` reaches it after a deploy. After changing `js/extract.js`:

```sh
node scripts/build-shortcut.mjs                 # rewrites js/shortcut.js (a unit test fails when it is stale)
node scripts/build-shortcut.mjs /tmp/chce.plist # only when the shortcut's own actions change
shortcuts sign --mode anyone --input /tmp/chce.plist --output chce.shortcut
```
