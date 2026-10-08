// Command agent is the drone-side WebRTC peer (ADR-0014 link slice): it
// holds an outbound signalling connection, answers browser offers, streams a
// video track and placeholder telemetry, and logs everything about the
// network path as JSONL.
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/bluenviron/gomavlib/v3"
	"github.com/pion/webrtc/v4"

	"github.com/tomwildoer/cellular-drone/agent/internal/fc"
	"github.com/tomwildoer/cellular-drone/agent/internal/protocol"
	"github.com/tomwildoer/cellular-drone/agent/internal/session"
	"github.com/tomwildoer/cellular-drone/agent/internal/signalling"
	"github.com/tomwildoer/cellular-drone/agent/internal/video"
)

// A live test pattern with the wall clock burned in, so glass-to-glass
// latency can be read straight off the browser's video. Constrained baseline
// decodes in every browser. The pipeline packetises its own RTP to the agent
// (see package video); config-interval=-1 repeats SPS/PPS with every
// keyframe so a viewer can start decoding mid-stream.
const defaultVideoCmd = "gst-launch-1.0 -q videotestsrc is-live=true pattern=ball " +
	"! video/x-raw,width=1280,height=720,framerate=30/1 " +
	"! clockoverlay time-format=%H:%M:%S " +
	"! x264enc tune=zerolatency speed-preset=ultrafast bitrate=1500 key-int-max=30 " +
	"! video/x-h264,profile=constrained-baseline " +
	"! rtph264pay config-interval=-1 pt=96 mtu=1200 " +
	"! udpsink host=127.0.0.1 port=" + video.PortPlaceholder

func main() {
	signalURL := flag.String("signal", "ws://localhost:8788/signal", "signalling server WebSocket URL")
	vehicleID := flag.String("vehicle", "drone-1", "vehicle id the browser connects to")
	stun := flag.String("stun", "stun:stun.l.google.com:19302", "comma-separated STUN/TURN URLs (empty = host candidates only)")
	iface := flag.String("iface", "", "restrict ICE to this interface, e.g. wlan0 (default: all but VPN/tunnel interfaces)")
	udpPort := flag.Int("udp-port", 0, "serve all ICE traffic from this one UDP port, e.g. for a router port forward (0 = random ports)")
	advertiseIP := flag.String("advertise-ip", "", "comma-separated public IPs to offer on -udp-port (the router's public address when forwarding)")
	videoCmd := flag.String("video-cmd", defaultVideoCmd, "encoder command sending H.264 RTP to 127.0.0.1:{port} (empty = no video)")
	videoPort := flag.Int("video-port", 5004, "local UDP port the encoder sends RTP to")
	fcAddr := flag.String("fc", "", "flight controller MAVLink: tcp:HOST:PORT (SITL, e.g. tcp:127.0.0.1:5760) or serial:DEVICE:BAUD (e.g. serial:/dev/ttyS2:921600); empty = link-test mode with no FC")
	logPath := flag.String("log", "-", "JSONL log file (- = stdout)")
	homeLat := flag.Float64("home-lat", -37.861, "reported home latitude")
	homeLon := flag.Float64("home-lon", 145.062, "reported home longitude")
	iceDisconnected := flag.Duration("ice-disconnected", 4*time.Second, "ICE disconnected timeout")
	iceFailed := flag.Duration("ice-failed", 15*time.Second, "ICE failed timeout")
	iceKeepalive := flag.Duration("ice-keepalive", time.Second, "ICE keepalive interval")
	flag.Parse()

	var out io.Writer = os.Stdout
	if *logPath != "-" {
		f, err := os.OpenFile(*logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
		if err != nil {
			slog.Error("open log", "error", err.Error())
			os.Exit(1)
		}
		defer f.Close()
		out = f
	}
	log := slog.New(slog.NewJSONHandler(out, nil)).With("vehicle", *vehicleID)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var videoSource *video.Source
	if *videoCmd != "" {
		var err error
		if videoSource, err = video.NewSource(*videoCmd, *videoPort, log); err != nil {
			log.Error("video_init_failed", "error", err.Error())
			os.Exit(1)
		}
	}

	var client *signalling.Client
	var manager *session.Manager
	var vehicle session.Vehicle
	if *fcAddr != "" {
		endpoint, err := fcEndpoint(*fcAddr)
		if err != nil {
			log.Error("fc_config_invalid", "error", err.Error())
			os.Exit(1)
		}
		link, err := fc.New(fc.Config{
			Endpoint:  endpoint,
			VehicleID: *vehicleID,
			Log:       log,
			OnEvent: func(ev fc.Event) {
				if manager != nil {
					manager.BroadcastEvent(ev)
				}
			},
		})
		if err != nil {
			log.Error("fc_init_failed", "error", err.Error())
			os.Exit(1)
		}
		go link.Run(ctx)
		vehicle = link
	}

	manager, err := session.NewManager(session.Config{
		VehicleID:              *vehicleID,
		Home:                   protocol.HomePosition{Lat: *homeLat, Lon: *homeLon},
		ICEServers:             iceServers(*stun),
		Interface:              *iface,
		UDPPort:                *udpPort,
		AdvertiseIPs:           splitList(*advertiseIP),
		ICEDisconnectedTimeout: *iceDisconnected,
		ICEFailedTimeout:       *iceFailed,
		ICEKeepalive:           *iceKeepalive,
		TelemetryInterval:      100 * time.Millisecond,
		FailedGrace:            2 * time.Minute,
	}, videoSource, vehicle, func(msg protocol.Signalling) { client.Send(msg) }, log)
	if err != nil {
		log.Error("webrtc_init_failed", "error", err.Error())
		os.Exit(1)
	}

	client = signalling.NewClient(*signalURL, *vehicleID, func(msg protocol.Signalling) {
		switch msg.Type {
		case "offer":
			manager.HandleOffer(msg)
		case "ice":
			manager.AddCandidate(msg)
		case "error":
			log.Warn("signalling_error", "message", msg.Message)
		}
	}, log)

	log.Info("agent_started", "signal", *signalURL, "video", *videoCmd != "", "iface", *iface, "fc", *fcAddr)
	client.Run(ctx)
	manager.CloseAll("agent shutting down")
}

func iceServers(urls string) []webrtc.ICEServer {
	var servers []webrtc.ICEServer
	for _, url := range splitList(urls) {
		servers = append(servers, webrtc.ICEServer{URLs: []string{url}})
	}
	return servers
}

func splitList(csv string) []string {
	var out []string
	for _, item := range strings.Split(csv, ",") {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	return out
}

// fcEndpoint parses -fc: tcp:HOST:PORT or serial:DEVICE:BAUD.
func fcEndpoint(spec string) (gomavlib.EndpointConf, error) {
	kind, rest, _ := strings.Cut(spec, ":")
	switch kind {
	case "tcp":
		return gomavlib.EndpointTCPClient{Address: rest}, nil
	case "serial":
		i := strings.LastIndex(rest, ":")
		if i < 0 {
			return nil, fmt.Errorf("serial needs DEVICE:BAUD, got %q", rest)
		}
		baud, err := strconv.Atoi(rest[i+1:])
		if err != nil {
			return nil, fmt.Errorf("bad baud rate %q", rest[i+1:])
		}
		return gomavlib.EndpointSerial{Device: rest[:i], Baud: baud}, nil
	}
	return nil, fmt.Errorf("unknown -fc kind %q (want tcp: or serial:)", kind)
}
