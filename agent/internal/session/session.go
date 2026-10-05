// Package session runs one WebRTC peer connection per browser session: the
// `telemetry` and `control` data channels the browser opens (it is the SDP
// offerer), the shared video track, and JSONL logging of ICE state and the
// selected candidate pair — the evidence for "did we go direct or through TURN".
package session

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/pion/interceptor"
	"github.com/pion/webrtc/v4"

	"github.com/tomwildoer/cellular-drone/agent/internal/protocol"
	"github.com/tomwildoer/cellular-drone/agent/internal/video"
)

const noFlightControllerDetail = "agent link test: no flight controller attached"

type Config struct {
	VehicleID  string
	Home       protocol.HomePosition
	ICEServers []webrtc.ICEServer
	// Interface restricts ICE to one network interface (e.g. wlan0). Empty =
	// every interface except VPN/tunnel ones, which would otherwise offer
	// their own private P2P path and silently bypass the network under test.
	Interface              string
	ICEDisconnectedTimeout time.Duration
	ICEFailedTimeout       time.Duration
	ICEKeepalive           time.Duration
	TelemetryInterval      time.Duration
	// FailedGrace is how long a failed connection is kept for the browser to
	// ICE-restart it before the session is torn down.
	FailedGrace time.Duration
}

type SendFunc func(protocol.Signalling)

type Manager struct {
	cfg   Config
	api   *webrtc.API
	video *video.Source
	send  SendFunc
	log   *slog.Logger

	mu       sync.Mutex
	sessions map[string]*Session
}

func NewManager(cfg Config, videoSource *video.Source, send SendFunc, log *slog.Logger) (*Manager, error) {
	settings := webrtc.SettingEngine{}
	settings.SetICETimeouts(cfg.ICEDisconnectedTimeout, cfg.ICEFailedTimeout, cfg.ICEKeepalive)
	settings.SetInterfaceFilter(func(name string) bool {
		if cfg.Interface != "" {
			return name == cfg.Interface
		}
		return !isTunnelInterface(name)
	})

	media := &webrtc.MediaEngine{}
	if err := media.RegisterDefaultCodecs(); err != nil {
		return nil, err
	}
	interceptors := &interceptor.Registry{}
	if err := webrtc.RegisterDefaultInterceptors(media, interceptors); err != nil {
		return nil, err
	}

	return &Manager{
		cfg:      cfg,
		api:      webrtc.NewAPI(webrtc.WithSettingEngine(settings), webrtc.WithMediaEngine(media), webrtc.WithInterceptorRegistry(interceptors)),
		video:    videoSource,
		send:     send,
		log:      log,
		sessions: map[string]*Session{},
	}, nil
}

func isTunnelInterface(name string) bool {
	for _, prefix := range []string{"tailscale", "utun", "wg", "tun", "zt", "docker", "br-"} {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}
	return false
}

// verifySessionToken is where the server-signed Ed25519 session token gets
// checked before answering (ARCHITECTURE.md, session flow step 4). Until the
// server signs tokens it only insists one is present, so the check stays in
// the code path rather than being bolted on later.
func verifySessionToken(token string) error {
	if token == "" {
		return errors.New("missing session token")
	}
	return nil
}

// HandleOffer answers a new session's offer, or a renegotiation (ICE
// restart) of an existing one.
func (m *Manager) HandleOffer(msg protocol.Signalling) {
	log := m.log.With("session", msg.SessionID)
	if err := verifySessionToken(msg.SessionToken); err != nil {
		log.Warn("offer_rejected", "error", err.Error())
		return
	}

	m.mu.Lock()
	s := m.sessions[msg.SessionID]
	m.mu.Unlock()

	if s == nil {
		var err error
		if s, err = m.newSession(msg.SessionID); err != nil {
			log.Error("session_create_failed", "error", err.Error())
			return
		}
		log.Info("session_created")
	} else {
		log.Info("renegotiation_offer")
	}

	if err := s.answer(msg.SDP); err != nil {
		log.Error("answer_failed", "error", err.Error())
		if s.isNew() {
			s.close("answer failed")
		}
	}
}

func (m *Manager) AddCandidate(msg protocol.Signalling) {
	m.mu.Lock()
	s := m.sessions[msg.SessionID]
	m.mu.Unlock()
	if s == nil || msg.Candidate == nil {
		return
	}
	if err := s.pc.AddICECandidate(*msg.Candidate); err != nil {
		s.log.Warn("remote_candidate_rejected", "error", err.Error())
	}
}

func (m *Manager) CloseAll(reason string) {
	m.mu.Lock()
	all := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		all = append(all, s)
	}
	m.mu.Unlock()
	for _, s := range all {
		s.close(reason)
	}
}

type Session struct {
	id  string
	m   *Manager
	pc  *webrtc.PeerConnection
	log *slog.Logger

	stop      chan struct{}
	closeOnce sync.Once

	mu          sync.Mutex
	answered    bool
	failedTimer *time.Timer
	holdsVideo  bool
}

func (m *Manager) newSession(id string) (*Session, error) {
	pc, err := m.api.NewPeerConnection(webrtc.Configuration{ICEServers: m.cfg.ICEServers})
	if err != nil {
		return nil, err
	}
	s := &Session{id: id, m: m, pc: pc, log: m.log.With("session", id), stop: make(chan struct{})}

	if m.video != nil {
		sender, err := pc.AddTrack(m.video.Track)
		if err != nil {
			_ = pc.Close()
			return nil, fmt.Errorf("add video track: %w", err)
		}
		go drainRTCP(sender)
		m.video.Acquire()
		s.holdsVideo = true
	}

	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			s.log.Info("ice_gathering_complete")
			return
		}
		s.log.Info("local_candidate", candidateFields(c)...)
		init := c.ToJSON()
		m.send(protocol.Signalling{Type: "ice", SessionID: id, Candidate: &init})
	})
	pc.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		s.log.Info("ice_state", "state", state.String())
	})
	pc.OnConnectionStateChange(s.onConnectionState)
	pc.SCTP().Transport().ICETransport().OnSelectedCandidatePairChange(func(pair *webrtc.ICECandidatePair) {
		s.logSelectedPair(pair)
	})
	pc.OnDataChannel(func(dc *webrtc.DataChannel) {
		label := dc.Label()
		s.log.Info("data_channel", "label", label)
		dc.OnClose(func() { s.log.Info("data_channel_closed", "label", label) })
		switch label {
		case "telemetry":
			dc.OnOpen(func() { go s.streamTelemetry(dc) })
		case "control":
			dc.OnOpen(func() { s.sendStatus(dc, "Agent link test: no flight controller attached, telemetry is a placeholder") })
			dc.OnMessage(func(msg webrtc.DataChannelMessage) { s.handleControl(dc, msg.Data) })
		default:
			s.log.Warn("unknown_data_channel", "label", dc.Label())
		}
	})

	m.mu.Lock()
	m.sessions[id] = s
	m.mu.Unlock()
	return s, nil
}

func (s *Session) isNew() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return !s.answered
}

func (s *Session) answer(sdp string) error {
	if err := s.pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: sdp}); err != nil {
		return fmt.Errorf("set remote description: %w", err)
	}
	answer, err := s.pc.CreateAnswer(nil)
	if err != nil {
		return fmt.Errorf("create answer: %w", err)
	}
	if err := s.pc.SetLocalDescription(answer); err != nil {
		return fmt.Errorf("set local description: %w", err)
	}
	s.mu.Lock()
	s.answered = true
	s.mu.Unlock()
	s.m.send(protocol.Signalling{Type: "answer", SessionID: s.id, SDP: answer.SDP})
	return nil
}

func (s *Session) onConnectionState(state webrtc.PeerConnectionState) {
	s.log.Info("connection_state", "state", state.String())
	s.mu.Lock()
	defer s.mu.Unlock()
	switch state {
	case webrtc.PeerConnectionStateConnected:
		if s.failedTimer != nil {
			s.failedTimer.Stop()
			s.failedTimer = nil
		}
	case webrtc.PeerConnectionStateFailed:
		// Not torn down yet: the browser, as offerer, may ICE-restart it.
		if s.failedTimer == nil {
			s.failedTimer = time.AfterFunc(s.m.cfg.FailedGrace, func() { s.close("failed and not restarted") })
		}
	case webrtc.PeerConnectionStateClosed:
		go s.close("peer connection closed")
	}
}

func (s *Session) close(reason string) {
	s.closeOnce.Do(func() {
		close(s.stop)
		_ = s.pc.Close()
		s.mu.Lock()
		if s.failedTimer != nil {
			s.failedTimer.Stop()
		}
		holdsVideo := s.holdsVideo
		s.mu.Unlock()
		if holdsVideo {
			s.m.video.Release()
		}
		s.m.mu.Lock()
		delete(s.m.sessions, s.id)
		s.m.mu.Unlock()
		s.log.Info("session_closed", "reason", reason)
	})
}

func (s *Session) streamTelemetry(dc *webrtc.DataChannel) {
	s.log.Info("telemetry_streaming")
	ticker := time.NewTicker(s.m.cfg.TelemetryInterval)
	defer ticker.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-ticker.C:
			if dc.ReadyState() != webrtc.DataChannelStateOpen {
				s.log.Info("telemetry_stopped", "channel_state", dc.ReadyState().String())
				return
			}
			raw, err := protocol.Encode("telemetry.state", "", protocol.StubVehicleState(s.m.cfg.VehicleID, s.m.cfg.Home))
			// Text frames, not Send's binary: the protocol is JSON text, and a
			// browser hands binary frames over as ArrayBuffers.
			if err == nil {
				err = dc.SendText(string(raw))
			}
			if err != nil {
				s.log.Warn("telemetry_send_failed", "error", err.Error())
			}
		}
	}
}

func (s *Session) sendStatus(dc *webrtc.DataChannel, text string) {
	raw, err := protocol.Encode("telemetry.event", "", protocol.StatusEvent{Kind: "status", Text: text, TS: time.Now().UnixMilli()})
	if err == nil {
		_ = dc.SendText(string(raw))
	}
}

// handleControl answers requests on the reliable channel. Every command is
// logged (the audit trail ARCHITECTURE.md asks for) and, with no flight
// controller behind the agent yet, refused rather than faked.
func (s *Session) handleControl(dc *webrtc.DataChannel, data []byte) {
	var env protocol.Envelope
	if err := json.Unmarshal(data, &env); err != nil || env.V != protocol.Version {
		s.log.Warn("control_message_invalid")
		return
	}

	var reply []byte
	var err error
	switch env.Type {
	case "ping":
		reply, err = protocol.Encode("pong", env.ID, struct{}{})
	case "cmd.request":
		s.log.Info("command", "request_id", env.ID, "payload", string(env.Payload), "result", "rejected")
		reply, err = protocol.Encode("cmd.result", env.ID, protocol.Rejected(noFlightControllerDetail))
	case "mission.upload":
		var mission struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(env.Payload, &mission)
		s.log.Info("mission_upload", "request_id", env.ID, "mission_id", mission.ID, "result", "rejected")
		reply, err = protocol.Encode("mission.uploaded", env.ID, protocol.MissionUploaded{MissionID: mission.ID, Result: protocol.Rejected(noFlightControllerDetail)})
	case "mission.download":
		reply, err = protocol.Encode("mission.current", env.ID, nil)
	default:
		s.log.Info("control_message_ignored", "type", env.Type)
		return
	}
	if err == nil {
		_ = dc.SendText(string(reply))
	}
}

func (s *Session) logSelectedPair(pair *webrtc.ICECandidatePair) {
	if pair == nil || pair.Local == nil || pair.Remote == nil {
		return
	}
	relayed := pair.Local.Typ == webrtc.ICECandidateTypeRelay || pair.Remote.Typ == webrtc.ICECandidateTypeRelay
	s.log.Info("selected_pair",
		"relayed", relayed,
		"local_type", pair.Local.Typ.String(),
		"local", fmt.Sprintf("%s %s:%d", pair.Local.Protocol, pair.Local.Address, pair.Local.Port),
		"remote_type", pair.Remote.Typ.String(),
		"remote", fmt.Sprintf("%s %s:%d", pair.Remote.Protocol, pair.Remote.Address, pair.Remote.Port),
	)
}

func candidateFields(c *webrtc.ICECandidate) []any {
	return []any{"type", c.Typ.String(), "protocol", c.Protocol.String(), "address", c.Address, "port", c.Port}
}

// drainRTCP reads the sender's RTCP so the interceptors (NACK, receiver
// reports) see it; nothing else needs it.
func drainRTCP(sender *webrtc.RTPSender) {
	buf := make([]byte, 1500)
	for {
		if _, _, err := sender.Read(buf); err != nil {
			return
		}
	}
}
