package flightlog

import (
	"bufio"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/tomwildoer/cellular-drone/agent/internal/protocol"
)

func readLines(t *testing.T, path string) []map[string]any {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	var out []map[string]any
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		var rec map[string]any
		if err := json.Unmarshal(sc.Bytes(), &rec); err != nil {
			t.Fatalf("line %d isn't JSON: %v", len(out)+1, err)
		}
		out = append(out, rec)
	}
	return out
}

func TestRecordsInOrderWithKindAndVehicle(t *testing.T) {
	dir := t.TempDir()
	l, err := Open(filepath.Join(dir, "logs"), "drone-1", slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	l.Agent("started", map[string]any{"fc": "tcp:127.0.0.1:5760"})
	l.Session("s1", "opened", "")
	l.Command("s1", "r1", protocol.Command{Type: "arm"}, protocol.CommandResult{OK: true})
	l.MissionUpload("s1", "r2", "m1", 4, protocol.Rejected("nope"), 0)
	l.Event(protocol.ModeChangedEvent{Kind: "modeChanged", Mode: "AUTO", TS: 1})
	l.State(protocol.VehicleState{VehicleID: "drone-1", Armed: true})
	l.Close()
	l.Close()                                                          // idempotent
	l.Event(protocol.StatusEvent{Kind: "status", Text: "after close"}) // dropped, no panic

	recs := readLines(t, l.Path())
	want := []string{KindAgent, KindSession, KindCommand, KindMissionUpload, KindEvent, KindState}
	if len(recs) != len(want) {
		t.Fatalf("got %d records, want %d", len(recs), len(want))
	}
	for i, kind := range want {
		if recs[i]["kind"] != kind || recs[i]["vehicle"] != "drone-1" || recs[i]["ts"] == "" {
			t.Errorf("record %d = %v, want kind %q for drone-1 with a ts", i, recs[i], kind)
		}
	}
	cmd := recs[2]
	if cmd["session"] != "s1" || cmd["requestId"] != "r1" ||
		cmd["command"].(map[string]any)["type"] != "arm" || cmd["result"].(map[string]any)["ok"] != true {
		t.Errorf("command record = %v", cmd)
	}
	if ev := recs[4]["event"].(map[string]any); ev["mode"] != "AUTO" {
		t.Errorf("event record = %v", recs[4])
	}
}

func TestNilLogIsANoOp(t *testing.T) {
	var l *Log
	l.Agent("started", nil)
	l.Command("s", "r", protocol.Command{Type: "arm"}, protocol.CommandResult{})
	l.State(protocol.VehicleState{})
	l.Sample(func() protocol.VehicleState { return protocol.VehicleState{} }, nil)
	l.Close()
	if l.Path() != "" {
		t.Error("nil log has a path")
	}
}
