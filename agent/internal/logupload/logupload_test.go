package logupload

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/tomwildoer/cellular-drone/agent/internal/auth"
)

func TestAPIFromSignalURL(t *testing.T) {
	for in, want := range map[string]string{
		"ws://localhost:8788/signal":       "http://localhost:8788",
		"wss://fly.example.com/signal?x=1": "https://fly.example.com",
	} {
		if got, err := APIFromSignalURL(in); err != nil || got != want {
			t.Errorf("%s: got %q, %v; want %q", in, got, err, want)
		}
	}
	if _, err := APIFromSignalURL("http://nope"); err == nil {
		t.Error("a non-WebSocket URL must be refused")
	}
}

// fakeServer checks each upload's signature the way server/src/flightLogs.ts
// does and answers with the given status per file name.
type fakeServer struct {
	t      *testing.T
	pub    ed25519.PublicKey
	status map[string]int
	mu     sync.Mutex
	got    map[string]string
}

func (f *fakeServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// /api/vehicles/<vehicle>/logs/<name>
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) != 6 || parts[2] != "vehicles" || parts[4] != "logs" {
		f.t.Errorf("unexpected path %s", r.URL.Path)
		return
	}
	vehicle, name := parts[3], parts[5]
	body, _ := io.ReadAll(r.Body)
	sum := sha256.Sum256(body)
	msg := fmt.Sprintf("%s%s\n%s\n%s\n%s", auth.LogUploadContext, vehicle, name, r.Header.Get("X-Drone-Timestamp"), hex.EncodeToString(sum[:]))
	sig, _ := base64.RawURLEncoding.DecodeString(r.Header.Get("X-Drone-Signature"))
	if !ed25519.Verify(f.pub, []byte(msg), sig) || r.Header.Get("Content-Type") != "application/x-ndjson" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	f.mu.Lock()
	f.got[name] = string(body)
	f.mu.Unlock()
	status := f.status[name]
	if status == 0 {
		status = http.StatusCreated
	}
	w.WriteHeader(status)
}

func TestUploadsFinishedLogsAndKeepsThem(t *testing.T) {
	pub, key, _ := ed25519.GenerateKey(nil)
	dir := t.TempDir()
	write := func(name, body string) string {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		return path
	}
	write("flight-20261010T010000Z.jsonl", "old flight\n")
	write("flight-20261010T020000Z.jsonl", "clashing flight\n")
	current := write("flight-20261011T030000Z.jsonl", "being written\n")
	write("notes.txt", "not a log\n")

	f := &fakeServer{t: t, pub: pub, got: map[string]string{}, status: map[string]int{"flight-20261010T020000Z.jsonl": http.StatusConflict}}
	srv := httptest.NewServer(f)
	defer srv.Close()

	UploadPending(context.Background(), Config{
		Dir: dir, Current: current, API: srv.URL, VehicleID: "drone-1", Key: key,
		Client: srv.Client(), Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})

	if f.got["flight-20261010T010000Z.jsonl"] != "old flight\n" {
		t.Errorf("finished log not uploaded intact: %q", f.got)
	}
	if _, sent := f.got["flight-20261011T030000Z.jsonl"]; sent {
		t.Error("the log being written was uploaded")
	}
	for path, want := range map[string]bool{
		filepath.Join(dir, "uploaded", "flight-20261010T010000Z.jsonl"): true,
		filepath.Join(dir, "rejected", "flight-20261010T020000Z.jsonl"): true,
		current:                         true,
		filepath.Join(dir, "notes.txt"): true,
		filepath.Join(dir, "flight-20261010T010000Z.jsonl"): false,
	} {
		if _, err := os.Stat(path); (err == nil) != want {
			t.Errorf("%s: exists=%v, want %v", path, err == nil, want)
		}
	}
}

func TestStopsAtTheFirstNetworkError(t *testing.T) {
	_, key, _ := ed25519.GenerateKey(nil)
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "flight-20261010T010000Z.jsonl"), []byte("x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	UploadPending(context.Background(), Config{
		Dir: dir, API: "http://127.0.0.1:1", VehicleID: "drone-1", Key: key,
		Client: http.DefaultClient, Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if _, err := os.Stat(filepath.Join(dir, "flight-20261010T010000Z.jsonl")); err != nil {
		t.Error("a log that couldn't be sent must stay where it is for the next round")
	}
}
