// Package flightlog is the drone's own record of what happened: every
// command and mission upload with the session that asked and the result,
// every flight controller event, browser sessions coming and going, and a
// sample of the vehicle state. It's the audit log ARCHITECTURE.md asks for,
// kept apart from the agent's debug log (ICE noise) and written whether or
// not a browser is connected, so it covers flights nobody was watching.
//
// One JSONL file per agent start (≈ one per power-up, so usually one per
// flight). Writes go through a goroutine, so callers on the MAVLink read
// path never wait on the disk; audit records are fsynced, state samples
// aren't, so a power cut loses at most a few seconds of samples.
package flightlog

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/tomwildoer/cellular-drone/agent/internal/protocol"
)

// Record kinds, the "kind" field of every line.
const (
	KindAgent         = "agent"          // agent started or stopping
	KindSession       = "session"        // browser session opened or closed
	KindCommand       = "command"        // cmd.request and its result
	KindMissionUpload = "mission_upload" // mission.upload and its result
	KindEvent         = "event"          // FC event: mode, failsafe, RC override, status text
	KindState         = "state"          // periodic VehicleState sample
)

// How often to sample the vehicle state: often enough to replay a flight,
// rarely enough that a drone sitting on the bench doesn't fill the card.
const (
	SampleArmed    = time.Second
	SampleDisarmed = 10 * time.Second
)

// queueSize is how many records may wait for the disk. A full queue drops
// state samples first, and only blocks for audit records.
const queueSize = 1024

type record struct {
	line []byte
	sync bool
}

// Log is safe for concurrent use. A nil *Log records nothing, so callers
// don't need to check whether logging is on.
type Log struct {
	f       *os.File
	debug   *slog.Logger
	vehicle string
	queue   chan record
	done    chan struct{}

	closeOnce sync.Once
	mu        sync.Mutex // guards closed against sends
	closed    bool
}

// Open creates dir if needed and starts a new log file in it, named by the
// UTC start time.
func Open(dir, vehicleID string, debug *slog.Logger) (*Log, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("flight log dir: %w", err)
	}
	name := fmt.Sprintf("flight-%s.jsonl", time.Now().UTC().Format("20060102T150405Z"))
	f, err := os.OpenFile(filepath.Join(dir, name), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, fmt.Errorf("flight log: %w", err)
	}
	l := &Log{f: f, debug: debug, vehicle: vehicleID, queue: make(chan record, queueSize), done: make(chan struct{})}
	go l.writer()
	return l, nil
}

// Path is the file being written.
func (l *Log) Path() string {
	if l == nil {
		return ""
	}
	return l.f.Name()
}

// Agent records the agent starting or stopping.
func (l *Log) Agent(what string, fields map[string]any) {
	l.write(KindAgent, map[string]any{"what": what, "detail": fields}, true)
}

// Session records a browser session opening or closing.
func (l *Log) Session(sessionID, what, reason string) {
	l.write(KindSession, map[string]any{"session": sessionID, "what": what, "reason": reason}, true)
}

// Command records a browser command and what the agent did with it.
func (l *Log) Command(sessionID, requestID string, cmd protocol.Command, result protocol.CommandResult) {
	l.write(KindCommand, map[string]any{
		"session": sessionID, "requestId": requestID, "command": cmd, "result": result,
	}, true)
}

// MissionUpload records a mission upload: which mission, how big, the
// result and how many rows the FC read back.
func (l *Log) MissionUpload(sessionID, requestID, missionID string, items int, result protocol.CommandResult, rows int) {
	l.write(KindMissionUpload, map[string]any{
		"session": sessionID, "requestId": requestID, "missionId": missionID,
		"items": items, "result": result, "rowsOnVehicle": rows,
	}, true)
}

// Event records a flight controller event (one of the protocol event structs).
func (l *Log) Event(ev any) {
	l.write(KindEvent, map[string]any{"event": ev}, true)
}

// State records a vehicle state sample.
func (l *Log) State(st protocol.VehicleState) {
	l.write(KindState, map[string]any{"state": st}, false)
}

// Close flushes what's queued and closes the file.
func (l *Log) Close() {
	if l == nil {
		return
	}
	l.closeOnce.Do(func() {
		l.mu.Lock()
		l.closed = true
		close(l.queue)
		l.mu.Unlock()
		<-l.done
		_ = l.f.Close()
	})
}

func (l *Log) write(kind string, fields map[string]any, audit bool) {
	if l == nil {
		return
	}
	fields["ts"] = time.Now().UTC().Format(time.RFC3339Nano)
	fields["kind"] = kind
	fields["vehicle"] = l.vehicle
	line, err := json.Marshal(fields)
	if err != nil {
		l.debug.Warn("flight_log_encode_failed", "kind", kind, "error", err.Error())
		return
	}
	rec := record{line: append(line, '\n'), sync: audit}

	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return
	}
	if audit {
		l.queue <- rec // an audit record waits for room rather than vanish
		return
	}
	select {
	case l.queue <- rec:
	default:
		l.debug.Warn("flight_log_sample_dropped")
	}
}

func (l *Log) writer() {
	defer close(l.done)
	failed := false
	for rec := range l.queue {
		_, err := l.f.Write(rec.line)
		if err == nil && rec.sync {
			err = l.f.Sync()
		}
		// Log the first failure (disk full, card gone), not one per record.
		if err != nil && !failed {
			l.debug.Error("flight_log_write_failed", "error", err.Error())
		}
		failed = err != nil
	}
}

// Sample records the vehicle state every SampleArmed while armed and every
// SampleDisarmed otherwise, until stop closes.
func (l *Log) Sample(state func() protocol.VehicleState, stop <-chan struct{}) {
	if l == nil {
		return
	}
	ticker := time.NewTicker(SampleArmed)
	defer ticker.Stop()
	var last time.Time
	for {
		select {
		case <-stop:
			return
		case now := <-ticker.C:
			st := state()
			if !st.Armed && now.Sub(last) < SampleDisarmed {
				continue
			}
			l.State(st)
			last = now
		}
	}
}
