// Package logupload sends the drone's finished flight logs to the server
// (ADR-0030), so the record of a flight survives the drone: each file the
// flight log has closed (every one but the file being written) goes up,
// signed with the drone's key, and moves into uploaded/ beside it. Local
// copies are never deleted. Uploads wait for the next round when the link
// is down; nothing here touches the flight.
package logupload

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"time"

	"github.com/tomwildoer/cellular-drone/agent/internal/auth"
)

// flightLogName matches FLIGHT_LOG_NAME in packages/protocol/src/auth.ts.
var flightLogName = regexp.MustCompile(`^flight-\d{8}T\d{6}Z\.jsonl$`)

const (
	uploadedDir = "uploaded"
	// rejectedDir holds logs the server refused for good (a different file
	// already stored under that name), so they aren't retried for ever.
	rejectedDir = "rejected"
)

type Config struct {
	// Dir is the flight log directory; Current is the file being written,
	// which is left alone until a later start.
	Dir     string
	Current string
	// API is the server's base URL, e.g. https://fly.example.com.
	API       string
	VehicleID string
	Key       ed25519.PrivateKey
	// Clock is the server's clock: the upload timestamp must be near it.
	Clock    interface{ Now() time.Time }
	Interval time.Duration
	Client   *http.Client
	Log      *slog.Logger
}

// APIFromSignalURL turns the signalling URL into the server's base URL:
// ws://host:8788/signal → http://host:8788, wss://… → https://….
func APIFromSignalURL(signal string) (string, error) {
	u, err := url.Parse(signal)
	if err != nil {
		return "", err
	}
	switch u.Scheme {
	case "ws":
		u.Scheme = "http"
	case "wss":
		u.Scheme = "https"
	default:
		return "", fmt.Errorf("signalling URL %q isn't ws:// or wss://", signal)
	}
	u.Path, u.RawQuery, u.Fragment = "", "", ""
	return u.String(), nil
}

// firstRoundDelay gives signalling time to connect first, so Clock has the
// server's time: a drone that booted with a wrong clock would otherwise be
// refused until the next round.
const firstRoundDelay = 30 * time.Second

// Run uploads shortly after start and then every Interval until ctx is cancelled.
func Run(ctx context.Context, cfg Config) {
	if cfg.Client == nil {
		cfg.Client = &http.Client{Timeout: 5 * time.Minute}
	}
	wait := min(firstRoundDelay, cfg.Interval)
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
		UploadPending(ctx, cfg)
		wait = cfg.Interval
	}
}

// UploadPending makes one pass over the finished logs. It stops at the first
// network error: the link is down, and the next round tries again.
func UploadPending(ctx context.Context, cfg Config) {
	entries, err := os.ReadDir(cfg.Dir)
	if err != nil {
		cfg.Log.Warn("flight_log_upload_scan_failed", "error", err.Error())
		return
	}
	for _, e := range entries {
		name := e.Name()
		path := filepath.Join(cfg.Dir, name)
		if e.IsDir() || !flightLogName.MatchString(name) || sameFile(path, cfg.Current) {
			continue
		}
		status, err := upload(ctx, cfg, path, name)
		switch {
		case err != nil:
			cfg.Log.Warn("flight_log_upload_failed", "file", name, "error", err.Error())
			return
		case status == http.StatusCreated || status == http.StatusOK:
			cfg.Log.Info("flight_log_uploaded", "file", name, "new", status == http.StatusCreated)
			moveInto(cfg, path, uploadedDir)
		case status == http.StatusConflict || status == http.StatusBadRequest:
			cfg.Log.Error("flight_log_upload_rejected", "file", name, "status", status)
			moveInto(cfg, path, rejectedDir)
		default:
			// 401: not registered yet, or the clock's off; try again later.
			cfg.Log.Warn("flight_log_upload_refused", "file", name, "status", status)
			return
		}
	}
}

func upload(ctx context.Context, cfg Config, path, name string) (int, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	sum := sha256.Sum256(body)
	now := time.Now()
	if cfg.Clock != nil {
		now = cfg.Clock.Now()
	}
	ts := now.UnixMilli()
	endpoint := fmt.Sprintf("%s/api/vehicles/%s/logs/%s", cfg.API, url.PathEscape(cfg.VehicleID), url.PathEscape(name))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/x-ndjson")
	req.Header.Set("X-Drone-Timestamp", strconv.FormatInt(ts, 10))
	req.Header.Set("X-Drone-Signature", auth.SignLogUpload(cfg.Key, cfg.VehicleID, name, ts, hex.EncodeToString(sum[:])))
	res, err := cfg.Client.Do(req)
	if err != nil {
		return 0, err
	}
	_ = res.Body.Close()
	return res.StatusCode, nil
}

func moveInto(cfg Config, path, sub string) {
	dir := filepath.Join(cfg.Dir, sub)
	if err := os.MkdirAll(dir, 0o755); err == nil {
		err = os.Rename(path, filepath.Join(dir, filepath.Base(path)))
		if err == nil {
			return
		}
	}
	cfg.Log.Warn("flight_log_move_failed", "file", filepath.Base(path), "into", sub)
}

func sameFile(a, b string) bool {
	if b == "" {
		return false
	}
	ia, errA := os.Stat(a)
	ib, errB := os.Stat(b)
	return errA == nil && errB == nil && os.SameFile(ia, ib)
}
