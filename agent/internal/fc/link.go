// Package fc is the agent's MAVLink2 link to the ArduPlane flight controller
// (docs/MAVLINK.md). It turns MAVLink into the app's VehicleState and events,
// carries out whitelisted commands, and uploads missions with the
// authoritative translator (internal/mission). Nothing here ever sends
// manual control: no RC_CHANNELS_OVERRIDE, MANUAL_CONTROL or setpoints.
package fc

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/bluenviron/gomavlib/v3"
	"github.com/bluenviron/gomavlib/v3/pkg/dialects/ardupilotmega"
	"github.com/bluenviron/gomavlib/v3/pkg/dialects/common"
	"github.com/bluenviron/gomavlib/v3/pkg/message"

	"github.com/tomwildoer/cellular-drone/agent/internal/mission"
	"github.com/tomwildoer/cellular-drone/agent/internal/protocol"
)

// The agent is the ground station as far as the FC is concerned: sysid 255
// matches SYSID_MYGCS. Its heartbeats only tell the FC a commander is
// connected; FS_GCS_ENABL is 0, so the flight never depends on them (ADR-0020).
const (
	gcsSystemID    = 255
	gcsComponentID = 190 // MAV_COMP_ID_MISSIONPLANNER
	autopilotComp  = 1
)

// Telemetry the agent asks for, and how often (SET_MESSAGE_INTERVAL).
var streamRates = map[uint32]time.Duration{
	33:  200 * time.Millisecond, // GLOBAL_POSITION_INT
	30:  200 * time.Millisecond, // ATTITUDE
	74:  200 * time.Millisecond, // VFR_HUD
	1:   500 * time.Millisecond, // SYS_STATUS
	147: time.Second,            // BATTERY_STATUS
	24:  500 * time.Millisecond, // GPS_RAW_INT
	245: 500 * time.Millisecond, // EXTENDED_SYS_STATE
	242: 2 * time.Second,        // HOME_POSITION
	42:  500 * time.Millisecond, // MISSION_CURRENT
	65:  500 * time.Millisecond, // RC_CHANNELS
	2:   time.Second,            // SYSTEM_TIME
	162: time.Second,            // FENCE_STATUS
}

// Event is what Link reports to the sessions: one of the protocol event
// structs, ready to send as a telemetry.event payload.
type Event any

type Config struct {
	// Endpoint is how to reach the FC: gomavlib.EndpointTCPClient for SITL,
	// gomavlib.EndpointSerial for the real UART.
	Endpoint  gomavlib.EndpointConf
	VehicleID string
	Log       *slog.Logger
	// OnEvent receives status text, mode changes, failsafes and RC override
	// changes. Called from the link's goroutine; must not block.
	OnEvent func(Event)
}

type Link struct {
	cfg  Config
	node *gomavlib.Node
	log  *slog.Logger

	gcsMu     sync.Mutex
	gcsActive bool

	waitMu  sync.Mutex
	waiters map[*waiter]struct{}

	// Serialises mission transfers: the protocol is one exchange at a time.
	transferMu sync.Mutex

	mu         sync.Mutex
	st         vehicleState
	plan       *plannedMission // what the FC holds, as the app knows it
	ready      bool            // first heartbeat seen and streams requested
	modeSwitch *modeSwitch     // the FC's RC mode switch setup; nil until read
}

// modeSwitch is the FC's RC mode switch: FLTMODE_CH and FLTMODE1..6.
type modeSwitch struct {
	channel int // 1-based RC channel
	modes   [6]uint32
}

type vehicleState struct {
	protocol.VehicleState
	fcSystem  uint8
	mode      uint32
	haveMode  bool
	commanded *uint32 // last mode the agent asked for, to tell RC takeovers apart
	// inferredOverride: the FC entered a pilot mode the agent didn't ask
	// for. switchMode: the mode the RC switch selects, nil when unknown.
	// Either one, while armed, is an RC override (updateOverrideLocked).
	inferredOverride bool
	switchMode       *uint32
	rcPresent        bool
	gpsTimeUnix      time.Time
}

type plannedMission struct {
	mission mission.Mission
	rows    []mission.Row // readback, with app indices
}

func New(cfg Config) (*Link, error) {
	node := &gomavlib.Node{
		Endpoints:      []gomavlib.EndpointConf{cfg.Endpoint},
		Dialect:        ardupilotmega.Dialect,
		OutVersion:     gomavlib.V2,
		OutSystemID:    gcsSystemID,
		OutComponentID: gcsComponentID,
		// Heartbeats are sent by hand, only while a commander session is
		// alive (SetCommanderActive). Informational: no failsafe uses them.
		HeartbeatDisable: true,
	}
	if err := node.Initialize(); err != nil {
		return nil, fmt.Errorf("mavlink: %w", err)
	}
	l := &Link{cfg: cfg, node: node, log: cfg.Log.With("component", "fc"), waiters: map[*waiter]struct{}{}}
	l.st.VehicleState = protocol.VehicleState{
		VehicleID:  cfg.VehicleID,
		GPS:        protocol.GPSStatus{FixType: "none"},
		FlightMode: "UNKNOWN",
		VtolState:  "mc",
		Landed:     true,
	}
	return l, nil
}

// Run reads from the FC until ctx ends.
func (l *Link) Run(ctx context.Context) {
	go l.heartbeatLoop(ctx)
	events := l.node.Events()
	for {
		select {
		case <-ctx.Done():
			l.node.Close()
			return
		case evt, ok := <-events:
			if !ok {
				return
			}
			switch e := evt.(type) {
			case *gomavlib.EventChannelOpen:
				l.log.Info("fc_channel_open")
			case *gomavlib.EventChannelClose:
				l.log.Warn("fc_channel_closed")
				l.mu.Lock()
				l.ready = false
				// Whatever comes back may be a rebooted FC (SITL restarts, or
				// the FC power-cycled): its boot mode is not a pilot takeover,
				// so forget the mode history rather than compare against it.
				l.st.haveMode = false
				l.st.commanded = nil
				l.st.inferredOverride = false
				l.st.switchMode = nil
				l.st.RC.ModeSwitch = ""
				l.st.RC.OverrideActive = false
				l.modeSwitch = nil // re-read: it may be a different FC
				l.mu.Unlock()
			case *gomavlib.EventFrame:
				if e.ComponentID() != autopilotComp {
					continue // e.g. a gimbal or companion; not the autopilot
				}
				l.handle(ctx, e.SystemID(), e.Message())
			}
		}
	}
}

// SetCommanderActive starts or stops the GCS heartbeat. With FS_GCS_ENABL 0
// (ADR-0020) stopping it changes nothing in the flight; it's just what the
// FC sees of whether anyone is supervising.
func (l *Link) SetCommanderActive(active bool) {
	l.gcsMu.Lock()
	changed := l.gcsActive != active
	l.gcsActive = active
	l.gcsMu.Unlock()
	if changed {
		l.log.Info("gcs_heartbeat", "active", active)
	}
}

func (l *Link) heartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			l.gcsMu.Lock()
			active := l.gcsActive
			l.gcsMu.Unlock()
			if active {
				_ = l.node.WriteMessageAll(&common.MessageHeartbeat{
					Type:           common.MAV_TYPE_GCS,
					Autopilot:      common.MAV_AUTOPILOT_INVALID,
					SystemStatus:   common.MAV_STATE_ACTIVE,
					MavlinkVersion: 3,
				})
			}
		}
	}
}

// State is the latest VehicleState.
func (l *Link) State() protocol.VehicleState {
	l.mu.Lock()
	defer l.mu.Unlock()
	s := l.st.VehicleState
	s.UpdatedAt = time.Now().UnixMilli()
	if l.plan != nil {
		s.MissionProgress.Total = len(l.plan.mission.Items)
	}
	return s
}

func (l *Link) emit(ev Event) {
	if l.cfg.OnEvent != nil {
		l.cfg.OnEvent(ev)
	}
}

func (l *Link) handle(ctx context.Context, sysID uint8, msg message.Message) {
	l.notifyWaiters(msg)
	now := time.Now().UnixMilli()

	l.mu.Lock()
	var events []Event
	s := &l.st
	switch m := msg.(type) {
	case *common.MessageHeartbeat:
		if m.Type == common.MAV_TYPE_GCS {
			break
		}
		s.fcSystem = sysID
		s.Armed = m.BaseMode&common.MAV_MODE_FLAG_SAFETY_ARMED != 0
		if !s.Armed {
			s.inferredOverride = false // disarmed: nothing for the pilot to hold
		}
		if !s.haveMode || s.mode != m.CustomMode {
			events = append(events, l.modeChangedLocked(m.CustomMode, now)...)
		}
		events = append(events, l.updateOverrideLocked(now)...)
		if !l.ready {
			l.ready = true
			go l.requestStreams(ctx)
		}
	case *common.MessageGlobalPositionInt:
		if m.Lat == 0 && m.Lon == 0 {
			break // ArduPilot's "no position yet", not a place
		}
		s.Position = protocol.Position{
			Lat: float64(m.Lat) / 1e7, Lon: float64(m.Lon) / 1e7,
			AltRelM: float64(m.RelativeAlt) / 1000, AltAmslM: float64(m.Alt) / 1000,
		}
	case *common.MessageAttitude:
		yaw := degrees(float64(m.Yaw))
		if yaw < 0 {
			yaw += 360
		}
		s.Attitude = protocol.Attitude{RollDeg: degrees(float64(m.Roll)), PitchDeg: degrees(float64(m.Pitch)), YawDeg: yaw}
	case *common.MessageVfrHud:
		s.GroundSpeedMps, s.AirspeedMps, s.ClimbMps = float64(m.Groundspeed), float64(m.Airspeed), float64(m.Climb)
	case *common.MessageSysStatus:
		s.Battery.VoltageV = float64(m.VoltageBattery) / 1000
		s.Battery.CurrentA = float64(m.CurrentBattery) / 100
		if m.BatteryRemaining >= 0 {
			s.Battery.Percent = float64(m.BatteryRemaining)
		}
		rc := common.MAV_SYS_STATUS_SENSOR_RC_RECEIVER
		s.rcPresent = m.OnboardControlSensorsPresent&rc != 0
		s.RC.Linked = s.rcPresent && m.OnboardControlSensorsHealth&rc != 0
		events = append(events, l.setFailsafeLocked("rc", s.rcPresent && !s.RC.Linked, now)...)
		if !s.RC.Linked {
			// Out of range, the switch reads are failsafe values, not the pilot.
			s.switchMode, s.RC.ModeSwitch = nil, ""
			events = append(events, l.updateOverrideLocked(now)...)
		}
	case *common.MessageRcChannels:
		l.readSwitchLocked(m)
		events = append(events, l.updateOverrideLocked(now)...)
	case *common.MessageBatteryStatus:
		events = append(events, l.setFailsafeLocked("battery", m.ChargeState >= common.MAV_BATTERY_CHARGE_STATE_LOW, now)...)
	case *common.MessageGpsRawInt:
		s.GPS = protocol.GPSStatus{FixType: fixType(m.FixType), Satellites: int(m.SatellitesVisible), HDOP: float64(m.Eph) / 100}
	case *common.MessageExtendedSysState:
		s.Landed = m.LandedState == common.MAV_LANDED_STATE_ON_GROUND
		s.VtolState = vtolState(m.VtolState)
	case *common.MessageHomePosition:
		s.Home = &protocol.HomePosition{Lat: float64(m.Latitude) / 1e7, Lon: float64(m.Longitude) / 1e7, AltAmslM: float64(m.Altitude) / 1000}
	case *common.MessageMissionCurrent:
		if l.plan != nil {
			if idx := currentAppIndex(l.plan.rows, int(m.Seq)); idx >= 0 {
				s.MissionProgress.CurrentIndex = idx
			}
		}
	case *common.MessageFenceStatus:
		events = append(events, l.setFailsafeLocked("geofence", m.BreachStatus != 0, now)...)
	case *common.MessageSystemTime:
		if m.TimeUnixUsec > 0 {
			s.gpsTimeUnix = time.UnixMicro(int64(m.TimeUnixUsec))
		}
	case *common.MessageStatustext:
		events = append(events, protocol.StatusEvent{Kind: "status", Text: m.Text, TS: now})
		l.log.Info("fc_statustext", "severity", int(m.Severity), "text", m.Text)
	}
	l.mu.Unlock()

	for _, ev := range events {
		l.emit(ev)
	}
}

// modeChangedLocked records a new FC mode and works out whether it means the
// RC pilot has taken over: a pilot mode the agent didn't ask for (ADR-0008).
// The caller follows it with updateOverrideLocked.
func (l *Link) modeChangedLocked(mode uint32, now int64) []Event {
	s := &l.st
	first := !s.haveMode
	s.mode, s.haveMode = mode, true
	s.FlightMode = appFlightMode(mode)

	commanded := s.commanded != nil && *s.commanded == mode
	// Only while armed: on the ground the FC walks through modes as it boots
	// (INITIALISING → MANUAL → whatever the RC switch says), and none of that
	// is a pilot taking over. Checking the switch is in AUTO before a start
	// is the separate preflight rule (ARCHITECTURE.md, RC override).
	s.inferredOverride = s.Armed && pilotMode(mode) && !commanded && !first
	l.log.Info("fc_mode", "mode", mode, "app_mode", s.FlightMode, "inferred_override", s.inferredOverride)
	return []Event{protocol.ModeChangedEvent{Kind: "modeChanged", Mode: s.FlightMode, TS: now}}
}

// updateOverrideLocked works out whether the RC pilot has control (ADR-0008),
// while armed: the mode switch is off AUTO, or the FC entered a pilot mode
// the agent didn't command. The switch is the direct reading; the inference
// covers an unknown switch, and modes changed by anything but the agent.
// Handing back is the switch returning to AUTO (ArduPilot then flies AUTO).
func (l *Link) updateOverrideLocked(now int64) []Event {
	s := &l.st
	switchOff := s.switchMode != nil && *s.switchMode != ModeAuto
	active := s.Armed && (s.inferredOverride || switchOff)
	if active == s.RC.OverrideActive {
		return nil
	}
	s.RC.OverrideActive = active
	l.log.Info("rc_override", "active", active, "switch", s.RC.ModeSwitch, "inferred", s.inferredOverride)
	return []Event{protocol.RCOverrideEvent{Kind: "rcOverride", Active: active, TS: now}}
}

// readSwitchLocked sets the mode the RC switch selects from RC_CHANNELS, or
// clears it when there's no trustworthy reading.
func (l *Link) readSwitchLocked(m *common.MessageRcChannels) {
	s := &l.st
	s.switchMode, s.RC.ModeSwitch = nil, ""
	pwm, ok := channelPWM(m, l.modeSwitch)
	if !ok || !s.RC.Linked {
		return
	}
	if pos, ok := switchPosition(pwm); ok {
		mode := l.modeSwitch.modes[pos]
		s.switchMode, s.RC.ModeSwitch = &mode, appFlightMode(mode)
	}
}

// channelPWM is the mode switch channel's pulse in RC_CHANNELS.
func channelPWM(m *common.MessageRcChannels, sw *modeSwitch) (uint16, bool) {
	if sw == nil || sw.channel < 1 || sw.channel > int(m.Chancount) {
		return 0, false
	}
	raw := [18]uint16{m.Chan1Raw, m.Chan2Raw, m.Chan3Raw, m.Chan4Raw, m.Chan5Raw, m.Chan6Raw,
		m.Chan7Raw, m.Chan8Raw, m.Chan9Raw, m.Chan10Raw, m.Chan11Raw, m.Chan12Raw,
		m.Chan13Raw, m.Chan14Raw, m.Chan15Raw, m.Chan16Raw, m.Chan17Raw, m.Chan18Raw}
	if sw.channel > len(raw) {
		return 0, false
	}
	pwm := raw[sw.channel-1]
	return pwm, pwm != 0 && pwm != 65535
}

// readModeSwitch reads FLTMODE_CH and FLTMODE1..6, so RC_CHANNELS can be
// turned into the mode the pilot's switch selects. Read-only.
func (l *Link) readModeSwitch(ctx context.Context) error {
	ch, err := l.Param(ctx, "FLTMODE_CH")
	if err != nil {
		return fmt.Errorf("FLTMODE_CH: %w", err)
	}
	sw := &modeSwitch{channel: int(ch)}
	for i := range sw.modes {
		name := fmt.Sprintf("FLTMODE%d", i+1)
		v, err := l.Param(ctx, name)
		if err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
		sw.modes[i] = uint32(v)
	}
	l.mu.Lock()
	l.modeSwitch = sw
	l.mu.Unlock()
	l.log.Info("fc_mode_switch", "channel", sw.channel, "modes", sw.modes)
	return nil
}

func (l *Link) setFailsafeLocked(flag string, active bool, now int64) []Event {
	f := &l.st.Failsafe
	var current *bool
	switch flag {
	case "battery":
		current = &f.Battery
	case "geofence":
		current = &f.Geofence
	case "rc":
		current = &f.RC
	default:
		return nil
	}
	if *current == active {
		return nil
	}
	*current = active
	return []Event{protocol.FailsafeEvent{Kind: "failsafe", Flag: flag, Active: active, TS: now}}
}

func (l *Link) requestStreams(ctx context.Context) {
	for id, every := range streamRates {
		_, _ = l.commandLong(ctx, common.MAV_CMD_SET_MESSAGE_INTERVAL, float32(id), float32(every.Microseconds()))
	}
	_, _ = l.commandLong(ctx, common.MAV_CMD_REQUEST_MESSAGE, 242) // HOME_POSITION now
	l.log.Info("fc_streams_requested")
	if err := l.readModeSwitch(ctx); err != nil {
		l.log.Warn("fc_mode_switch_read_failed", "error", err.Error())
	}
	// Adopt whatever mission the FC already holds (agent restart, or a
	// ground-station tool wrote it).
	if _, err := l.CurrentMission(ctx); err != nil {
		l.log.Warn("fc_mission_read_failed", "error", err.Error())
	}
}

// currentAppIndex maps MISSION_CURRENT's seq to the app item it belongs to:
// the nearest row at or before seq that has one (a marker row belongs to
// the item before it).
func currentAppIndex(rows []mission.Row, seq int) int {
	for i := len(rows) - 1; i >= 0; i-- {
		if rows[i].Seq <= seq && rows[i].AppIndex != nil {
			return *rows[i].AppIndex
		}
	}
	return -1
}

func (l *Link) target() (uint8, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if !l.ready || l.st.fcSystem == 0 {
		return 0, errors.New("no flight controller heartbeat yet")
	}
	return l.st.fcSystem, nil
}

func degrees(rad float64) float64 { return rad * 180 / math.Pi }

func fixType(t common.GPS_FIX_TYPE) string {
	switch {
	case t >= common.GPS_FIX_TYPE_RTK_FLOAT:
		return "rtk"
	case t >= common.GPS_FIX_TYPE_3D_FIX:
		return "fix3d"
	case t == common.GPS_FIX_TYPE_2D_FIX:
		return "fix2d"
	default:
		return "none"
	}
}

func vtolState(v common.MAV_VTOL_STATE) string {
	switch v {
	case common.MAV_VTOL_STATE_FW:
		return "fw"
	case common.MAV_VTOL_STATE_TRANSITION_TO_FW, common.MAV_VTOL_STATE_TRANSITION_TO_MC:
		return "transition"
	default:
		return "mc"
	}
}

// waiter collects incoming messages that match, for request/response
// exchanges (command acks, the mission protocol, parameters).
type waiter struct {
	match func(message.Message) bool
	ch    chan message.Message
}

func (l *Link) expect(match func(message.Message) bool) *waiter {
	w := &waiter{match: match, ch: make(chan message.Message, 32)}
	l.waitMu.Lock()
	l.waiters[w] = struct{}{}
	l.waitMu.Unlock()
	return w
}

func (l *Link) done(w *waiter) {
	l.waitMu.Lock()
	delete(l.waiters, w)
	l.waitMu.Unlock()
}

func (l *Link) notifyWaiters(msg message.Message) {
	l.waitMu.Lock()
	defer l.waitMu.Unlock()
	for w := range l.waiters {
		if w.match(msg) {
			select {
			case w.ch <- msg:
			default:
			}
		}
	}
}

func (w *waiter) next(ctx context.Context, timeout time.Duration) (message.Message, error) {
	t := time.NewTimer(timeout)
	defer t.Stop()
	select {
	case msg := <-w.ch:
		return msg, nil
	case <-t.C:
		return nil, errTimeout
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

var errTimeout = errors.New("timed out waiting for the flight controller")

func (l *Link) send(msg message.Message) error {
	return l.node.WriteMessageAll(msg)
}

// commandLong sends a COMMAND_LONG and waits for its COMMAND_ACK.
func (l *Link) commandLong(ctx context.Context, cmd common.MAV_CMD, params ...float32) (common.MAV_RESULT, error) {
	sys, err := l.target()
	if err != nil {
		return 0, err
	}
	var p [7]float32
	copy(p[:], params)
	w := l.expect(func(m message.Message) bool {
		ack, ok := m.(*common.MessageCommandAck)
		return ok && ack.Command == cmd
	})
	defer l.done(w)

	for attempt := 0; attempt < 3; attempt++ {
		if err := l.send(&common.MessageCommandLong{
			TargetSystem: sys, TargetComponent: autopilotComp, Command: cmd, Confirmation: uint8(attempt),
			Param1: p[0], Param2: p[1], Param3: p[2], Param4: p[3], Param5: p[4], Param6: p[5], Param7: p[6],
		}); err != nil {
			return 0, err
		}
		msg, err := w.next(ctx, 1500*time.Millisecond)
		if errors.Is(err, errTimeout) {
			continue
		}
		if err != nil {
			return 0, err
		}
		return msg.(*common.MessageCommandAck).Result, nil
	}
	return 0, errTimeout
}

func resultName(r common.MAV_RESULT) string {
	return strings.TrimPrefix(fmt.Sprint(r), "MAV_RESULT_")
}
