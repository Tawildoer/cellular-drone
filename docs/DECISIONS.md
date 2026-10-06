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

## ADR-0006: Air unit = Radxa Zero 3W companion (2026-10-02, accepted)
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

## Link test results (test matrix from `docs/P2P_TESTING.md`)
Raw ICE detail lives in the agent's JSONL log and the browser console (`[WebRtcLink]`). NAT mapping measured with `agent/cmd/natcheck`.

| Date | Drone side (Pi 5) | Browser side (Mac, Chrome) | IPv6 | Result | Setup | RTT | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-05 | Home wifi, home NAT | Home wifi, same LAN | Pi none | Direct, host ↔ host | < 2 s | 5–13 ms | 720p30 software x264 at 1.5 Mbit/s plays; telemetry flows. Step 1 passed. |
| 2026-10-05 | Home wifi, home NAT | Phone hotspot (Telstra, from the address ranges) | Mac yes, Pi none | **No path**, STUN only; ICE restart also failed | — | — | Hotspot IPv4 NAT is symmetric: one socket got ports 47661/47662/47663 for three STUN servers (sequential allocation). Its IPv6 is endpoint-independent. The home NAT apparently filters by address and port, despite the old RFC 3489 client reporting "Independent Filter". Symmetric vs port-restricted can't hole-punch: TURN is required for this pairing. |

**Takeaway so far:** carrier IPv4 on its own can't be relied on for a direct path, so TURN is mandatory for the real system. IPv6 looks promising: the hotspot's IPv6 mapping is endpoint-independent, so a drone and browser that both have carrier IPv6 may connect directly. Test that once the Pi is on LTE.
