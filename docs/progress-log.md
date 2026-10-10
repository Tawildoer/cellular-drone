# Progress log

What each working session delivered, newest first. Commit hashes link to the change on GitHub. Add an entry when work lands; tick the matching boxes in [the plan](PLAN.md) in the same change.

## 2026-10-10: Mac app

- **Ground Control** (ADR-0027): an Electron Mac app in `desktop/` running the same UI build as the web app, which stays first-class for phones and any browser. Ad-hoc signed `.dmg` for Apple Silicon, cell-tower icon.
- **Over-the-air updates**: `npm run deploy` now also publishes `app-manifest.json` (every UI file with its SHA-256). The app downloads and checks new versions, then offers *Update ready · Reload*; it never reloads mid-flight. Only shell changes need a new `.dmg`.
- **Starts offline** from the newest copy it has, or the one built in. *Develop → Live from Local Dev Server* (⌘⇧D) loads localhost:5173.
- **Native bridge**: the page stays sandboxed; `desktop/src/preload.ts` → `web/src/app/desktopBridge.ts` is the whole native surface, ready for the serial ground radio, offline maps and background alerts.

## 2026-10-10: gimbal, free fly, battery and weather

All in the console and the mock drone; the agent rejects the new commands until it implements them, and the battery-return FC script is still to write and prove in SITL.

- **Gimbal line of sight** (ADR-0023): a faint black line from the aircraft to where the camera points, landing on the terrain. **Click the map to lock the gimbal** onto a spot within 500 m (ring on the map, *Gimbal locked · Release* chip); it releases by itself past 500 m. While circling a loiter the camera watches its centre (ADR-0024).
- **Free fly** (ADR-0024): hold to take over an airborne drone; double-click the map to add waypoints at 60 m, flown as a rolling AUTO mission held on the FC; it circles the last one until given another. Click a waypoint to make it a loiter or delete it.
- **Battery** (ADR-0025): the drone returns home by itself when its battery is down to what the trip home needs plus a 15 % reserve; a screen-filling warning asks the operator to turn round first; the planner and free fly say when a route won't fit the charge.
- **Weather** (ADR-0026): wind as moving streaks (Open-Meteo, 80 m) and rain radar (RainViewer) on the map; a Wind tile in the top bar (measured if the drone reports it, else the forecast); the route tinted by headwind, and every time and battery estimate allowing for the wind.
- **Console**: one long liquid-glass top bar with hover drawers on every metric, chase-view orbit around the drone in follow mode, map controls in one column, flight progress bottom-left, recenter fits what's left of the mission, the planned mission only shown while it's being flown.
- **Mock vs ArduPlane**: the mock now flies ArduPlane's glide slope (height changing evenly along a leg); the drawn path starts at takeoff height.
- **Dev**: edits to the protocol, links or domain reload the page instead of hot-swapping (a live mock drone kept the old decoder and refused new commands).

## 2026-10-09: operator awareness

- **Flight progress panel**: the item being flown and how far it is (or the climb for a takeoff), time and distance left in the mission, and the way home, at the planner's ArduPlane figures. It only estimates for the mission the vehicle reports flying.
- **Banners** for flight-controller failsafes (battery and geofence as alarms; RC loss as a warning, since in AUTO the mission continues) and for **stale telemetry**: after 3 s without an update the screen says it's showing the last known state, and the aircraft fades on the map. Telemetry age is timed by the browser's clock, so a drone clock that's off can't hide it.
- **Command bar feedback**: commands show "Sending…" then "accepted" or the reason they failed; hovering a disabled button says why (preflight items, "Arm first", "Already flying", "On the ground"). Start is now disabled in the air, as `mission.start` is a ground command.
- **Progress panel redesign**: mission name with a state chip, one progress segment per item (the current one filling along its leg), the item being flown with its icon, and big figures for time and distance left and to home.
- **Map**: flown-through waypoints stay on the map in green (their legs still disappear); the recenter button fits the whole mission, home and the drone in view, clear of the panels, where it used to drop to a fixed close zoom for any mission larger than a few kilometres.
- **Map feel**: dragging the map from the space beside a panel pans instead of highlighting text (the panels' layout containers no longer catch the pointer, and the console overlay isn't text-selectable); the flight trail fades out towards its oldest end (a gradient when zoomed out, a darkening taper in 3D) instead of its tail jumping forward each update.
- **Bars as islands over a full-screen map**: the map fills the screen; the flight metrics (with the ☰ menu) sit in a compact island flush to the top-left, Plan mission / Disconnect top-right, and the commands with the preflight check bottom-left, each only as wide as its contents. Every metric is its own lighter tile at a fixed width measured for its longest value, so nothing shifts as values change; self-explanatory values show just their icon, the rest short labels (Mode, VTOL, Alt, Spd, Hdg). Fits at 1280 px.
- **Menu (☰)**: the mission chooser, event log, flight log, link quality and (for the simulated drone) simulator controls moved off the map into a drawer that slides out on the left; the map keeps only what flying needs. The follow camera also steers by the direction flown, so it no longer wobbles with the nose.
- **Less clutter, a flight log**: the progress panel only shows while a mission is being flown, and goes once it's landed. Each flight, takeoff to touchdown, is kept in a new flight log (clock button, left): mission, time, duration, distance, highest altitude, how far through the plan, battery used, and how it ended (completed, returned early, QLAND, pilot took over). Kept in this browser; the drone keeps its own fuller log.
- **Follow drone**: a button under recenter keeps the camera on the aircraft, as a third-person chase view 30° above the horizon or top-down, both turned so the aircraft's heading is up the screen; the choice is remembered. Every screen frame draws the aircraft and camera part-way between the last two telemetry updates (one update, ~100 ms, behind), so it glides instead of stepping 10 times a second. Dragging the map or recentering stops it.
- **"Home in"**: the progress panel's first figure is now when the aircraft will be home following the mission (or "Mission left" if it ends with a landing elsewhere), next to "RTL now" for the direct way. Loiters count properly: only the laps left of the one being circled (tracked from the angle swept around its centre), and clock-mode loiters to their real end time. While circling it shows "lap 3 of 100" or "until 14:30".
- **Trail fades by age**: each piece of trail stays for 40 s, then fades out over 20 s, instead of being cut off at a fixed number of points.
- **Docs on the domain**: https://drone.tomwildoer.com/docs/, built into the demo's Cloudflare deploy (ADR-0016 addendum); the demo redeployed with everything above.
- **The repository is public** under Apache-2.0, with this site on GitHub Pages and private vulnerability reporting on. The GitHub repo was recreated so no pre-rewrite commit stays reachable.
- **Fixed: the demo drone's route wasn't shown** (since 2026-10-06): the mock announced "connected" before loading its mission, so the app's download found nothing. Now loaded first, with a regression test.

## 2026-10-08: SITL end to end, planner terrain tools, RC switch

- **Browser → agent → ArduPlane SITL, flown end to end** ([`ea5180b`](https://github.com/Tawildoer/cellular-drone/commit/ea5180b)). SITL in Docker with the project's params and the two FC Lua scripts; the agent's MAVLink link, command whitelist, and mission/fence upload with readback. The Playwright SITL suite (`npm run e2e:sitl`) ran for the first time and passed.
- **Agent flight log** ([`16fe84b`](https://github.com/Tawildoer/cellular-drone/commit/16fe84b)): one JSONL file per start with every session, command, upload and FC event, plus state samples, written with or without a browser. Its first use found a race in the RC takeover test (ArduPlane reports VTOL state FW on the ground in FBWA), now fixed.
- **Planner: height profile and Follow terrain** ([`8a0b7f6`](https://github.com/Tawildoer/cellular-drone/commit/8a0b7f6), ADR-0021). The route side-on over MapTiler terrain, with lowest-clearance and loiter-circle warnings, and distance and time at ArduPlane's figures. *Follow terrain at X m* sets heights from the terrain and adds waypoints over ridges. The ArduPilot mission panel was removed as clutter.
- **HUD link strength as a smooth line**: a continuous 0–100% score over the last 10 s, sampled four times a second; the mock now reports realistic LTE conditions so the demo shows it.
- **RC mode switch read directly** ([`9c4cb9c`](https://github.com/Tawildoer/cellular-drone/commit/9c4cb9c)): the agent reads `FLTMODE_CH`, reports the switch position, treats the switch off AUTO as a takeover, and only starts a mission with it at AUTO. The SITL test pilot now moves the simulated switch. All three SITL tests pass (5.6 min).
- **Docs**: ADR-0021, this site.
- **Open source** (ADR-0022): Apache-2.0, `SECURITY.md`, a new README, the docs on GitHub Pages. The agent now refuses every browser session until server-signed tokens exist, unless started with `-insecure-dev-tokens` (SITL and bench only). History scrubbed of real IP addresses and personal email before the repo went public.

## 2026-10-07: ArduPilot becomes the reference

- **Link quality readout** ([`7b2335a`](https://github.com/Tawildoer/cellular-drone/commit/7b2335a)): strength tile, quality panel with sparklines, IP version, path, fps, loss and jitter graded for supervising a drone. The agent's encoder now sends RTP itself, and ICE can be served from one forwarded port. IPv6 hotspot-to-home test recorded.
- **Missions map onto ArduPlane / MAVLink** ([`05d43d8`](https://github.com/Tawildoer/cellular-drone/commit/05d43d8), ADR-0017): `docs/MAVLINK.md`; an authoritative Go translator in the agent and a TypeScript preview, both held to shared golden files; vehicle readback after upload.
- **Decisions**: Orange Pi 5 air unit (ADR-0018), staged obstacle avoidance through the FC (ADR-0019), no GCS failsafe with time-limited pauses that rejoin the plan (ADR-0020), clock-mode loiters as an FC Lua script.

## 2026-10-06: public demo

- **Cloudflare deploy** ([`c4d4f49`](https://github.com/Tawildoer/cellular-drone/commit/c4d4f49), ADR-0016): the mock UI live at drone.tomwildoer.com.
- **Demo drone and readable maps** ([`8c2bcc0`](https://github.com/Tawildoer/cellular-drone/commit/8c2bcc0)): a Demo Drone already airborne on a patrol in every build; MapLibre's worker bundled (overlays were missing in production); flat overlays when zoomed out.

## 2026-10-05: the console and the real link

- **Flight console against MockLink** ([`afb14b4`](https://github.com/Tawildoer/cellular-drone/commit/afb14b4)): the operator console, mission planning with waypoints and timed loiters, 3D path, physically flown guidance, preflight checklist, and `mock-agent` as a standalone simulated drone (ADR-0012 to ADR-0014).
- **WebRTC link slice** ([`026f811`](https://github.com/Tawildoer/cellular-drone/commit/026f811)): Go + Pion agent on a Raspberry Pi 5, signalling relay, `WebRtcLink`. Direct on a LAN; no direct IPv4 path from a phone hotspot, so IPv6 becomes the intended direct path and TURN goes on hold (ADR-0015).

## 2026-10-02: plan and architecture

- **Project plan, architecture and decision log** ([`5c78d7f`](https://github.com/Tawildoer/cellular-drone/commit/5c78d7f)): phases, safety model, command model.
- **Transport and air unit** ([`b854746`](https://github.com/Tawildoer/cellular-drone/commit/b854746)): WebRTC peer to peer with TURN fallback, a permanent RC override (ADR-0008), the manual-control rule clarified.
- **Frontend first** ([`7eeb07a`](https://github.com/Tawildoer/cellular-drone/commit/7eeb07a), ADR-0009): the transport-agnostic `VehicleLink` contract the UI is built on.
