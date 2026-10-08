// Command sitlpilot stands in for the RC pilot in SITL tests: it changes the
// flight mode from a separate connection (SITL's second port, 5762), the way
// flipping the radio's mode switch would. The agent didn't command that
// change, so it should report an RC override and refuse browser mode
// commands until the "pilot" switches back to AUTO (ADR-0008).
//
// It talks to SITL only. Nothing in the real system sends mode changes this
// way; on the aircraft this is the physical ELRS radio.
//
//	go run ./cmd/sitlpilot -mode FBWA   # take over
//	go run ./cmd/sitlpilot -mode AUTO   # hand back
package main

import (
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/bluenviron/gomavlib/v3"
	"github.com/bluenviron/gomavlib/v3/pkg/dialects/ardupilotmega"
	"github.com/bluenviron/gomavlib/v3/pkg/dialects/common"
)

var modes = map[string]uint32{"MANUAL": 0, "FBWA": 5, "AUTO": 10, "QHOVER": 18, "QLOITER": 19}

func main() {
	addr := flag.String("fc", "127.0.0.1:5762", "SITL's second MAVLink port (not the agent's)")
	modeName := flag.String("mode", "FBWA", "mode to switch to: MANUAL, FBWA, QHOVER, QLOITER or AUTO")
	flag.Parse()

	mode, ok := modes[*modeName]
	if !ok {
		fail("unknown mode %q", *modeName)
	}

	node := &gomavlib.Node{
		Endpoints:   []gomavlib.EndpointConf{gomavlib.EndpointTCPClient{Address: *addr}},
		Dialect:     ardupilotmega.Dialect,
		OutVersion:  gomavlib.V2,
		OutSystemID: 253, // not the agent's 255: a different "operator"
		// Quiet: it's not a GCS whose heartbeat should count for failsafes.
		HeartbeatDisable: true,
	}
	if err := node.Initialize(); err != nil {
		fail("%v", err)
	}
	defer node.Close()

	deadline := time.After(20 * time.Second)
	var target uint8
	sent := false
	resend := time.NewTicker(time.Second)
	defer resend.Stop()
	for {
		select {
		case <-deadline:
			fail("no acknowledgement from SITL")
		case <-resend.C:
			sent = false // resend until acknowledged
		case evt := <-node.Events():
			frm, ok := evt.(*gomavlib.EventFrame)
			if !ok || frm.ComponentID() != 1 {
				continue
			}
			switch m := frm.Message().(type) {
			case *common.MessageHeartbeat:
				target = frm.SystemID()
			case *common.MessageCommandAck:
				if m.Command == common.MAV_CMD_DO_SET_MODE {
					if m.Result != common.MAV_RESULT_ACCEPTED {
						fail("SITL refused %s: %v", *modeName, m.Result)
					}
					fmt.Printf("pilot switched to %s\n", *modeName)
					return
				}
			}
		}
		if target != 0 && !sent {
			sent = true
			_ = node.WriteMessageAll(&common.MessageCommandLong{
				TargetSystem: target, TargetComponent: 1, Command: common.MAV_CMD_DO_SET_MODE,
				Param1: float32(common.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED), Param2: float32(mode),
			})
		}
	}
}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "sitlpilot: "+format+"\n", args...)
	os.Exit(1)
}
