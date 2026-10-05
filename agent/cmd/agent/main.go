// Command agent is the drone-side WebRTC peer (ADR-0014 link slice): it
// holds an outbound signalling connection, answers browser offers, streams a
// video track and placeholder telemetry, and logs everything about the
// network path as JSONL.
package main

import (
	"context"
	"flag"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/pion/webrtc/v4"

	"github.com/tomwildoer/cellular-drone/agent/internal/protocol"
	"github.com/tomwildoer/cellular-drone/agent/internal/session"
	"github.com/tomwildoer/cellular-drone/agent/internal/signalling"
	"github.com/tomwildoer/cellular-drone/agent/internal/video"
)

// A live test pattern with the wall clock burned in, so glass-to-glass
// latency can be read straight off the browser's video. Constrained baseline
// decodes in every browser.
const defaultVideoCmd = "gst-launch-1.0 -q videotestsrc is-live=true pattern=ball " +
	"! video/x-raw,width=1280,height=720,framerate=30/1 " +
	"! clockoverlay time-format=%H:%M:%S " +
	"! x264enc tune=zerolatency speed-preset=ultrafast bitrate=1500 key-int-max=30 " +
	"! video/x-h264,profile=constrained-baseline,stream-format=byte-stream " +
	"! fdsink fd=1"

func main() {
	signalURL := flag.String("signal", "ws://localhost:8788/signal", "signalling server WebSocket URL")
	vehicleID := flag.String("vehicle", "drone-1", "vehicle id the browser connects to")
	stun := flag.String("stun", "stun:stun.l.google.com:19302", "comma-separated STUN/TURN URLs (empty = host candidates only)")
	iface := flag.String("iface", "", "restrict ICE to this interface, e.g. wlan0 (default: all but VPN/tunnel interfaces)")
	videoCmd := flag.String("video-cmd", defaultVideoCmd, "shell command writing Annex-B H.264 to stdout (empty = no video)")
	fps := flag.Int("fps", 30, "frame rate of the video command's output")
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
		if videoSource, err = video.NewSource(*videoCmd, *fps, log); err != nil {
			log.Error("video_init_failed", "error", err.Error())
			os.Exit(1)
		}
	}

	var client *signalling.Client
	manager, err := session.NewManager(session.Config{
		VehicleID:              *vehicleID,
		Home:                   protocol.HomePosition{Lat: *homeLat, Lon: *homeLon},
		ICEServers:             iceServers(*stun),
		Interface:              *iface,
		ICEDisconnectedTimeout: *iceDisconnected,
		ICEFailedTimeout:       *iceFailed,
		ICEKeepalive:           *iceKeepalive,
		TelemetryInterval:      100 * time.Millisecond,
		FailedGrace:            2 * time.Minute,
	}, videoSource, func(msg protocol.Signalling) { client.Send(msg) }, log)
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

	log.Info("agent_started", "signal", *signalURL, "video", *videoCmd != "", "iface", *iface)
	client.Run(ctx)
	manager.CloseAll("agent shutting down")
}

func iceServers(urls string) []webrtc.ICEServer {
	var servers []webrtc.ICEServer
	for _, url := range strings.Split(urls, ",") {
		if url = strings.TrimSpace(url); url != "" {
			servers = append(servers, webrtc.ICEServer{URLs: []string{url}})
		}
	}
	return servers
}
