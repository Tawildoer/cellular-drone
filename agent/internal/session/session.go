// Package session runs one WebRTC peer connection per browser session: the
// `telemetry` and `control` data channels the browser opens (it is the SDP
// offerer), the shared video track, and JSONL logging of ICE state and the
// selected candidate pair — the evidence for "did we go direct or through TURN".
package session

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/pion/interceptor"
	"github.com/pion/webrtc/v4"

	"github.com/tomwildoer/cellular-drone/agent/internal/flightlog"
	"github.com/tomwildoer/cellular-drone/agent/internal/mission"
	"github.com/tomwildoer/cellular-drone/agent/internal/protocol"
	"github.com/tomwildoer/cellular-drone/agent/internal/video"
)

const noFlightControllerDetail = "agent link test: no flight controller attached"

// Vehicle is the flight controller behind the agent (internal/fc). Nil in
// link-test mode, when the agent reports a stub state and refuses commands.
type Vehicle interface {
	State() protocol.VehicleState
	Command(ctx context.Context, cmd protocol.Command) protocol.CommandResult
	UploadMission(ctx context.Context, m mission.Mission) (protocol.CommandResult, []mission.Row)
	CurrentMission(ctx context.Context) (*mission.Mission, error)
	// SetCommanderActive starts or stops the agent's GCS heartbeat. It's
	// informational only: FS_GCS_ENABL is 0, so the flight never depends on
	// it (ADR-0020).
	SetCommanderActive(active bool)
}

// How long a browser request may take: mission transfers retry over MAVLink.
const requestTimeout = 30 * time.Second

type Config struct {
	VehicleID  string
	Home       protocol.HomePosition
	ICEServers []webrtc.ICEServer
	// Interface restricts ICE to one network interface (e.g. wlan0). Empty =
	// every interface except VPN/tunnel ones, which would otherwise offer
	// their own private P2P path and silently bypass the network under test.
	Interface string
	// UDPPort, when set, serves all ICE traffic from this one UDP port, so a
	// router can forward it. AdvertiseIPs are public IPs to offer on that
	// same port as server-reflexive candidates: STUN can't discover them,
	// because its own probes leave from other ports the router doesn't forward.
	UDPPort                int
	AdvertiseIPs           []string
	ICEDisconnectedTimeout time.Duration
	ICEFailedTimeout       time.Duration
	ICEKeepalive           time.Duration
	TelemetryInterval      time.Duration
	// FailedGrace is how long a failed connection is kept for the browser to
	// ICE-restart it before the session is torn down.
	FailedGrace time.Duration
	// FlightLog is the drone's audit record of sessions, commands and
	// uploads. Nil = not recorded.
	FlightLog *flightlog.Log
}

type SendFunc func(protocol.Signalling)

type Manager struct {
	cfg     Config
	api     *webrtc.API
	video   *video.Source
	vehicle Vehicle
	send    SendFunc
	log     *slog.Logger

	mu       sync.Mutex
	sessions map[string]*Session
}

func NewManager(cfg Config, videoSource *video.Source, vehicle Vehicle, send SendFunc, log *slog.Logger) (*Manager, error) {
	settings := webrtc.SettingEngine{}
	settings.SetICETimeouts(cfg.ICEDisconnectedTimeout, cfg.ICEFailedTimeout, cfg.ICEKeepalive)
	settings.SetInterfaceFilter(func(name string) bool {
		if cfg.Interface != "" {
			return name == cfg.Interface
		}
		return !isTunnelInterface(name)
	})
	if cfg.UDPPort > 0 {
		conn, err := net.ListenUDP("udp", &net.UDPAddr{Port: cfg.UDPPort})
		if err != nil {
			return nil, fmt.Errorf("listen on udp port %d: %w", cfg.UDPPort, err)
		}
		settings.SetICEUDPMux(webrtc.NewICEUDPMux(nil, conn))
	}
	if len(cfg.AdvertiseIPs) > 0 {
		settings.SetNAT1To1IPs(cfg.AdvertiseIPs, webrtc.ICECandidateTypeSrflx)
	}

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
		vehicle:  vehicle,
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
		m.cfg.FlightLog.Session(msg.SessionID, "opened", "")
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

// BroadcastEvent sends a vehicle event (protocol event struct) to every
// session's control channel.
func (m *Manager) BroadcastEvent(ev any) {
	raw, err := protocol.Encode("telemetry.event", "", ev)
	if err != nil {
		return
	}
	for _, s := range m.snapshot() {
		s.sendControl(raw)
	}
}

func (m *Manager) snapshot() []*Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	all := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		all = append(all, s)
	}
	return all
}

// updateCommander keeps the GCS heartbeat running while any session has an
// open control channel, so the FC (and its logs) can see someone is
// supervising. Nothing in the flight depends on it (ADR-0020). One commander
// at a time is a later refinement (ARCHITECTURE.md, Session flow step 6).
func (m *Manager) updateCommander() {
	if m.vehicle == nil {
		return
	}
	active := false
	for _, s := range m.snapshot() {
		s.mu.Lock()
		open := s.control != nil
		s.mu.Unlock()
		active = active || open
	}
	m.vehicle.SetCommanderActive(active)
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
	control     *webrtc.DataChannel // set while the control channel is open
}

func (s *Session) sendControl(raw []byte) {
	s.mu.Lock()
	dc := s.control
	s.mu.Unlock()
	if dc != nil {
		_ = dc.SendText(string(raw))
	}
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
			dc.OnOpen(func() {
				s.mu.Lock()
				s.control = dc
				s.mu.Unlock()
				m.updateCommander()
				if m.vehicle == nil {
					s.sendStatus(dc, "Agent link test: no flight controller attached, telemetry is a placeholder")
				}
			})
			dc.OnClose(func() {
				s.mu.Lock()
				s.control = nil
				s.mu.Unlock()
				m.updateCommander()
			})
			// Requests can take seconds (mission transfers), so each runs on
			// its own goroutine rather than holding up the channel.
			dc.OnMessage(func(msg webrtc.DataChannelMessage) { go s.handleControl(dc, msg.Data) })
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
		s.m.updateCommander()
		s.log.Info("session_closed", "reason", reason)
		s.m.cfg.FlightLog.Session(s.id, "closed", reason)
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
			state := protocol.StubVehicleState(s.m.cfg.VehicleID, s.m.cfg.Home)
			if s.m.vehicle != nil {
				state = s.m.vehicle.State()
			}
			raw, err := protocol.Encode("telemetry.state", "", state)
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

// handleControl answers requests on the reliable channel. Every command and
// upload is logged with its result, in the debug log and the flight log
// (the audit trail ARCHITECTURE.md asks for). With no flight controller
// (link-test mode) they're refused, not faked.
func (s *Session) handleControl(dc *webrtc.DataChannel, data []byte) {
	var env protocol.Envelope
	if err := json.Unmarshal(data, &env); err != nil || env.V != protocol.Version {
		s.log.Warn("control_message_invalid")
		return
	}
	if v := s.m.vehicle; v != nil && env.Type != "ping" {
		s.handleVehicleRequest(dc, v, env)
		return
	}

	var reply []byte
	var err error
	switch env.Type {
	case "ping":
		reply, err = protocol.Encode("pong", env.ID, struct{}{})
	case "cmd.request":
		var cmd protocol.Command
		_ = json.Unmarshal(env.Payload, &cmd)
		result := protocol.Rejected(noFlightControllerDetail)
		s.log.Info("command", "request_id", env.ID, "payload", string(env.Payload), "result", "rejected")
		s.m.cfg.FlightLog.Command(s.id, env.ID, cmd, result)
		reply, err = protocol.Encode("cmd.result", env.ID, result)
	case "mission.upload":
		var m mission.Mission
		_ = json.Unmarshal(env.Payload, &m)
		result := protocol.Rejected(noFlightControllerDetail)
		s.log.Info("mission_upload", "request_id", env.ID, "mission_id", m.ID, "result", "rejected")
		s.m.cfg.FlightLog.MissionUpload(s.id, env.ID, m.ID, len(m.Items), result, 0)
		reply, err = protocol.Encode("mission.uploaded", env.ID, protocol.MissionUploaded{MissionID: m.ID, Result: result})
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

func (s *Session) handleVehicleRequest(dc *webrtc.DataChannel, v Vehicle, env protocol.Envelope) {
	ctx, cancel := context.WithTimeout(context.Background(), requestTimeout)
	defer cancel()

	var reply []byte
	var err error
	switch env.Type {
	case "cmd.request":
		var cmd protocol.Command
		result := protocol.Rejected("malformed command")
		if json.Unmarshal(env.Payload, &cmd) == nil {
			result = v.Command(ctx, cmd)
		}
		s.log.Info("command", "request_id", env.ID, "type", cmd.Type, "ok", result.OK, "reason", result.Reason, "detail", result.Detail)
		s.m.cfg.FlightLog.Command(s.id, env.ID, cmd, result)
		reply, err = protocol.Encode("cmd.result", env.ID, result)
	case "mission.upload":
		var m mission.Mission
		result, rows := protocol.Rejected("malformed mission"), []mission.Row(nil)
		if json.Unmarshal(env.Payload, &m) == nil {
			result, rows = v.UploadMission(ctx, m)
		}
		s.log.Info("mission_upload", "request_id", env.ID, "mission_id", m.ID, "ok", result.OK, "detail", result.Detail, "rows", len(rows))
		s.m.cfg.FlightLog.MissionUpload(s.id, env.ID, m.ID, len(m.Items), result, len(rows))
		reply, err = protocol.Encode("mission.uploaded", env.ID, protocol.MissionUploaded{MissionID: m.ID, Result: result, OnVehicle: rows})
	case "mission.download":
		current, derr := v.CurrentMission(ctx)
		if derr != nil {
			s.log.Warn("mission_download_failed", "error", derr.Error())
		}
		reply, err = protocol.Encode("mission.current", env.ID, current)
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
