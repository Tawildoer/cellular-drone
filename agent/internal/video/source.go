// Package video forwards an external encoder's H.264 RTP stream into a
// WebRTC track. The encoder runs as a subprocess (e.g. a gst-launch-1.0
// pipeline ending in rtph264pay ! udpsink) sending RTP to a local UDP port,
// and the agent relays the packets untouched apart from SSRC/payload type.
//
// The encoder's own RTP packetiser knows where each frame ends, so frames
// with several slices (x264's low-latency mode emits one per thread) keep one
// timestamp and a correct marker bit, and nothing waits on the next frame to
// find the end of this one. Parsing a raw byte stream gets both wrong. The
// agent stays pure Go, and the same code serves a software encoder on the Pi
// and a hardware one (MPP) on the Radxa: only the command changes.
package video

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pion/webrtc/v4"
)

const restartDelay = 2 * time.Second

// PortPlaceholder in the encoder command is replaced with the local RTP port.
const PortPlaceholder = "{port}"

// Source owns one track shared by every peer connection (the track fans each
// packet out to all of them), and runs the encoder only while at least one
// session holds it, so an idle drone isn't burning CPU on frames nobody sees.
type Source struct {
	Track *webrtc.TrackLocalStaticRTP

	command string
	log     *slog.Logger

	mu     sync.Mutex
	refs   int
	cancel context.CancelFunc
}

// NewSource listens for the encoder's RTP on 127.0.0.1:rtpPort and starts
// relaying it into the track straight away; the encoder itself starts on the
// first Acquire.
func NewSource(command string, rtpPort int, log *slog.Logger) (*Source, error) {
	track, err := webrtc.NewTrackLocalStaticRTP(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeH264, ClockRate: 90000},
		"video", "drone",
	)
	if err != nil {
		return nil, err
	}
	conn, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: rtpPort})
	if err != nil {
		return nil, fmt.Errorf("listen for encoder RTP on port %d: %w", rtpPort, err)
	}
	s := &Source{
		Track:   track,
		command: strings.ReplaceAll(command, PortPlaceholder, strconv.Itoa(rtpPort)),
		log:     log,
	}
	go s.relay(conn)
	return s, nil
}

func (s *Source) relay(conn *net.UDPConn) {
	buf := make([]byte, 1600)
	for {
		n, err := conn.Read(buf)
		if err != nil {
			s.log.Error("video_rtp_read_failed", "error", err.Error())
			return
		}
		if _, err := s.Track.Write(buf[:n]); err != nil && !errors.Is(err, io.ErrClosedPipe) {
			s.log.Warn("video_rtp_write_failed", "error", err.Error())
		}
	}
}

// Acquire starts the encoder if this is the first holder.
func (s *Source) Acquire() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refs++
	if s.refs == 1 && s.command != "" {
		ctx, cancel := context.WithCancel(context.Background())
		s.cancel = cancel
		go s.run(ctx)
	}
}

// Release stops the encoder once the last holder lets go.
func (s *Source) Release() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.refs == 0 {
		return
	}
	s.refs--
	if s.refs == 0 && s.cancel != nil {
		s.cancel()
		s.cancel = nil
	}
}

func (s *Source) run(ctx context.Context) {
	for ctx.Err() == nil {
		err := s.encode(ctx)
		if ctx.Err() != nil {
			return
		}
		s.log.Warn("video_encoder_exited", "error", err.Error(), "restart_in", restartDelay.String())
		select {
		case <-ctx.Done():
			return
		case <-time.After(restartDelay):
		}
	}
}

func (s *Source) encode(ctx context.Context) error {
	cmd := exec.CommandContext(ctx, "sh", "-c", s.command)
	stderr := &tailBuffer{max: 2048}
	cmd.Stderr = stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	s.log.Info("video_encoder_started", "pid", cmd.Process.Pid)
	err := cmd.Wait()
	return fmt.Errorf("encoder exited: %v (stderr: %s)", err, stderr.String())
}

// tailBuffer keeps the last max bytes written — enough of an encoder's stderr
// to say why it died, without growing for as long as it runs.
type tailBuffer struct {
	mu  sync.Mutex
	max int
	buf []byte
}

func (b *tailBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.buf = append(b.buf, p...)
	if len(b.buf) > b.max {
		b.buf = b.buf[len(b.buf)-b.max:]
	}
	return len(p), nil
}

func (b *tailBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return strings.TrimSpace(string(b.buf))
}
