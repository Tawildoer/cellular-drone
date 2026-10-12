# agent

The drone-side WebRTC peer (Go + Pion). It answers browser offers via the
signalling server (`../server`), streams a video track, and logs ICE state
and the selected candidate pair as JSONL.

With `-fc` it talks MAVLink2 to an ArduPlane flight controller
(`internal/fc`, docs/MAVLINK.md): real telemetry and events, whitelisted
commands, and mission upload with readback, translated by
`internal/mission`. Without `-fc` it's the link slice from ADR-0014: stub
telemetry, every command refused.

## Build

```bash
go build -o bin/agent ./cmd/agent                                              # this machine
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o bin/agent-linux-arm64 ./cmd/agent   # Pi 5 / Radxa
go test ./...
```

The binary is static and pure Go: video comes from an encoder subprocess
(`-video-cmd`) sending H.264 RTP (1200-byte packets) to `127.0.0.1:{port}`,
so no cgo or GStreamer headers are needed to build it.

## Keys (ADR-0030)

The agent has its own Ed25519 key (`-key`, default `drone.key`, created with
mode 0600 if it doesn't exist). The server must know its public half before
it lets the drone connect, and the agent must know the server's public key
before it lets any browser in:

```bash
./bin/agent -print-key                                  # the drone's public key
cd ../server && npm run cli -- drone:add drone-1 <that key>
npm run cli -- keys:show                                # the server's public key
./bin/agent -server-pubkey <that key> ...               # every run from now on
```

On connect the server sends a random challenge and the agent signs it; each
browser offer then arrives with a session token the server signed, naming the
user, this vehicle and the session, which the agent checks (signature,
vehicle, session, expiry by the server's clock) before answering. The flight
log records the user. Without `-server-pubkey` every browser is refused,
unless `-insecure-dev-tokens` is given (bench only).

## Run on one machine (prove the basics)

The server set up as in `../server/README.md` (an admin, `drone-1`
registered), then:

```bash
cd server && npm start                         # API and signalling on :8788
cd agent && ./bin/agent -server-pubkey <server key> \
  -video-cmd "ffmpeg -loglevel error -re -f lavfi -i testsrc=size=1280x720:rate=30 -pix_fmt yuv420p -c:v libx264 -profile:v baseline -tune zerolatency -preset ultrafast -b:v 1500k -g 30 -f rtp -pkt_size 1200 rtp://127.0.0.1:{port}"
cd web && VITE_VEHICLE_LINK=webrtc npm run dev  # then sign in and pick Drone 1
```

## Run against ArduPlane SITL

See `../sim/README.md`. In short: `docker compose up -d` in `sim/`, then
`go run ./cmd/sitlcheck` for a scripted flight with no browser, or
`go run ./cmd/agent -fc tcp:127.0.0.1:5760 -video-cmd "" -server-pubkey <server key>`
to fly it from the browser (`npm run e2e:sitl` in `web/` sets all of this up
by itself).

## Run on the Raspberry Pi 5

Raspberry Pi OS (64-bit). The Pi 5 has no hardware H.264 encoder, so video
is software x264 from GStreamer:

```bash
sudo apt install -y gstreamer1.0-tools gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-ugly stun-client
./agent-linux-arm64 -signal wss://<signalling host>/signal -iface wlan0 -log agent.jsonl \
  -key /etc/cellular-drone/drone.key -server-pubkey <server key>
```

`-iface wlan0` keeps ICE on the real network (VPN interfaces like Tailscale
would otherwise offer their own path). The default `-video-cmd` is a 720p30
GStreamer test pattern at 1.5 Mbit/s with the wall clock burned in, for
reading glass-to-glass latency off the browser.

## Flags worth knowing

| Flag | Default | |
| --- | --- | --- |
| `-fc` | none (link-test mode) | flight controller: `tcp:HOST:PORT` (SITL) or `serial:DEVICE:BAUD` |
| `-signal` | `ws://localhost:8788/signal` | signalling server |
| `-vehicle` | `drone-1` | id the browser connects to |
| `-stun` | Google STUN | comma-separated STUN/TURN URLs |
| `-iface` | all but VPN/tunnel | restrict ICE to one interface |
| `-ice-disconnected` / `-ice-failed` / `-ice-keepalive` | 4s / 15s / 1s | tuned for cellular |
| `-log` | stdout | JSONL debug log (ICE, sessions, MAVLink chatter) |
| `-key` | `drone.key` | the drone's private key, created if missing; `-print-key` prints its public half and exits |
| `-server-pubkey` | none | the server's session-signing key (`npm run cli -- keys:show`). Without it every browser is refused |
| `-insecure-dev-tokens` | off | with no `-server-pubkey`, accept unsigned session tokens. **Bench only**: anyone who can reach the signalling server can command the vehicle (`../SECURITY.md`) |
| `-flight-log-dir` | `flightlogs` | the flight log: one JSONL file per start, empty = off (see below) |
| `-upload-logs` / `-api` | `5m` / from `-signal` | how often to upload finished flight logs (0 = never), and the server's URL for it |

## Flight log

The drone's own audit record (ARCHITECTURE.md, command model), apart from the debug log and written whether or not a browser is connected. One file per agent start, `flight-<UTC start>.jsonl`. Finished files (every one but the file being written) are uploaded to the server every `-upload-logs` (5 min), signed with the drone's key, and moved into `uploaded/`; nothing is deleted. Every line has `ts`, `kind` and `vehicle`:

| `kind` | When | Fields |
| --- | --- | --- |
| `agent` | start, shutdown | `what`, `detail` |
| `session` | a browser session opens or closes | `session`, `what`; opening: `user`, `role` (from the server's signed token); closing: `reason` |
| `command` | every `cmd.request`, accepted or refused | `session`, `requestId`, `command`, `result` |
| `mission_upload` | every `mission.upload` | `session`, `requestId`, `missionId`, `items`, `result`, `rowsOnVehicle` |
| `event` | FC mode change, failsafe, RC override, status text | `event` (the `telemetry.event` payload) |
| `state` | every 1 s armed, every 10 s disarmed | `state` (`VehicleState`) |

Audit records are fsynced; state samples aren't, so a power cut loses at most a few seconds of samples. Sessions are identified by session id only until the server signs session tokens with the user in them. Uploading logs to the server after landing is still to do.
