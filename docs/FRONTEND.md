# Frontend design: built to survive backend changes

The UI is being built **first**, before the agent, server or hardware exist. To make sure that work isn't wasted if the backend architecture changes (WebRTC vs WebSocket relay, Go agent vs something else, MAVLink details), the frontend talks to the vehicle **only** through a small, app-owned contract.

The UI knows nothing about WebRTC, MAVLink, WireGuard or the server topology.

## The layers

```
web/src/
  domain/        Pure TS types + logic in OUR vocabulary (no MAVLink, no transport)
  protocol/      Versioned JSON message schemas (zod) = the wire contract
  link/          VehicleLink interface + implementations (mock, webrtc, ws…)
  services/      AuthClient, MissionRepository interfaces + implementations
  state/         App stores (e.g. Zustand) fed by a VehicleLink
  features/      UI: map, hud, video, mission-planner, checklist, commands, login
  app/           Routing, providers, config (selects implementations)
```

**Dependency rule:**
- `features/` and `state/` may import `domain/` and the **interfaces** in `link/` and `services/`.
- They **never** import a concrete implementation (`MockLink`, `WebRtcLink`, …). Only `app/` wires those up, chosen by config such as `VITE_VEHICLE_LINK=mock|webrtc|ws`.
- Enforce this with an ESLint `no-restricted-imports` rule.

## 1. Domain model (`domain/`)
The app's own vocabulary. It's stable even if the flight stack or transport changes.

- `VehicleState`: position (lat, lon, `altRelM`, `altAmslM`), attitude (roll, pitch, yaw in degrees), `groundSpeedMps`, `airspeedMps`, `climbMps`, battery (V, A, %), GPS (fix type, satellites, HDOP), `flightMode` (an **app enum**, see below), `armed`, `vtolState` (`mc` | `fw` | `transition`), `landed`, home, `missionProgress` (`currentIndex`, total), `rc` (`linked`, `overrideActive`), `failsafe` flags, `updatedAt`.
- `FlightMode`: app enum (`AUTO`, `LOITER`, `QLOITER`, `RTL`, `QLAND`, `QHOVER`, `FBWA`, `MANUAL`, `UNKNOWN`…). The agent maps from ArduPilot custom modes. The UI never sees raw numbers.
- `Mission`: `{ id, name, items: MissionItem[], fence?, createdAt, updatedAt }`
- `MissionItem` (discriminated union): `vtolTakeoff{altM}`, `waypoint{lat,lon,altM,acceptRadiusM?}`, `loiter{lat,lon,altM,radiusM,turns|timeS}`, `vtolLand{lat,lon}`, `returnToLaunch`
- `Command` (discriminated union, matching the whitelist in ARCHITECTURE.md): `arm`, `disarm`, `mission.start`, `mode.pause`, `mode.resume`, `mode.rtl`, `mode.qland`, `video.config{preset}`. **No manual-control commands exist in the type at all.**
- `CommandResult`: `{ ok: true } | { ok: false, reason: 'rejected_by_vehicle' | 'blocked_rc_override' | 'preflight_failed' | 'timeout' | 'not_connected' | 'unauthorised', detail? }`
- `LinkStatus`: `{ state: 'disconnected' | 'connecting' | 'connected' | 'degraded', path?: 'direct' | 'relayed' | 'unknown', rttMs?, videoKbps?, lastTelemetryAt? }`
- Units in field names (`M`, `Mps`, `Deg`). Lat/lon in degrees (float). Altitudes are relative to home unless the name says `Amsl`.
- Pure helpers live here too and get unit-tested: mission validation (must start with VTOL takeoff and end with land or RTL, altitude limits, inside the fence), distance and ETA estimates, preflight checklist evaluation.

## 2. The link interface (`link/VehicleLink.ts`)

```ts
export interface VehicleLink {
  connect(vehicleId: string): Promise<void>;
  disconnect(): Promise<void>;

  onState(cb: (s: VehicleState) => void): Unsubscribe;
  onLinkStatus(cb: (s: LinkStatus) => void): Unsubscribe;
  onEvent(cb: (e: VehicleEvent) => void): Unsubscribe;   // status text, failsafe, mode change, RC override

  send(cmd: Command): Promise<CommandResult>;
  uploadMission(m: Mission): Promise<CommandResult>;     // resolves after the vehicle verifies it
  downloadMission(): Promise<Mission | null>;

  getVideoStream(): MediaStream | null;                  // UI just attaches it to a <video>
  onVideoStream(cb: (s: MediaStream | null) => void): Unsubscribe;
}
```

Implementations:

| Impl | When | Notes |
|---|---|---|
| `MockLink` | **Now.** The UI is built against it. | An in-browser simulated VTOL that flies missions: takeoff climb, transition, waypoint following, loiter, RTL, QLAND, battery drain. Video via `canvas.captureStream()` (test pattern with a fake horizon). Knobs to inject latency, packet loss, link drop, RC override, low battery and failsafe. |
| `WebRtcLink` | Phase 1b+ | Signalling over WSS, data channels carrying `protocol/` messages, video track. |
| `WsLink` | Only if the architecture goes back to a relay | Same `protocol/` messages over a WebSocket. |

All real links use **the same `protocol/` messages**, so swapping transports touches only one file.

## 3. Wire protocol (`protocol/`)
- JSON messages with **zod** schemas, and a top-level `{ v: 1, type, id?, ts, payload }` envelope.
- Types: `telemetry.state`, `telemetry.event`, `cmd.request`, `cmd.result`, `mission.upload`, `mission.uploaded`, `mission.download`, `mission.current`, `video.config`, `ping`/`pong`.
- Every incoming message is validated. Unknown types are ignored (forward compatible).
- Later this moves to a shared package (`packages/protocol`) used by the web app and the server. The Go agent mirrors it (generated from JSON Schema exported from zod).
- MockLink also speaks the protocol internally (serialise, validate, deserialise), so the contract gets exercised from day one.

## 4. Services
- `AuthClient`: `login(user, pass)`, `logout()`, `me()`. `MockAuthClient` uses a dev password from `.env.local`; `HttpAuthClient` comes later. The UI handles a `401` everywhere.
- `MissionRepository`: `list()`, `get(id)`, `save(m)`, `delete(id)`. `LocalStorageMissionRepository` now, `HttpMissionRepository` later.

## 5. UI features (built against MockLink)
- Login. Vehicle list (one drone for now).
- Flight screen, mobile-first. Map (MapLibre) with the aircraft icon and heading, trail, home, mission path, fence. HUD strip. Video panel (dockable or picture-in-picture). Link badge (direct/relayed, RTT). **RC override banner** (always visible when active).
- Mission planner: tap the map to add waypoints, edit altitudes, VTOL takeoff and land items, validation errors inline, save and load.
- Preflight checklist (blocks arm and start until complete) + command bar with confirm dialogs (slide-to-confirm or hold-to-confirm on touch).
- Event log panel (status text, failsafes, command results).
- Dev panel (only when `VITE_VEHICLE_LINK=mock`): MockLink fault injection.

## 6. Testing
- Vitest unit tests for `domain/` (validation, checklist) and `protocol/` (schema round-trips).
- A **contract test suite** for `VehicleLink` (`link/__tests__/contract.ts`). Every implementation must pass it. That's how we know a new backend is a drop-in.
- Playwright smoke test: login → plan mission → upload → arm → start → RTL, against MockLink.

## Stack
React + Vite + TypeScript (strict), MapLibre GL (OSM/open tiles), Zustand, zod, Tailwind + shadcn/ui, Vitest, Playwright. Mobile-first; tested in Chrome desktop, Chrome Android and iOS Safari.
