// Package signalling keeps the agent's outbound WebSocket to the signalling
// server alive: connect, say hello as the vehicle, hand each message to a
// handler in arrival order, and reconnect with backoff after any drop (a
// modem reconnect, a new IP). Established peer connections don't depend on
// it — WebRTC media and data flow directly — so a signalling drop only
// matters for new sessions and ICE restarts.
package signalling

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/tomwildoer/cellular-drone/agent/internal/protocol"
)

const (
	minBackoff   = time.Second
	maxBackoff   = 30 * time.Second
	writeTimeout = 10 * time.Second
	// Server pings every 20s; a connection silent for this long is dead.
	readTimeout = 60 * time.Second
)

type Handler func(protocol.Signalling)

type Client struct {
	url       string
	vehicleID string
	handle    Handler
	log       *slog.Logger

	mu   sync.Mutex
	conn *websocket.Conn
}

func NewClient(url, vehicleID string, handle Handler, log *slog.Logger) *Client {
	return &Client{url: url, vehicleID: vehicleID, handle: handle, log: log}
}

// Send writes one message if connected. Messages sent while disconnected are
// dropped: answers and candidates are tied to a session the browser will
// re-offer anyway.
func (c *Client) Send(msg protocol.Signalling) {
	msg.V = protocol.SignallingVersion
	raw, err := json.Marshal(msg)
	if err != nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn == nil {
		c.log.Warn("signalling_send_dropped", "type", msg.Type)
		return
	}
	_ = c.conn.SetWriteDeadline(time.Now().Add(writeTimeout))
	if err := c.conn.WriteMessage(websocket.TextMessage, raw); err != nil {
		c.log.Warn("signalling_send_failed", "type", msg.Type, "error", err.Error())
	}
}

// Run connects and reconnects until ctx is cancelled.
func (c *Client) Run(ctx context.Context) {
	backoff := minBackoff
	for ctx.Err() == nil {
		connectedAt := time.Now()
		err := c.session(ctx)
		if ctx.Err() != nil {
			return
		}
		if time.Since(connectedAt) > maxBackoff {
			backoff = minBackoff
		}
		c.log.Warn("signalling_disconnected", "error", err.Error(), "retry_in", backoff.String())
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, maxBackoff)
	}
}

func (c *Client) session(ctx context.Context) error {
	dialer := websocket.Dialer{HandshakeTimeout: 15 * time.Second}
	conn, _, err := dialer.DialContext(ctx, c.url, nil)
	if err != nil {
		return err
	}
	defer conn.Close()

	conn.SetPingHandler(func(data string) error {
		_ = conn.SetReadDeadline(time.Now().Add(readTimeout))
		c.mu.Lock()
		defer c.mu.Unlock()
		return conn.WriteControl(websocket.PongMessage, []byte(data), time.Now().Add(writeTimeout))
	})
	go func() {
		<-ctx.Done()
		_ = conn.Close()
	}()

	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		c.conn = nil
		c.mu.Unlock()
	}()

	c.Send(protocol.Signalling{Type: "hello", Role: "vehicle", VehicleID: c.vehicleID})
	c.log.Info("signalling_connected", "url", c.url)

	for {
		_ = conn.SetReadDeadline(time.Now().Add(readTimeout))
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return err
		}
		var msg protocol.Signalling
		if err := json.Unmarshal(raw, &msg); err != nil || msg.V != protocol.SignallingVersion {
			c.log.Warn("signalling_message_invalid")
			continue
		}
		c.handle(msg)
	}
}
