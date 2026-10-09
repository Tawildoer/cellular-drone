# cellular-drone

An autonomous fixed-wing **VTOL (ArduPilot ArduPlane QuadPlane)** supervised over **4G/LTE** from a browser. The whole mission lives on the flight controller; the browser plans it, watches live video and telemetry, and sends a small set of whitelisted commands. **No manual control goes over the network**: a local RC radio can always take over.

**📖 [Docs](https://drone.tomwildoer.com/docs/)** · [Status](https://drone.tomwildoer.com/docs/status/) · [Progress log](https://drone.tomwildoer.com/docs/progress-log/) · [Live demo (mock drone)](https://drone.tomwildoer.com)

## What's here

| Path | What |
| --- | --- |
| `web/` | Operator console: React, Vite, MapLibre. Mission planner with terrain profile, flight HUD, video. Built against an in-browser mock drone first. |
| `agent/` | Drone-side agent in Go: WebRTC (Pion) to the browser, MAVLink2 to the flight controller, command whitelist, flight log. |
| `sim/` | ArduPlane SITL in Docker, with the project's params and flight-controller Lua scripts. |
| `server/` | Signalling relay (auth comes in Phase 1c). |
| `mock-agent/` | A standalone simulated drone for UI work. |
| `docs/` | Plan, architecture, ADRs, ArduPilot mapping: the source of the docs site. |

## Status

Work in progress: software runs end to end against ArduPlane SITL; no hardware yet. **Authentication isn't built yet**: read [SECURITY.md](SECURITY.md) before connecting anything real.

## Quick start

```bash
cd web && npm install && npm run dev            # console against the mock drone
cd sim && docker compose up -d                   # ArduPlane SITL (first build ~15 min)
cd agent && go run ./cmd/agent -fc tcp:127.0.0.1:5760 -video-cmd "" -insecure-dev-tokens
cd web && npm run e2e:sitl                       # browser → agent → SITL, end to end
```

## License

[Apache-2.0](LICENSE). Not affiliated with the ArduPilot project.
