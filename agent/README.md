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
(`-video-cmd`) writing Annex-B H.264 to stdout, so no cgo or GStreamer
headers are needed to build it.

## Run on one machine (prove the basics)

```bash
cd server && npm start                         # signalling on :8788
cd agent && ./bin/agent \
  -video-cmd "ffmpeg -loglevel error -re -f lavfi -i testsrc=size=1280x720:rate=30 -pix_fmt yuv420p -c:v libx264 -profile:v baseline -tune zerolatency -preset ultrafast -b:v 1500k -g 30 -f h264 -"
cd web && VITE_VEHICLE_LINK=webrtc npm run dev  # then open the app and pick Drone 1
```

## Run against ArduPlane SITL

See `../sim/README.md`. In short: `docker compose up -d` in `sim/`, then
`go run ./cmd/sitlcheck` for a scripted flight with no browser, or
`go run ./cmd/agent -fc tcp:127.0.0.1:5760 -video-cmd ""` to fly it from
the browser.

## Run on the Raspberry Pi 5

Raspberry Pi OS (64-bit). The Pi 5 has no hardware H.264 encoder, so video
is software x264 from GStreamer:

```bash
sudo apt install -y gstreamer1.0-tools gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-ugly stun-client
./agent-linux-arm64 -signal wss://<signalling host>/signal -iface wlan0 -log agent.jsonl
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
| `-log` | stdout | JSONL log file |
