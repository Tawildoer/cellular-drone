# Decision log

Short ADR-style entries. Add new ones at the bottom. Supersede old entries instead of editing them.

## ADR-0001: Autonomous only, ArduPilot + MAVLink (2026-10-02, accepted; amended same day)
**Decision:** The aircraft flies **autonomous missions only** on ArduPlane (QuadPlane VTOL). **No manual control is sent to it**: no RC override, no stick or gamepad input. The browser sends only mission tasking and high-level commands (arm, start, pause, RTL, QLAND). A live video downlink is wanted, but latency isn't the top priority.
**Consequences:** Safety depends on on-board failsafes, not the link.

## ADR-0002: Flight controller (2026-10-02, open)
SpeedyBee F405 WING is cheap, and you already have bootloader files for it. However, ArduPilot on 1 MB-flash F4 boards drops some features (for example Lua scripting).
**Leaning:** prototype on the F405 WING if you already own one. For the real aircraft, use an H743-class wing FC (for example Matek H743-WING). Confirm against the ArduPilot feature list for the board.

## ADR-0003: Browser access through a cloud relay with WireGuard (2026-10-02, SUPERSEDED by ADR-0005)

## ADR-0004: Tech stack (2026-10-02, accepted)
- Drone agent: **Go + Pion WebRTC** (single static binary, cross-compiles to arm64/armv7), gomavlib for MAVLink2, GStreamer (RK MPP) for H.264 on the Radxa.
- Signalling and API: TypeScript on Node 24, Fastify + `ws`, SQLite via Drizzle.
- Web: React + Vite + TypeScript, MapLibre GL. Responsive, works on mobile Safari and Chrome.
- TURN: coturn with time-limited (REST API) credentials.
- Deploy: Docker Compose on a VPS behind Caddy.
- Sim: ArduPilot SITL (ArduPlane, `-f quadplane`) in Docker.

## ADR-0005: WebRTC between drone and browser, TURN fallback (2026-10-02, accepted)
**Context:** We want lower latency, peer-to-peer where possible, and a browser app that works on any device. QuadroFleet (WireGuard + raw UDP + native app) needs a translating server for browsers.
**Decision:** The drone runs a WebRTC peer. Video is a media track (H.264). Telemetry uses an unreliable data channel; commands use a reliable one. The VPS does auth, signalling and STUN/TURN only. The drone checks a server-signed session token before accepting a peer. The command whitelist is enforced **on the drone**.
**Consequences:** Cellular CGNAT will often force TURN, which costs a small latency hit from a nearby VPS. Each viewer uses drone uplink, so cap viewers (SFU later if needed). QuadroFleet is no longer a dependency; we keep only its hardware references.

## ADR-0006: Air unit = Radxa Zero 3W companion (2026-10-02, SUPERSEDED by ADR-0018)
**Context:** WebRTC on an OpenIPC SigmaStar SoC would mean porting a WebRTC stack into buildroot, and Majestic's WebRTC support on SigmaStar is unclear. A Linux SBC runs Pion and GStreamer as-is.
**Decision:** Prototype on a **Radxa Zero 3W** (RK3566, hardware H.264/H.265 encode, ~10 g) with a USB LTE modem and a MIPI or USB camera. Keep the agent portable Go so an OpenIPC port stays possible.
**Alternatives:** Pi Zero 2W (weaker CPU, H.264 only). Pi 4/CM4 (heavier). OpenIPC SSC338Q (lightest, but more embedded work). Revisit in Phase 5.

## ADR-0007: Video codec (2026-10-02, accepted provisionally)
**Decision:** H.264. It's universal across browsers on all devices. Revisit H.265 only if uplink bandwidth turns out to be the bottleneck.

## ADR-0008: Permanent local RC override (2026-10-02, accepted)
**Decision:** An ELRS receiver wired directly to the FC is a **permanent** part of the system, not a development-only tool. The RC pilot can take control at any time by changing the mode switch, and RC always has authority over browser commands. Losing RC range during AUTO **continues the mission**. Cellular loss is handled by the GCS failsafe. The agent reports RC state and refuses browser mode changes while RC holds a manual mode.
**Consequences:** "No manual control" (ADR-0001) applies only to the cellular/browser path. The ArduPilot RC and GCS failsafe parameters must be designed together and tested in SITL (an RC-loss simulation) before flight.

## ADR-0009: Frontend first, behind a transport-agnostic contract (2026-10-02, accepted)
**Context:** The user wants to start with the UI. The backend architecture (WebRTC P2P vs relay, agent implementation) could still change.
**Decision:** Build `web/` first against an in-browser `MockLink` simulator. The UI depends only on the app-owned `domain/` types, the versioned `protocol/` messages (zod) and the `VehicleLink` / `AuthClient` / `MissionRepository` interfaces. A shared contract test suite defines correct link behaviour. The full design is in `docs/FRONTEND.md`.
**Consequences:** Swapping the backend means writing one new `VehicleLink` implementation that passes the contract tests, with no UI changes. The agent must emit the same `protocol/` messages, so the domain vocabulary (not MAVLink) is the source of truth for the UI.

## ADR-0010: UI visual language — dark sci-fi HUD, styled after God's Eye View (2026-10-03, accepted)
**Context:** Wanted the look of [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view), an open-source live-tracking 3D globe viewer, described in its own source as "Dark Sci-Fi UI — Apple meets Blade Runner": near-black background (`#0a0a0f`), frosted-glass panels (`rgba(12,12,20,0.72)` + `backdrop-filter: blur(24px) saturate(1.4)`), a cyan accent (`#00d4ff`) with a glow on active/accent text, monospace uppercase HUD labels with wide letter-spacing (JetBrains Mono), Inter for body text, 16px panel radius / 10px button radius, 150–300ms cubic-bezier transitions. GEV itself is a vanilla-JS + Cesium 3D globe app with no shared stack with `web/` (React + Vite + Tailwind + MapLibre, mobile-first, single vehicle).
**Decision:** Adopt GEV's color, typography and panel-chrome tokens as our Tailwind theme (dark-only; this look isn't designed to invert to light mode). Import none of GEV's code or the Cesium globe — only the visual tokens, ported into `src/index.css`. HUD-style elements (telemetry labels, link badge, event log) use the mono/uppercase/letter-spaced convention; body copy and form UI use Inter.
**Consequences:** Every `features/` screen built from here on reads colors/radii/fonts from the shared tokens in `src/index.css`, not ad hoc values. Revisit if a light mode is ever required — GEV's palette doesn't have one to borrow.

## ADR-0011: Live-position feed kept open for a future God's Eye View-style integration (2026-10-03, open)
**Context:** GEV ingests live contacts (aircraft, vessels, satellites, …) from public feeds, one source per layer module, each a separate module in its own codebase. For this drone to ever appear on a GEV instance (or any similar globe viewer), our `server/` (not built yet — Phase 1c) would need to publish a stable live-position feed, and a matching custom layer module would need to be added on the GEV side — a change to that separate open-source repo, out of scope here.
**Decision:** Keep `domain/VehicleState` compatible with that eventual need at zero cost today. It already carries lat/lon, both altitude references, heading (`attitude.yawDeg`) and ground speed; `vehicleId` was added so a future feed can label the contact the way GEV labels aircraft by callsign. No server endpoint is built now — there is no `server/` to put it in yet.
**Consequences:** When `server/` is built in Phase 1c, reserve a live-position endpoint (e.g. `GET /api/v1/vehicles/:id/live`) shaped as `{ vehicleId, lat, lon, altAmslM, headingDeg, groundSpeedMps, updatedAt }`, and record its final shape as a new ADR at that time. Building or wiring an actual GEV layer module is not planned work for this repo.

## ADR-0012: `mock-agent` — a standalone process stand-in for the real drone agent (2026-10-03, accepted)
**Context:** `MockLink` runs the simulated VTOL in the browser tab itself, so every page reload destroys and recreates it — the drone forgets its mission, position, and armed state on every refresh. Wanted something that "appears to the UI as a real drone" for testing path planning: a drone that keeps flying (or stays on the ground) independent of whether a browser tab is even open, the same way a real one would.
**Decision:** Extracted the simulated VTOL's state machine (command validation, failsafe/mode-change events — everything except timers, protocol encoding, and canvas video) out of `MockLink` into a transport-agnostic `DroneEngine` (`web/src/link/mock/droneEngine.ts`), reused by two callers:
- `MockLink` — unchanged behavior, still the fast in-browser default (`VITE_VEHICLE_LINK=mock`) and what the automated test suite uses.
- `mock-agent/` — a new, separate top-level Node process (own `package.json`, run with `tsx`) that constructs one `DroneEngine`, starts ticking it immediately on process start, and serves it over a plain WebSocket, broadcasting the same `protocol/` messages `MockLink` round-trips in-process. It imports `DroneEngine`/`domain`/`protocol` straight from `web/src/...` via relative paths rather than a published/workspace package — simplest thing that works today; formalizing this as a shared workspace package is explicitly deferred (see ADR-0009's `packages/protocol` note for Phase 1c).

The browser talks to it through `WsLink` (`web/src/link/ws/WsLink.ts`), a new `VehicleLink` implementation selected via `VITE_VEHICLE_LINK=ws` — request/reply correlated by the protocol envelope's `id` field. No video over this transport (`mock-agent` has no canvas); `getVideoStream()` is always null, which the UI already handles.

**Not** the real `agent/` (still reserved, Go, per the repo layout below) — `mock-agent` is a dev-only stand-in, named so no one mistakes it for Phase 1b's actual agent.
**Consequences:** `DroneEngine`'s command logic now has exactly one implementation shared by both callers, instead of risking divergence. `WsLink` is not yet wired into the automated `VehicleLink` contract-test suite (that would mean spinning up `mock-agent` during `vitest run`) — it's been verified manually end-to-end (arm → mission start → full browser reload → reconnect → still `AUTO`, still airborne, battery continuing to drain), not by an automated test. Revisit adding it to CI once that's worth the complexity.

## ADR-0013: Loiter end conditions — lap count, or a UTC time of day (2026-10-04, accepted)
**Context:** Loiter points need to end either after a number of laps or at a time ("loiter until 14:30"). The `loiter` mission item had an optional `timeS` duration that nothing honored.
**Decision:** A loiter ends by one of two mutually exclusive fields: `turns` (laps mode, default 1) or `untilUtcMinuteOfDay` (clock mode, minutes after midnight UTC, 0–1439). `timeS` is removed from the domain type and wire schema; it was optional and unused, and zod drops unknown keys, so this is not a breaking change and `v` is unchanged. The time is a time of day, not a fixed date, so a saved mission can be re-flown on another day. It is stored in UTC so the vehicle and the operator's browser can't disagree about time zones; the planner converts to and from local time. When the vehicle reaches the loiter it resolves the time to whichever occurrence lies within 12h either side of now (`resolveLoiterUntilMs`): arriving a few minutes late means "already past", never a near-24h wait. Both modes always fly at least one full lap, then peel off at the next heading that points along the next leg (at most one extra lap). The ETA estimate counts only that minimum lap for clock mode.
**Consequences:** The real `agent/` must implement the same resolution rule against its own clock, and needs a trustworthy UTC clock (GPS time) to do so. The mock drone reads the real wall clock (standing in for GPS time), not simulated time: a clock advanced by sim time ran ahead whenever the sim was sped up and never caught back up, so end times read as long past and the drone left after one lap. At raised sim speed a clock-mode loiter therefore just flies more laps before its end time.

## ADR-0014: Raspberry Pi 5 as a stand-in air unit for link work (2026-10-05, accepted)
**Context:** Want to develop and debug the real drone ↔ browser WebRTC transport before the Radxa, modem and airframe exist, under conditions close to the final setup: drone behind a NAT, browser on a different network, TURN fallback through a VPS. Planning notes are in `docs/P2P_TESTING.md`.
**Decision:** Use a Raspberry Pi 5 as a temporary air unit for transport and signalling work. This pulls a thin slice of Phase 1b (agent) and Phase 1c (signalling, coturn, `WebRtcLink`) forward, ahead of finishing the 1a UI. First network arrangement: Pi on home wifi (home NAT), laptop browser on the phone's hotspot (carrier CGNAT plus tethering NAT).
**Consequences:**
- The Pi 5 has no hardware H.264 encoder (the Pi 4 had one), so video uses software x264. Transport results are valid; CPU and encode-latency numbers do not predict the Radxa's MPP encoder.
- Same architecture as the Radxa (arm64), so the same `GOARCH=arm64` agent binary carries over.
- With the Pi on wifi and the browser on the hotspot, the constrained direction is the hotspot's download, not the drone's upload (the real bottleneck). NAT behaviour is realistic; bandwidth and latency are not until the Pi itself moves onto LTE.

## ADR-0015: IPv6 end to end is the direct path; TURN deferred (2026-10-05, accepted)
**Context:** The step 2 link test (see Link test results below) found the phone hotspot's IPv4 NAT symmetric, so with STUN alone the browser couldn't reach the Pi. Over IPv4 that means a TURN relay. The user wants the lowest possible latency and no extra infrastructure beyond what's already planned. The same hotspot's IPv6 mapping is endpoint-independent (hole-punch friendly), and the operator's main network is that phone hotspot.
**Decision:** Treat IPv6 end to end as the intended direct path:
- The drone's data SIM must provide IPv6 (BOM), ideally on the same carrier as the operator's phone.
- The modem's data connection requests IPv4 and IPv6 together (`ipv4v6`). This is configuration, not firmware.
- The agent's `-iface` points at the modem interface (e.g. `wwan0`) once it exists.
- No code change: WebRTC and Pion already gather and prefer IPv6 candidates.

TURN is deferred, not dropped: coturn is not built now (Phase 1c step 3 is on hold).
**Consequences:**
- An operator on an IPv4-only network (most home wifi, including the user's) can't connect to the drone until TURN exists.
- Still unproven: whether the carrier blocks unsolicited incoming IPv6 between two mobile devices. The first test with the real modem (or a second phone hotspotting the Pi) must settle this.
- Revisit, and build coturn on the planned VPS, if that test fails or operators need IPv4-only networks. A public-IPv4 SIM is the other no-relay fallback.

## ADR-0016: Public mock-UI demo on Cloudflare at `drone.tomwildoer.com` (2026-10-06, accepted)
**Context:** The user wanted the web UI publicly reachable from any device to show people, without standing up the backend (agent, signalling, auth) yet. No real drone is at risk, so the open-signalling security gap doesn't apply — there's nothing on the other end.
**Decision:** Deploy `web/` as a static build with the **in-browser mock drone** (`VITE_VEHICLE_LINK=mock`) to Cloudflare, served at `https://drone.tomwildoer.com` (free URL `cellular-drone.tom-wildoer.workers.dev`). The demo login (`operator` / `changeme`) comes from gitignored `web/.env.local`, baked into the JS bundle at build time — a **cosmetic gate, not real auth**. No `MockLink`/`WebRtcLink`/UI code changed; going to the real drone path later is a rebuild with `VITE_VEHICLE_LINK=webrtc` (ADR-0009).
**Deployment notes:** `wrangler pages project create` delegated to the current Cloudflare flow and deployed the project as a **Worker** with static assets ("Pages, now part of Workers"), *not* a classic Pages project. So:
- Redeploys use `npm run deploy` (= `npm run build && wrangler deploy`), not `wrangler pages deploy`.
- The custom domain is a **Worker Custom Domain binding** (dashboard → the worker → Settings → Domains & Routes), not a hand-made CNAME.
- That CLI edited the repo: added `cloudflare()` to `web/vite.config.ts`; added `deploy`/`preview` scripts and `wrangler` + `@cloudflare/vite-plugin` devDeps to `web/package.json`; created `web/wrangler.jsonc`; extended `web/.gitignore` (`.wrangler`, `.dev.vars*`, `.env*`). We changed `wrangler.jsonc` `name` from the generated `web` to `cellular-drone` so redeploys stay on the same worker/URL.
**Consequences:** The demo is a **per-device mock sandbox** — missions live in `localStorage` and state resets on reload, so it's not a shared live view and not a security boundary. Fine for showing the UI; revisit all of this (real auth, signalling, a live drone end) when the backend lands.

## ADR-0017: ArduPilot and MAVLink are the reference for every mission and command feature (2026-10-07, accepted)
**Context:** The frontend was built first against `MockLink` (ADR-0009), so mission planning (items, loiter modes, ETA, minimum radii, fence checks) has so far been shaped by the mock's physics, not by what ArduPlane executes. An assessment found the domain mostly maps onto ArduPlane mission commands, but with gaps: clock-mode loiter has no native command, waypoint-reached and RTL-altitude semantics differ from the mock, ArduPilot reserves seq 0 for home, it stores no mission id, its fence is vehicle-wide plus parameters, and validation only checks fence containment at item points.
**Decision:**
- `docs/MAVLINK.md` is the mapping reference from app vocabulary to ArduPlane / MAVLink2. A new mission item, command or telemetry field needs its row there (native command, or how we get the behaviour and what happens if the companion computer dies) **before** it is built. UI code still never imports MAVLink; this constrains meaning, not imports.
- Path planning stays in the browser as pure `domain/` functions that produce plain mission items. Anything richer (survey grids, corridors, fence-aware routing) expands into native items before upload, so the FC can fly the whole mission with the agent, modem or browser gone.
- ArduPlane SITL is the behavioural reference. Where the mock differs, tune the mock to match SITL.
- `altM` is metres above home (`MAV_FRAME_GLOBAL_RELATIVE_ALT_INT`). The agent maps MAVLink seq to app item index (seq 0 = home) and keeps the uploaded `Mission` JSON for identity.
**Clock-mode loiter (ADR-0013), decided 2026-10-07: a Lua script on the FC.** The translator writes it as `NAV_LOITER_UNLIM` plus a `DO_SEND_SCRIPT_MESSAGE` marker row (id 7301, end time in param2), and `sim/scripts/loiter_until.lua` ends it from GPS time, so it works with the companion computer gone. Proven in SITL. It needs an FC with Lua scripting, so an H7 class board, not the F405 (ADR-0002). Without the script, the loiter never ends and the battery failsafe brings the aircraft home.
**Consequences:** Phase 1b (SITL + MAVLink in the agent) moves ahead of new planner features. Fence validation must check legs and loiter circles, not just points.

**Addendum (2026-10-07): where the translation runs — hybrid.** Weighed translating on the drone against translating in the browser. On the drone keeps the agent's safety gate narrow (it accepts five app item types, never arbitrary MAVLink), lets it adapt to the FC's real params and firmware, and keeps the wire protocol in app vocabulary. In the browser gives instant planning feedback and offline export. So both, with one authority:
- **Authoritative:** the agent's Go translator, `agent/internal/mission`. Only it produces what gets uploaded to the FC. It refuses unknown item types.
- **Preview:** the browser's TypeScript translator, `web/src/ardupilot`, behind the `MissionTranslator` service (`services/`). It drove the planner's ArduPilot panel and the `.waypoints` export (QGC WPL 110, loads in Mission Planner, QGC and MAVProxy); the panel was removed from the UI on 2026-10-08 as clutter, so nothing in the UI shows them today. `features/` and `state/` can't import `ardupilot/` (ESLint rule).
- **Kept in lockstep** by golden files in `testdata/mission-translation/`, hand-written from ArduPilot's storage rules and run by both test suites.
- **Readback wins:** `mission.uploaded` carries an optional `onVehicle` list, the FC's mission read back after upload (optional field, so `v` stays 1). The planner showed whether it matches the plan (removed with the panel, 2026-10-08; the readback still arrives in the vehicle store). `MockLink` / `mock-agent` fill it from the preview translator, standing in for an FC.
- The readback is a raw row type in `domain/` (`VehicleMissionItem`), opaque to the UI: only the `MissionTranslator` interprets its numbers.

## ADR-0018: Air unit = Orange Pi 5 (RK3588S); one streamed gimbal camera plus onboard CV and aux cameras (2026-10-07, accepted)
**Context:** The aircraft will eventually carry a 2-axis gimbal camera on the underside plus several more cameras, some only for onboard computer vision and some as auxiliary views. That is beyond the Radxa Zero 3W's RK3566 (ADR-0006): it has no NPU worth using for CV and limited camera and encoder capacity. The cellular uplink can only carry about one live video stream anyway.
**Decision:**
- **Companion computer: Orange Pi 5 (RK3588S)** for planning, replacing the Radxa Zero 3W. It's the same Rockchip family, so the same arm64 agent binary, GStreamer and MPP (`mpph264enc` / `mpph265enc`) video stack carry over, with an NPU (~6 TOPS, Rockchip's figure, via RKNN) for onboard CV, more CPU and RAM, more encoder capacity and gigabit Ethernet.
- **One live video stream to the browser at a time.** By default it's the **gimbal camera**. The operator can switch the stream to one of the **aux cameras**, cycling through them; it's always one stream on the WebRTC video track, never several.
- **CV cameras are onboard only.** They feed the NPU; what reaches the browser is results (detections, alerts, snapshots), not video.
- **Prefer a gimbal with its own camera and encoder** that outputs H.264/H.265 over Ethernet (SIYI-style units, which ArduPilot supports natively), so the agent forwards it into the WebRTC track without transcoding, and the Orange Pi's encoders are left for the aux cameras.
**Still to decide (own ADRs when the time comes):** gimbal control from the browser (it isn't flight control, but it adds whitelisted MAVLink gimbal commands to the command model); the protocol for choosing the streamed camera (`video.config` grows a source); and any path from CV results to flight behaviour, which by default stays advisory only: CV never commands the aircraft without its own ADR and the same safety rules as everything else.
**Consequences:**
- More weight and power than the Radxa (about 10 g, a few watts) once the board, cooling, gimbal and cameras are counted: budget it in the airframe choice (Phase 0) and the power system (a bigger BEC than 5 V 3 A).
- Check the Orange Pi 5's camera interfaces against the camera count before buying: the aux and CV cameras may need to be USB (UVC) rather than MIPI CSI.
- The Pi 5 stand-in (ADR-0014) stays for link work. When the Orange Pi 5 arrives it can take over, and gives real hardware encode numbers, which the Pi 5 can't.

## ADR-0019: Onboard obstacle avoidance acts through the flight controller, in stages (2026-10-07, accepted; mechanism to verify in SITL)
**Context:** Two of the aux cameras (ADR-0018) are planned for onboard obstacle avoidance, with models on the Orange Pi 5's NPU. That is computer vision affecting flight, which ADR-0018 left advisory-only until it had its own decision. The constraints: the aircraft must stay safe with no link and no companion computer (ARCHITECTURE.md), the browser never sends manual control, and the RC pilot always wins (ADR-0008). As far as we know, ArduPilot's proximity-based avoidance and path planners (`AVOID_*`, `OA_TYPE` BendyRuler/Dijkstra) are Copter/Rover features. ArduPlane in fixed-wing flight doesn't steer around obstacles itself, though QuadPlane may apply some proximity avoidance in its VTOL modes (QLOITER, QLAND, VTOL takeoff and landing). **Verify all of that in SITL before relying on it.**
**Decision:**
- **Avoidance acts through the flight controller, never by the agent steering.** The vision pipeline may only:
  1. feed obstacle data into ArduPilot as sensor input (`OBSTACLE_DISTANCE` / `DISTANCE_SENSOR` over MAVLink, with a MAVLink proximity backend `PRX1_TYPE`), so the FC's own logic acts on it where ArduPilot supports that, and
  2. trigger a short, fixed list of escape actions that already exist as whitelisted commands (pause into LOITER/QLOITER, RTL, QLAND), for phases where the FC can't avoid by itself.
  It never sends attitude, velocity or position setpoints, `RC_CHANNELS_OVERRIDE` or `MANUAL_CONTROL`, and never changes the mission.
- **Additive, never required.** The mission must be safe without avoidance: planned with clearance (altitude above known obstacles, the geofence). If the cameras, models, agent or Orange Pi fail, the aircraft carries on as it does today. ArduPilot drops proximity data that stops arriving.
- **The RC pilot still wins (ADR-0008).** No escape action fires while the RC pilot holds a manual mode.
- **Visible and logged.** Detections, every escape action and avoidance health (running, degraded, unavailable) go to the browser as events and into the agent's command log. The operator can turn escape actions off per mission.
- **In stages, each proven in SITL before the next:**
  1. **Detect and report only.** Detections and distances shown in the browser; flight unaffected (ADR-0018's default).
  2. **Sensor input to the FC.** Proximity data into ArduPilot. In SITL the agent injects synthetic `OBSTACLE_DISTANCE`, to see which modes QuadPlane actually avoids in.
  3. **Escape actions** for the phases stage 2 shows the FC can't cover (expected: fixed-wing cruise). Triggered by the agent at first; a Lua script on the FC can take it over later, so it keeps working if the companion computer fails.
- **Not a detect-and-avoid system** in the regulatory sense. Don't present it as one for BVLOS (Phase 0 / Phase 5).
**Still open:** stereo pair vs one camera with a monocular depth model (stereo gives real distances but needs calibration and more RAM); which models; whether to add a cheap rangefinder or lidar for the landing phase (`DISTANCE_SENSOR` downward); the exact escape action per flight phase; the protocol messages for detections and avoidance health.
**Consequences:**
- The Orange Pi 5 should be the 8 GB version: avoidance is safety-relevant, and an out-of-memory kill mid-flight could take out the vision pipeline or the agent.
- The agent gains a second, onboard source of mode changes. The RC-override logic must tell avoidance-triggered changes apart from pilot takeovers, the same way it already tells its own commands apart.
- At 25 m/s cruise (SITL) a camera detecting at 50–100 m gives only 2–4 s before reaching the obstacle. Fixed-wing escape needs early detection or must stay a coarse "stop and loiter". Hover phases are where avoidance helps most.

## ADR-0020: The link never changes flight behaviour; pauses are limited and resumes rejoin the plan, on the FC (2026-10-07, accepted)
**Context:** The browser link should be a planning and viewing tool. Two things broke that. (1) The GCS failsafe (`FS_GCS_ENABL 1`, heartbeats only while a browser is connected) changed the flight whenever nobody was connected: at power-up it switched the FC to RTL, which became QRTL on the ground and blocked arming, and a paused aircraft that lost its link would RTL or land where it was. (2) After a pause, ArduPlane resumes by flying straight from wherever it is to the target instead of back onto the planned leg (measured in SITL), so the route flown depended on when someone pressed pause.
**Decision:**
- **No GCS failsafe** (`FS_GCS_ENABL 0`). Connecting, disconnecting or losing LTE never changes the flight. The whole mission is uploaded before flight and flown from the FC's memory; only telemetry and video stream down.
- **`pause_resume.lua` on the FC** handles pauses:
  - A pause the browser commanded (mode reason `GCS_COMMAND`) that lasts 120 s is resumed by the script, so a pause left by a lost link, or a forgotten one, can't strand the aircraft. A mode the RC pilot chose is never touched (ADR-0008).
  - Every resume from a pause rejoins the planned leg: the script sets ArduPlane's leg start back to the previous planned waypoint (`vehicle:set_crosstrack_start`), so its line-following steers back onto the plan.
- **The map's dashed path is always the fixed planned route**, trimmed by progress along it, never redrawn from the aircraft.
- **The mock rejoins the planned leg on resume** too, matching.
**Consequences:**
- Proven in SITL (`agent/cmd/sitlcheck -resume` / `-pause-limit`): back within 2 m of the leg 18 s after a resume (without the script, still 67 m off after 40 s); an unresumed pause resumed itself at 121 s and rejoined.
- Still protected without the link: battery failsafe, geofence, RC pilot. The cost: an aircraft whose operator vanished mid-pause keeps loitering for up to 120 s before carrying on with the mission.
- Two scripts are now required on the FC (`loiter_until.lua`, `pause_resume.lua`), which needs an H7 board (ADR-0002).
- The agent's arm still switches RTL/QRTL/QLAND to QLOITER first: the FC is left in QRTL after any RTL landing.
- Not yet verified in SITL: that an RC pilot's LOITER isn't time-limited. Possible since 2026-10-08: `cmd/sitlpilot -switch LOITER` moves SITL's simulated mode switch (mode reason `RC_COMMAND`), where `-mode` looked like a ground-station command.

## Link test results (test matrix from `docs/P2P_TESTING.md`)
Raw ICE detail lives in the agent's JSONL log and the browser console (`[WebRtcLink]`). NAT mapping measured with `agent/cmd/natcheck`.

| Date | Drone side (Pi 5) | Browser side (Mac, Chrome) | IPv6 | Result | Setup | RTT | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-05 | Home wifi, home NAT | Home wifi, same LAN | Pi none | Direct, host ↔ host | < 2 s | 5–13 ms | 720p30 software x264 at 1.5 Mbit/s plays; telemetry flows. Step 1 passed. |
| 2026-10-05 | Home wifi, home NAT | Phone hotspot (Telstra, from the address ranges) | Mac yes, Pi none | **No path**, STUN only; ICE restart also failed | — | — | Hotspot IPv4 NAT is symmetric: one socket got ports 47661/47662/47663 for three STUN servers (sequential allocation). Its IPv6 is endpoint-independent. The home NAT apparently filters by address and port, despite the old RFC 3489 client reporting "Independent Filter". Symmetric vs port-restricted can't hole-punch: TURN is required for this pairing. |
| 2026-10-05 | Home wifi with IPv6 enabled on the Pi (`ipv6.method auto`; Aussie Broadband prefix) | Phone hotspot (Telstra) | Both | **Direct over IPv6**, host ↔ host (Pi's global address) | ~0.1 s after ICE checking began | 36–62 ms | 720p video and telemetry. No relay, port forward or router change: the home router's IPv6 firewall let the hole-punched path through. The only fix was the Pi ignoring IPv6 (`ipv6.method=ignore` in its NetworkManager profile). |

**Takeaway so far:** carrier IPv4 on its own can't be relied on for a direct path. IPv6 works: hotspot to home connected directly over IPv6 (ADR-0015). Still to prove: mobile to mobile, both on carrier IPv6. IPv6 looks promising: the hotspot's IPv6 mapping is endpoint-independent, so a drone and browser that both have carrier IPv6 may connect directly. Test that once the Pi is on LTE.

## ADR-0021: Planner height profile with terrain clearance, and flight estimates at ArduPlane figures (2026-10-08, accepted)
**Context:** Mission heights are metres above home (`MAV_FRAME_GLOBAL_RELATIVE_ALT`, docs/MAVLINK.md), not above the ground. A leg planned at 60 m is 60 m over a hill only if the hill is no higher than home. Nothing in the planner showed that, or how long a mission takes.
**Decision:**
- The planner shows the route side-on (`MissionProfilePanel`): planned height above home against distance along the route, over the ground, with the lowest clearance, loiter circles over high ground, distance flown and estimated time. Pure logic in `domain/missionProfile.ts`.
- **Ground comes from a `TerrainService`** (`services/`), wired in `app/config`. The implementation reads the same MapTiler terrain-RGB tiles the 3D map uses (z12, ~30 m grid), with the same `VITE_MAPTILER_KEY`, so the profile and the 3D ground agree. Without a key the profile shows planned heights only.
- **The datum is the ground at home in the same terrain data**, not the vehicle's reported home AMSL, so the terrain source's own offset (and GPS/baro altitude error) cancels out.
- **Advisory, not a gate.** Under 30 m (`TERRAIN_CLEARANCE_WARN_M`) is a warning, below the ground is shown as critical, but neither blocks saving or upload. The terrain has no trees, buildings or masts, and a ~30 m grid can miss a sharp ridge, so it can't prove a route safe; it catches the big mistakes.
- **Estimates follow ArduPlane, not the mock** (ADR-0017): `SITL_PERFORMANCE` (25 m/s cruise, 2.5 m/s VTOL climb, 1.5 then 0.5 m/s descent, ~10 s transitions, `RTL_ALTITUDE` 60 m) was measured from a SITL flight log. RTL is drawn at `RTL_ALTITUDE`, a VTOL landing at the approach height then straight down, altitude changes as an even slope along each leg. Replace the figures with the real airframe's in Phase 3.
**Consequences:**
- The browser fetches terrain tiles for the mission area from MapTiler, as the map already does.
- No battery estimate yet: it needs the airframe's consumption figures (Phase 3).
- `RTL_ALTITUDE` is assumed, not read from the vehicle. Reading it (and the cruise speed) from the FC is a later improvement.

**Addendum (2026-10-08): "follow terrain at X m" is done by the planner, not the flight controller.** The profile panel's *Follow terrain* sets the takeoff to X, each waypoint and loiter to X over its ground (a loiter: over the highest ground under its circle), then adds a waypoint at X over the lowest point of any leg that dips more than 3 m under X, worst first, up to 25 (`domain/terrainFollow.ts`, `features/mission-planner/followTerrain.ts`). The result is ordinary above-home waypoints, so the FC, agent, translator and mock need nothing new, and it still flies with the companion computer dead. Undo restores the plan while it's unedited.
- **Not continuous terrain following.** Between waypoints the height changes evenly; a narrow ridge between two samples (~30 m apart) can still be missed, and the terrain has no trees or buildings.
- **RTL can't be raised by the planner:** it flies home at `RTL_ALTITUDE`. The tool reports when that leg is under X; the fix is the parameter, or ending with waypoints back to home.
- **Above-home heights can pass the 120 m limit** over a valley-to-hill route even though the aircraft is X above the ground; validation still checks height above home, which is the conservative reading until a terrain-aware limit is decided.
- **Native ArduPlane terrain following** (`MAV_FRAME_GLOBAL_TERRAIN_ALT`, `TERRAIN_ENABLE`/`TERRAIN_FOLLOW`, a terrain database on the FC's SD card or served by the agent in reply to `TERRAIN_REQUEST`) holds the height continuously and covers RTL. It's the better answer for the real aircraft: a later ADR, proven in SITL first.

