# Progress log

What each working session delivered, newest first. Commit hashes link to the change on GitHub. Add an entry when work lands; tick the matching boxes in [the plan](PLAN.md) in the same change.

## 2026-10-08: SITL end to end, planner terrain tools, RC switch

- **Browser → agent → ArduPlane SITL, flown end to end** ([`b262599`](https://github.com/Tawildoer/cellular-drone/commit/b262599)). SITL in Docker with the project's params and the two FC Lua scripts; the agent's MAVLink link, command whitelist, and mission/fence upload with readback. The Playwright SITL suite (`npm run e2e:sitl`) ran for the first time and passed.
- **Agent flight log** ([`89daad0`](https://github.com/Tawildoer/cellular-drone/commit/89daad0)): one JSONL file per start with every session, command, upload and FC event, plus state samples, written with or without a browser. Its first use found a race in the RC takeover test (ArduPlane reports VTOL state FW on the ground in FBWA), now fixed.
- **Planner: height profile and Follow terrain** ([`7906116`](https://github.com/Tawildoer/cellular-drone/commit/7906116), ADR-0021). The route side-on over MapTiler terrain, with lowest-clearance and loiter-circle warnings, and distance and time at ArduPlane's figures. *Follow terrain at X m* sets heights from the terrain and adds waypoints over ridges. The ArduPilot mission panel was removed as clutter.
- **HUD link strength as a smooth line**: a continuous 0–100% score over the last 10 s, sampled four times a second; the mock now reports realistic LTE conditions so the demo shows it.
- **RC mode switch read directly** ([`cc92a6d`](https://github.com/Tawildoer/cellular-drone/commit/cc92a6d)): the agent reads `FLTMODE_CH`, reports the switch position, treats the switch off AUTO as a takeover, and only starts a mission with it at AUTO. The SITL test pilot now moves the simulated switch. All three SITL tests pass (5.6 min).
- **Docs**: ADR-0021, this site.

## 2026-10-07: ArduPilot becomes the reference

- **Link quality readout** ([`9b5ae4b`](https://github.com/Tawildoer/cellular-drone/commit/9b5ae4b)): strength tile, quality panel with sparklines, IP version, path, fps, loss and jitter graded for supervising a drone. The agent's encoder now sends RTP itself, and ICE can be served from one forwarded port. IPv6 hotspot-to-home test recorded.
- **Missions map onto ArduPlane / MAVLink** ([`d644760`](https://github.com/Tawildoer/cellular-drone/commit/d644760), ADR-0017): `docs/MAVLINK.md`; an authoritative Go translator in the agent and a TypeScript preview, both held to shared golden files; vehicle readback after upload.
- **Decisions**: Orange Pi 5 air unit (ADR-0018), staged obstacle avoidance through the FC (ADR-0019), no GCS failsafe with time-limited pauses that rejoin the plan (ADR-0020), clock-mode loiters as an FC Lua script.

## 2026-10-06: public demo

- **Cloudflare deploy** ([`26c5b45`](https://github.com/Tawildoer/cellular-drone/commit/26c5b45), ADR-0016): the mock UI live at drone.tomwildoer.com.
- **Demo drone and readable maps** ([`76020ad`](https://github.com/Tawildoer/cellular-drone/commit/76020ad)): a Demo Drone already airborne on a patrol in every build; MapLibre's worker bundled (overlays were missing in production); flat overlays when zoomed out.

## 2026-10-05: the console and the real link

- **Flight console against MockLink** ([`d5c5ea1`](https://github.com/Tawildoer/cellular-drone/commit/d5c5ea1)): the operator console, mission planning with waypoints and timed loiters, 3D path, physically flown guidance, preflight checklist, and `mock-agent` as a standalone simulated drone (ADR-0012 to ADR-0014).
- **WebRTC link slice** ([`05fb717`](https://github.com/Tawildoer/cellular-drone/commit/05fb717)): Go + Pion agent on a Raspberry Pi 5, signalling relay, `WebRtcLink`. Direct on a LAN; no direct IPv4 path from a phone hotspot, so IPv6 becomes the intended direct path and TURN goes on hold (ADR-0015).

## 2026-10-02: plan and architecture

- **Project plan, architecture and decision log** ([`e61d460`](https://github.com/Tawildoer/cellular-drone/commit/e61d460)): phases, safety model, command model.
- **Transport and air unit** ([`bb4e02f`](https://github.com/Tawildoer/cellular-drone/commit/bb4e02f)): WebRTC peer to peer with TURN fallback, a permanent RC override (ADR-0008), the manual-control rule clarified.
- **Frontend first** ([`a487c5c`](https://github.com/Tawildoer/cellular-drone/commit/a487c5c), ADR-0009): the transport-agnostic `VehicleLink` contract the UI is built on.
