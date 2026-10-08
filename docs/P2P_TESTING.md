# P2P link testing with a Raspberry Pi 5 (handoff notes)

Notes from a planning chat (2026-10-05). Status: recorded as ADR-0014, and the tasks are in `docs/PLAN.md`.
Steps 1 and 2 are done. Results are in `docs/DECISIONS.md` (Link test results). The hotspot's symmetric IPv4 NAT led to
ADR-0015: IPv6 end to end is the direct path, and TURN is on hold.

## Goal

Start building and debugging the real drone ↔ browser WebRTC link now, using a **Raspberry Pi 5 as a stand-in air unit**,
under conditions as close as practical to the final setup: the drone on LTE behind carrier CGNAT, and the operator's
browser on a different network, with TURN fallback through a VPS.

The challenge is making the network realistic. On shared home wifi, WebRTC connects instantly over LAN host candidates
and never exercises CGNAT, TURN, a weak uplink, outages or IP changes.

## Current setup decision

- **Pi 5: on home wifi**, behind the home router's NAT.
- **Laptop (browser): on the phone's hotspot**, behind carrier CGNAT plus the phone's tethering NAT.
- So the two ends are on different networks, with one carrier NAT and one home NAT. That's roughly the same NAT
  combination as the final system, with the sides swapped.
- **Known gap:** video flows Pi → browser, so with this arrangement the constrained link is the hotspot's *download*,
  not the drone's *upload* (the real bottleneck). NAT behaviour is realistic; bandwidth and latency are not.
  Later, put the Pi on the hotspot or a real LTE modem to fix that.
- Decided against moving the Pi to the hotspot for now (it means switching wifi over SSH and losing SSH access).

## Draft ADR-0014: Pi 5 as a stand-in air unit for link work

**Context:** Want to develop and debug the real WebRTC transport before the Radxa, modem and airframe exist.
**Decision:** Use a Raspberry Pi 5 as a temporary air unit for transport and signalling work. This pulls a thin slice
of Phase 1b (agent) and Phase 1c (signalling, coturn, `WebRtcLink`) forward, ahead of finishing the 1a UI.
**Consequences:**
- The Pi 5 has **no hardware H.264 encoder** (the Pi 4 had one; the 5 dropped it). Use software x264. Transport results
  are valid, but CPU and encode-latency numbers do **not** predict the Radxa's MPP encoder.
- Same arch as the Radxa (arm64), so the same `GOARCH=arm64` agent binary carries over.

## Minimal slice to build

**Agent (Go + Pion), running on the Pi**
- WSS client to signalling, with reconnect.
- Pion peer with the `telemetry` channel (unordered, `maxRetransmits: 0`) and the `control` channel (reliable, ordered).
- Video: GStreamer `videotestsrc → x264enc` (720p30, 1–2 Mbps) into a `TrackLocalStaticSample`.
- `ping`/`pong` plus a stub `telemetry.state`, using the real `protocol/` v1 envelope.
- Session-token verification can be stubbed for now, but keep the hook in the code path.
- Later: telemetry from SITL on the laptop over UDP MAVLink.
- Tune ICE timeouts for cellular with `SettingEngine.SetICETimeouts` (the defaults assume a stable network).
- Log ICE state changes and the selected candidate pair as JSONL.

**Browser**
- Write `WebRtcLink` against the existing `VehicleLink` interface (not a throwaway test page), so the contract tests apply.
- The browser is the SDP offerer, so **the browser must drive ICE restart** after an IP change or a failure.
- Feed `getStats()` into `LinkStatus`: the selected candidate-pair type gives `path` (direct vs relayed), plus `rttMs`
  and `videoKbps`. The link badge then doubles as the debugging display.

**Infrastructure**
- **Signalling must be publicly reachable.** With the laptop on the hotspot, it can't reach a server on the Pi or on the
  home LAN. Options: rent the VPS now (Sydney or Melbourne region), or as a stopgap expose a local signalling server
  through Cloudflare Tunnel or Tailscale Funnel (both handle WebSockets).
- STUN: public Google STUN (`stun:stun.l.google.com:19302`) is fine to start.
- TURN: needs coturn on a **public IP** (the VPS), with time-limited REST credentials. Without TURN, a symmetric carrier
  NAT means the connection just fails. That's a useful finding in itself (it tells us whether the carrier allows direct paths).

## Gotchas

- **IPv6 can bypass NAT entirely.** Telstra and other Australian carriers give mobile devices public IPv6, and many NBN
  home connections have it too. If both ends have IPv6, WebRTC may connect directly and never test CGNAT.
  Always check the selected pair in `chrome://webrtc-internals`. Run once as-is and once with IPv6 off to force the
  IPv4/CGNAT path (on the Pi: `sudo sysctl -w net.ipv6.conf.all.disable_ipv6=1`). If IPv6 works end to end, record it:
  it's good news for the real drone on the same carrier.
- **Tailscale (if installed) creates its own P2P path.** Restrict Pion to the real interface with
  `SettingEngine.SetInterfaceFilter`, or tests may silently route over Tailscale.
- **Phone hotspots switch off** when idle or when the screen sleeps. Keep the phone awake and plugged in.
- **Data usage:** 1–2 Mbps of video is roughly 0.5–1 GB per hour.

## Quick network checks

```bash
ip -brief addr show wlan0
curl -4 -s https://ifconfig.me; echo     # public IPv4
curl -6 -s https://ifconfig.me; echo     # public IPv6 (empty/error = none)
```
- A carrier-side address in `100.64.0.0/10` means CGNAT.
- `stunclient --mode behavior <stun-server>` (package `stuntman-client`) reports the NAT mapping type:
  endpoint-independent (direct P2P likely) vs endpoint-dependent (expect TURN).

## Test matrix (record results in `docs/DECISIONS.md`)

For each combination of NAT arrangement, browser network, IPv6 on/off and impairment, record:
- whether a direct path formed or TURN was used (and which TURN transport)
- connection setup time
- recovery time after an outage
- RTT and video bitrate / latency floor

Include a forced-relay run: `iceTransportPolicy: "relay"` in the browser.

## Later: controlled lab on the Pi (repeatable fault injection)

Run the agent in a network namespace behind its own NAT, then shape the link with `tc netem`.

```bash
sudo ip netns add drone
sudo ip link add veth-h type veth peer name veth-d
sudo ip link set veth-d netns drone
sudo ip addr add 10.99.0.1/24 dev veth-h && sudo ip link set veth-h up
sudo ip netns exec drone sh -c 'ip addr add 10.99.0.2/24 dev veth-d; ip link set veth-d up; ip link set lo up; ip route add default via 10.99.0.1'
sudo sysctl -w net.ipv4.ip_forward=1
# --random-fully = symmetric-NAT-like mapping (hostile case). Also test without it.
sudo iptables -t nat -A POSTROUTING -s 10.99.0.0/24 -o wlan0 -j MASQUERADE --random-fully
# stop the "drone" reaching the home LAN directly
sudo iptables -A FORWARD -s 10.99.0.0/24 -d 192.168.0.0/16 -j DROP

# impairment: uplink (drone → world) and downlink, shaped on each veth end
sudo ip netns exec drone tc qdisc add dev veth-d root netem delay 40ms 15ms loss 1% rate 3mbit
sudo tc qdisc add dev veth-h root netem delay 40ms 15ms loss 0.5%

sudo ip netns exec drone ./agent ...
```

Scripted events to test:
- bandwidth steps (e.g. 3 → 0.8 → 3 Mbit): video adapts, telemetry stays smooth
- outages of 2 s, 10 s and 30 s (iptables DROP in the netns): Pion `disconnected` → `failed` timing, and what the UI shows
- IP change (re-address the netns or flush conntrack): mimics a modem reconnect or handover, and needs ICE restart

## Suggested order

1. Agent slice + `WebRtcLink` working on plain home wifi (both on the LAN) to prove the basics.
2. Laptop on the hotspot, signalling reachable publicly (VPS or tunnel), STUN only. Check IPv6 and the selected path.
3. coturn on the VPS. Forced-relay test.
4. netns lab + netem + scripted outages and IP changes.
5. Pi on the hotspot, then on a real SIM and modem (EG25-G or EC25-AU, with band 28): measure how often the carrier forces TURN.

## Review findings still to triage (from the same chat)

Not part of the P2P work, but worth recording in `docs/OPEN_QUESTIONS.md` / `DECISIONS.md`:

1. **Clock-mode loiter (ADR-0013) has no native ArduPilot equivalent.** Mission items support turns, a duration or
   unlimited loiter, not "until a time of day". Doing it from the agent breaks "safe with no link". A Lua script on the
   FC keeps it onboard, but F4 boards can't run Lua, so this effectively forces an H743-class FC (ADR-0002).
   The loiter exit-toward-next-waypoint behaviour *is* native. General rule: the mock should only simulate what
   ArduPilot can actually do.
2. **RC and GCS failsafes share `FS_SHORT_ACTN` / `FS_LONG_ACTN` in ArduPlane**, so "GCS loss action configurable per
   mission" can't be set independently of RC loss through parameters alone. Test RC loss and GCS loss while paused in
   QLOITER in SITL (VTOL modes have their own failsafe paths via `Q_OPTIONS`).
3. **A closed browser vs dead LTE:** ~~the agent stops heartbeats when the browser leaves, so a closed laptop lid while
   paused triggers RTL.~~ Resolved by ADR-0020: no GCS failsafe, and `pause_resume.lua` resumes a commanded pause after
   120 s.
4. **`mode.pause` should choose LOITER in fixed-wing flight and QLOITER in hover**, based on `vtolState`. QLOITER during
   cruise forces a back-transition.
5. **No RTC on the Radxa.** Token expiry and ADR-0013 both need correct time. Define the time source (NTP over LTE,
   GPS time via `SYSTEM_TIME`) and behaviour before it's valid. Also decide on token refresh mid-flight.
6. **BOM for Australia:** EC25-E is a European-band part. Use EC25-AU or EG25-G (band 28 for rural coverage).
   Regulations are CASA (VLOS for recreational/excluded; BVLOS needs a ReOC and specific approval). VPS in Sydney/Melbourne.
7. **ELRS receiver failsafe** set to "no pulses" so the FC actually detects RC loss.
8. **Doc drift:** PLAN Exit 1a says "phone and laptop" though phone is deferred; ADR-0010 says "mobile-first" vs
   laptop-primary in CLAUDE.md.
