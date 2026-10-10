# Ground Control (Mac app)

**Ground Control** is the operator console as a Mac app (ADR-0027): the same UI as the web app at
drone.tomwildoer.com, in its own window, starting without the internet and
updating itself over the air. The web app stays the way to fly from a phone or
any browser.

## How updates work

- `npm run deploy` (in `web/`) publishes the site **and** `app-manifest.json`:
  every UI file with its size and SHA-256.
- The app checks that manifest at launch, every 10 minutes and when you switch
  back to it. A newer build downloads in the background; every file is checked
  against the manifest before it's kept (in `~/Library/Application
  Support/Ground Control/bundles`, the last two versions).
- Then **Update ready · Reload** appears. Reload switches to it; *Later* keeps
  the current one until the next launch. It never reloads by itself, so an
  update can't interrupt a flight.
- Offline, it starts from the newest copy it has, or the one built into the app.

So a UI change goes live on the web and in the Mac app with one deploy. Only
changes to the app shell itself (`desktop/src`) need a new `.dmg`.

## Build and run

```sh
npm install
npm start          # build the shell and run it against app-bundle/
npm run bundle     # build web/ and copy it in as the built-in UI
npm run dist       # bundle + a .dmg in release/ (Apple Silicon)
```

`DRONE_UPDATE_ORIGIN=http://127.0.0.1:8799 npm start` checks for updates
somewhere else, e.g. `python3 -m http.server 8799 --directory ../web/dist`.

The app is ad-hoc signed, not notarised (it isn't distributed through the App
Store). A copy built on this Mac runs as is; a `.dmg` downloaded onto another
Mac needs right-click → Open the first time.

## Security

The page runs sandboxed, with no Node or file access. Its only native calls are
in `src/preload.ts` (version, update ready, reload); links to other sites open
in the browser. Native features (the serial radio link, offline maps, alerts
in the background) are to be added there, one narrow call at a time.

## Icon

`build/icon.svg` is the source (a cell tower). `scripts/make-icon.sh`
renders it with Electron and builds `build/icon.icns`.

