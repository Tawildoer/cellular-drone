# sim: ArduPlane SITL

ArduPlane (QuadPlane) software-in-the-loop in Docker: the real ArduPilot
firmware flying a simulated VTOL, so the agent and the browser can be
developed against real ArduPilot behaviour before any hardware (ADR-0017:
where the mock and SITL disagree, SITL is right).

```bash
docker compose up -d          # first build compiles ArduPilot: 10–20 min
docker compose logs -f        # "loiter_until.lua loaded" once it's up
docker compose down
```

- **Version:** `Plane-4.7.1` (current stable), set by `ARDUPILOT_TAG` in the Dockerfile.
- **Home:** `SITL_HOME` in `docker-compose.yml`, the same as the web app's demo home.
- **Ports:** 5760 is for the agent. 5762 is for a ground-station tool connected alongside it: Mission Planner, QGroundControl or MAVProxy (`mavproxy.py --master tcp:127.0.0.1:5762`). It's handy for checking what the agent uploaded, or for loading a `.waypoints` export from the planner.
- **Parameters:** `params/cellular-drone.parm`, on top of ArduPilot's `quadplane.parm`. It sets the failsafes from ARCHITECTURE.md / ADR-0008, `Q_RTL_MODE`, the fence (off until a mission brings one), and Lua scripting. `-w` wipes the simulated EEPROM, so every start loads them fresh.
- **Scripts:** `scripts/loiter_until.lua` ends clock-mode loiters on the flight controller (ADR-0017).

## Check the agent's MAVLink side, no browser

```bash
cd ../agent
go run ./cmd/sitlcheck          # upload + readback, arm, take off, pause, resume, RTL, land (~4 min)
go run ./cmd/sitlcheck -clock   # clock-mode loiter ended by loiter_until.lua (~4 min)
```

Restart SITL between runs (`docker compose up -d --force-recreate`), so each starts landed and disarmed at home.

## Browser end-to-end tests against SITL

```bash
cd ../web && npm run e2e:sitl     # ~10 min: builds the agent, starts server + agent + SITL, drives Chrome
```

`web/e2e-sitl/` (Playwright, `playwright.sitl.config.ts`):
- **Flight:** plan → save (upload + "Vehicle readback matches") → arm → start → fixed-wing → pause/resume → RTL → land → disarm.
- **RC takeover (ADR-0008):** `agent/cmd/sitlpilot` switches SITL to FBWA from port 5762, as the radio's mode switch would. The UI shows the override banner, the agent refuses RTL with `blocked_rc_override`, and once the "pilot" hands back to AUTO, browser commands work again.

Each test restarts SITL. Logs land in `web/test-results-sitl/`, the report in `web/playwright-report-sitl/`.

## Fly it from the browser

```bash
cd server && npm start                                          # signalling on :8788
cd agent && go run ./cmd/agent -fc tcp:127.0.0.1:5760 -video-cmd ""
cd web && VITE_VEHICLE_LINK=webrtc npm run dev                  # open the app, pick Drone 1
```

Plan a mission, save it (that uploads it), then arm and start from the command bar. The planner's ArduPilot panel should then show "Vehicle readback matches".
