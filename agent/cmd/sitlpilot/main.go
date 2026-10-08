// Command sitlpilot stands in for the RC pilot in SITL tests, from SITL's
// second port (5762), as the radio would (ADR-0008). Two ways:
//
//   - -switch MODE moves the radio's mode switch: it holds the FLTMODE_CH
//     channel at the switch position whose FLTMODEn is MODE, with
//     RC_CHANNELS_OVERRIDE, so ArduPilot changes mode the way it does for a
//     real switch (mode reason RC_COMMAND) and RC_CHANNELS shows the new
//     position. -switch release hands the channel back to SITL's own
//     simulated radio, which sits at the AUTO position (sim/params).
//   - -mode MODE commands the mode over MAVLink instead, which to the FC
//     looks like another ground station, not the radio.
//
// Either way the agent didn't command the change, so it should report an RC
// override and refuse browser mode commands until the "pilot" hands back.
//
// SITL only. Nothing in the real system sends RC overrides or mode changes
// this way, and the agent never does (CLAUDE.md): on the aircraft this is
// the physical ELRS radio.
//
//	go run ./cmd/sitlpilot -switch FBWA     # take over with the switch
//	go run ./cmd/sitlpilot -switch release  # hand back
//	go run ./cmd/sitlpilot -mode FBWA       # mode change from "another GCS"
package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/bluenviron/gomavlib/v3"
	"github.com/bluenviron/gomavlib/v3/pkg/dialects/ardupilotmega"
	"github.com/bluenviron/gomavlib/v3/pkg/dialects/common"
	"github.com/bluenviron/gomavlib/v3/pkg/message"
)

var modes = map[string]uint32{"MANUAL": 0, "FBWA": 5, "AUTO": 10, "RTL": 11, "LOITER": 12, "QHOVER": 18, "QLOITER": 19}

// Centre of each of ArduPilot's six switch positions (RC_Channel::read_6pos_switch).
var positionPWM = [6]uint16{1165, 1295, 1425, 1555, 1685, 1850}

const (
	// ArduPilot takes RC overrides only from its GCS system id (SYSID_MYGCS,
	// 255), so the pilot uses it too, with its own component id so nothing
	// mistakes it for the autopilot or the agent.
	pilotSystemID    = 255
	pilotComponentID = 25
	// RC_CHANNELS_OVERRIDE: leave a channel alone (1-8), or release it to the radio.
	ignore  = 65535
	release = 0
)

var errTimeout = errors.New("no answer from SITL")

func main() {
	addr := flag.String("fc", "127.0.0.1:5762", "SITL's second MAVLink port (not the agent's)")
	modeName := flag.String("mode", "", "command this mode over MAVLink: MANUAL, FBWA, AUTO, RTL, LOITER, QHOVER or QLOITER")
	switchTo := flag.String("switch", "", "move the mode switch to this mode's position, or 'release'")
	flag.Parse()
	if (*modeName == "") == (*switchTo == "") {
		fail("give exactly one of -mode or -switch")
	}

	node := &gomavlib.Node{
		Endpoints:      []gomavlib.EndpointConf{gomavlib.EndpointTCPClient{Address: *addr}},
		Dialect:        ardupilotmega.Dialect,
		OutVersion:     gomavlib.V2,
		OutSystemID:    pilotSystemID,
		OutComponentID: pilotComponentID,
		// Quiet: it's not a GCS whose heartbeat should count for anything.
		HeartbeatDisable: true,
	}
	if err := node.Initialize(); err != nil {
		fail("%v", err)
	}
	defer node.Close()
	p := &pilot{node: node}
	if err := p.findFC(); err != nil {
		fail("%v", err)
	}

	if *modeName != "" {
		mode, ok := modes[strings.ToUpper(*modeName)]
		if !ok {
			fail("unknown mode %q", *modeName)
		}
		if err := p.commandMode(mode); err != nil {
			fail("%s: %v", *modeName, err)
		}
		fmt.Printf("pilot commanded %s\n", *modeName)
		return
	}
	if err := p.moveSwitch(strings.ToUpper(*switchTo)); err != nil {
		fail("switch %s: %v", *switchTo, err)
	}
}

type pilot struct {
	node   *gomavlib.Node
	target uint8
}

// next waits for a message from the autopilot that `match` accepts.
func (p *pilot) next(timeout time.Duration, match func(message.Message) bool) (message.Message, error) {
	deadline := time.After(timeout)
	for {
		select {
		case <-deadline:
			return nil, errTimeout
		case evt := <-p.node.Events():
			frm, ok := evt.(*gomavlib.EventFrame)
			if !ok || frm.ComponentID() != 1 {
				continue
			}
			if _, hb := frm.Message().(*common.MessageHeartbeat); hb && p.target == 0 {
				p.target = frm.SystemID()
			}
			if match(frm.Message()) {
				return frm.Message(), nil
			}
		}
	}
}

func (p *pilot) findFC() error {
	_, err := p.next(20*time.Second, func(m message.Message) bool {
		_, ok := m.(*common.MessageHeartbeat)
		return ok
	})
	return err
}

func (p *pilot) param(name string) (float64, error) {
	for attempt := 0; attempt < 5; attempt++ {
		_ = p.node.WriteMessageAll(&common.MessageParamRequestRead{TargetSystem: p.target, TargetComponent: 1, ParamId: name, ParamIndex: -1})
		msg, err := p.next(time.Second, func(m message.Message) bool {
			v, ok := m.(*common.MessageParamValue)
			return ok && v.ParamId == name
		})
		if err == nil {
			return float64(msg.(*common.MessageParamValue).ParamValue), nil
		}
	}
	return 0, fmt.Errorf("reading %s: %w", name, errTimeout)
}

func (p *pilot) commandMode(mode uint32) error {
	for attempt := 0; attempt < 5; attempt++ {
		_ = p.node.WriteMessageAll(&common.MessageCommandLong{
			TargetSystem: p.target, TargetComponent: 1, Command: common.MAV_CMD_DO_SET_MODE,
			Param1: float32(common.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED), Param2: float32(mode),
		})
		msg, err := p.next(time.Second, func(m message.Message) bool {
			ack, ok := m.(*common.MessageCommandAck)
			return ok && ack.Command == common.MAV_CMD_DO_SET_MODE
		})
		if err == nil {
			if r := msg.(*common.MessageCommandAck).Result; r != common.MAV_RESULT_ACCEPTED {
				return fmt.Errorf("refused: %v", r)
			}
			return nil
		}
	}
	return errTimeout
}

// moveSwitch holds FLTMODE_CH at the position for `to`, or releases it, and
// waits until RC_CHANNELS shows the channel there. sim/params sets
// RC_OVERRIDE_TIME -1, so the override stays until released.
func (p *pilot) moveSwitch(to string) error {
	chf, err := p.param("FLTMODE_CH")
	if err != nil {
		return err
	}
	ch := int(chf)
	if ch < 1 || ch > 8 {
		return fmt.Errorf("FLTMODE_CH %d: only channels 1-8 can be overridden here", ch)
	}

	pwm := uint16(release)
	if to != "RELEASE" {
		mode, ok := modes[to]
		if !ok {
			return fmt.Errorf("unknown mode %q", to)
		}
		pos := -1
		for i := range positionPWM {
			v, err := p.param(fmt.Sprintf("FLTMODE%d", i+1))
			if err != nil {
				return err
			}
			if uint32(v) == mode {
				pos = i
				break
			}
		}
		if pos < 0 {
			return fmt.Errorf("no switch position is set to %s (FLTMODE1..6)", to)
		}
		pwm = positionPWM[pos]
	}

	// Message rates are per link in ArduPilot: ask for RC_CHANNELS on this one.
	_ = p.node.WriteMessageAll(&common.MessageCommandLong{
		TargetSystem: p.target, TargetComponent: 1, Command: common.MAV_CMD_SET_MESSAGE_INTERVAL, Param1: 65, Param2: 200_000,
	})
	before, err := p.next(5*time.Second, func(m message.Message) bool {
		_, ok := m.(*common.MessageRcChannels)
		return ok
	})
	if err != nil {
		return fmt.Errorf("no RC_CHANNELS from SITL: %w", err)
	}
	held := rcChannel(before.(*common.MessageRcChannels), ch)

	chans := [8]uint16{ignore, ignore, ignore, ignore, ignore, ignore, ignore, ignore}
	chans[ch-1] = pwm
	for attempt := 0; attempt < 10; attempt++ {
		_ = p.node.WriteMessageAll(&common.MessageRcChannelsOverride{
			TargetSystem: p.target, TargetComponent: 1,
			Chan1Raw: chans[0], Chan2Raw: chans[1], Chan3Raw: chans[2], Chan4Raw: chans[3],
			Chan5Raw: chans[4], Chan6Raw: chans[5], Chan7Raw: chans[6], Chan8Raw: chans[7],
		})
		msg, err := p.next(time.Second, func(m message.Message) bool {
			_, ok := m.(*common.MessageRcChannels)
			return ok
		})
		if err != nil {
			continue
		}
		got := rcChannel(msg.(*common.MessageRcChannels), ch)
		// Released: back to the radio's own value, away from what was held.
		released := pwm == release && absDiff(got, held) >= 20
		if released || (pwm != release && absDiff(got, pwm) < 20) {
			fmt.Printf("pilot moved the mode switch (channel %d) to %s: %d µs\n", ch, to, got)
			return nil
		}
	}
	return errors.New("RC_CHANNELS never showed the switch move (is RC_OVERRIDE_TIME -1 and RC_CHANNELS streaming?)")
}

func rcChannel(m *common.MessageRcChannels, ch int) uint16 {
	return [8]uint16{m.Chan1Raw, m.Chan2Raw, m.Chan3Raw, m.Chan4Raw, m.Chan5Raw, m.Chan6Raw, m.Chan7Raw, m.Chan8Raw}[ch-1]
}

func absDiff(a, b uint16) uint16 {
	if a > b {
		return a - b
	}
	return b - a
}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "sitlpilot: "+format+"\n", args...)
	os.Exit(1)
}
