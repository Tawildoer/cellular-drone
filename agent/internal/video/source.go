// Package video turns an external encoder's H.264 byte stream into a WebRTC
// track. The encoder runs as a subprocess (e.g. gst-launch-1.0) writing
// Annex-B H.264 to stdout, so the agent stays pure Go and cross-compiles
// without cgo, and the same code serves a software encoder on the Pi and a
// hardware one (MPP) on the Radxa — only the command changes.
package video

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
	"github.com/pion/webrtc/v4/pkg/media/h264reader"
)

const restartDelay = 2 * time.Second

// Source owns one track shared by every peer connection (a
// TrackLocalStaticSample fans each sample out to all of them), and runs the
// encoder only while at least one session holds it, so an idle drone isn't
// burning CPU on frames nobody sees.
type Source struct {
	Track *webrtc.TrackLocalStaticSample

	command   string
	frameTime time.Duration
	log       *slog.Logger

	mu     sync.Mutex
	refs   int
	cancel context.CancelFunc
}

func NewSource(command string, fps int, log *slog.Logger) (*Source, error) {
	track, err := webrtc.NewTrackLocalStaticSample(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeH264, ClockRate: 90000},
		"video", "drone",
	)
	if err != nil {
		return nil, err
	}
	return &Source{Track: track, command: command, frameTime: time.Second / time.Duration(fps), log: log}, nil
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
		err := s.stream(ctx)
		if ctx.Err() != nil {
			return
		}
		s.log.Warn("video_encoder_exited", "error", errString(err), "restart_in", restartDelay.String())
		select {
		case <-ctx.Done():
			return
		case <-time.After(restartDelay):
		}
	}
}

func (s *Source) stream(ctx context.Context) error {
	cmd := exec.CommandContext(ctx, "sh", "-c", s.command)
	stderr := &tailBuffer{max: 2048}
	cmd.Stderr = stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	defer func() { _ = cmd.Wait() }()
	s.log.Info("video_encoder_started", "pid", cmd.Process.Pid)

	reader, err := h264reader.NewReader(stdout)
	if err != nil {
		return fmt.Errorf("%w (encoder stderr: %s)", err, stderr.String())
	}
	for {
		nal, err := reader.NextNAL()
		if errors.Is(err, io.EOF) {
			_ = cmd.Wait()
			return fmt.Errorf("encoder closed its output (stderr: %s)", stderr.String())
		}
		if err != nil {
			return err
		}
		// Only picture slices advance the clock: SPS/PPS/SEI belong to the
		// frame that follows and share its timestamp.
		var duration time.Duration
		if nal.UnitType == h264reader.NalUnitTypeCodedSliceIdr || nal.UnitType == h264reader.NalUnitTypeCodedSliceNonIdr {
			duration = s.frameTime
		}
		if err := s.Track.WriteSample(media.Sample{Data: nal.Data, Duration: duration}); err != nil && !errors.Is(err, io.ErrClosedPipe) {
			return err
		}
	}
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

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
