// Command sitlcheck flies a scripted mission in ArduPlane SITL through the
// agent's flight-controller link (internal/fc), with no browser: upload and
// read back, arm, take off, pause, resume, RTL, land. It's the end-to-end
// check that the MAVLink side does what docs/MAVLINK.md says.
//
//	cd sim && docker compose up -d
//	go run ./cmd/sitlcheck
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/bluenviron/gomavlib/v3"

	"github.com/tomwildoer/cellular-drone/agent/internal/fc"
	"github.com/tomwildoer/cellular-drone/agent/internal/mission"
	"github.com/tomwildoer/cellular-drone/agent/internal/protocol"
)

func main() {
	addr := flag.String("fc", "127.0.0.1:5760", "SITL MAVLink TCP address")
	cruiseS := flag.Duration("cruise", 90*time.Second, "how long to fly the mission before pausing")
	pauseLimit := flag.Bool("pause-limit", false, "experiment: pause mid-leg and never resume; pause_resume.lua should resume by itself and rejoin the leg")
	resume := flag.Bool("resume", false, "experiment: pause mid-leg, resume, and measure whether ArduPlane rejoins the leg or flies straight from where it is")
	clock := flag.Bool("clock", false, "make the loiter a clock-mode one (until UTC now + 3 min) and wait for loiter_until.lua to end it, instead of pause/resume")
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()

	link, err := fc.New(fc.Config{
		Endpoint:  gomavlib.EndpointTCPClient{Address: *addr},
		VehicleID: "sitl",
		Log:       log,
		OnEvent: func(ev fc.Event) {
			raw, _ := json.Marshal(ev)
			fmt.Printf("  event %s\n", raw)
		},
	})
	must(err)
	go link.Run(ctx)
	link.SetCommanderActive(true)

	step("waiting for GPS and home")
	state := waitFor(ctx, link, 3*time.Minute, func(s protocol.VehicleState) bool {
		return (s.GPS.FixType == "fix3d" || s.GPS.FixType == "rtk") && s.Home != nil
	})
	home := *state.Home
	fmt.Printf("  home %.6f, %.6f @ %.1f m AMSL, mode %s\n", home.Lat, home.Lon, home.AltAmslM, state.FlightMode)

	if *resume || *pauseLimit {
		resumeExperiment(ctx, link, home, *pauseLimit)
		return
	}

	step("uploading mission")
	turns := 1.0
	at := func(eastM, northM float64) (float64, float64) {
		const mPerDeg = 111320.0
		return home.Lat + northM/mPerDeg, home.Lon + eastM/(mPerDeg*cosDeg(home.Lat))
	}
	wpLat, wpLon := at(0, 500)
	loLat, loLon := at(500, 500)
	m := mission.Mission{ID: "sitlcheck", Name: "SITL check", Items: []mission.Item{
		{Type: "vtolTakeoff", AltM: 40},
		{Type: "waypoint", Lat: wpLat, Lon: wpLon, AltM: 60},
		{Type: "loiter", Lat: loLat, Lon: loLon, AltM: 60, RadiusM: 80, Turns: &turns},
		{Type: "returnToLaunch"},
	}}
	if *clock {
		now := time.Now().UTC().Add(3 * time.Minute)
		until := float64(now.Hour()*60 + now.Minute())
		m.Items[2] = mission.Item{Type: "loiter", Lat: loLat, Lon: loLon, AltM: 60, RadiusM: 80, UntilUTCMinuteOfDay: &until}
		fmt.Printf("  clock loiter until %02d:%02d UTC\n", now.Hour(), now.Minute())
	}
	result, rows := link.UploadMission(ctx, m)
	expectOK("upload", result)
	for _, r := range rows {
		idx := "-"
		if r.AppIndex != nil {
			idx = fmt.Sprint(*r.AppIndex)
		}
		fmt.Printf("  seq %d cmd %d frame %d params %v %.6f,%.6f alt %.1f app %s\n", r.Seq, r.Command, r.Frame, r.Params, r.Lat, r.Lon, r.AltM, idx)
	}

	step("arming (retrying while pre-arm checks settle)")
	deadline := time.Now().Add(2 * time.Minute)
	for {
		res := link.Command(ctx, protocol.Command{Type: "arm"})
		if res.OK {
			break
		}
		if time.Now().After(deadline) {
			fail("arm: %s %s", res.Reason, res.Detail)
		}
		time.Sleep(3 * time.Second)
	}

	step("starting mission")
	expectOK("mission.start", link.Command(ctx, protocol.Command{Type: "mission.start"}))
	if *clock {
		step("waiting for loiter_until.lua to end the loiter")
		waitFor(ctx, link, 8*time.Minute, func(s protocol.VehicleState) bool { return s.MissionProgress.CurrentIndex >= 3 })
		fmt.Printf("  left the loiter at %s UTC\n", time.Now().UTC().Format("15:04:05"))
		step("RTL (from the mission) until landed")
		waitFor(ctx, link, 6*time.Minute, func(s protocol.VehicleState) bool { return s.Landed && s.Position.AltRelM < 1 })
		step("done")
		return
	}
	watch(ctx, link, *cruiseS)

	step("pause")
	expectOK("mode.pause", link.Command(ctx, protocol.Command{Type: "mode.pause"}))
	watch(ctx, link, 10*time.Second)
	step("resume")
	expectOK("mode.resume", link.Command(ctx, protocol.Command{Type: "mode.resume"}))
	watch(ctx, link, 10*time.Second)

	step("RTL until landed")
	expectOK("mode.rtl", link.Command(ctx, protocol.Command{Type: "mode.rtl"}))
	time.Sleep(5 * time.Second)
	waitFor(ctx, link, 6*time.Minute, func(s protocol.VehicleState) bool { return s.Landed && s.Position.AltRelM < 1 })
	final := link.State()
	fmt.Printf("  landed %.1f m from home, armed %v\n", distanceM(final.Position.Lat, final.Position.Lon, home.Lat, home.Lon), final.Armed)
	if final.Armed {
		expectOK("disarm", link.Command(ctx, protocol.Command{Type: "disarm"}))
	}
	step("done")
}

func watch(ctx context.Context, link *fc.Link, d time.Duration) {
	end := time.Now().Add(d)
	for time.Now().Before(end) && ctx.Err() == nil {
		s := link.State()
		fmt.Printf("  %-7s %-10s alt %5.1f m  gs %4.1f m/s  item %d/%d  armed %v landed %v\n",
			s.FlightMode, s.VtolState, s.Position.AltRelM, s.GroundSpeedMps, s.MissionProgress.CurrentIndex+1, s.MissionProgress.Total, s.Armed, s.Landed)
		time.Sleep(5 * time.Second)
	}
}

func waitFor(ctx context.Context, link *fc.Link, timeout time.Duration, ok func(protocol.VehicleState) bool) protocol.VehicleState {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) && ctx.Err() == nil {
		if s := link.State(); ok(s) {
			return s
		}
		time.Sleep(time.Second)
	}
	fail("timed out; last state %+v", link.State())
	return protocol.VehicleState{}
}

func step(name string) { fmt.Printf("\n== %s (%s)\n", name, time.Now().Format("15:04:05")) }

func expectOK(what string, r protocol.CommandResult) {
	if !r.OK {
		fail("%s: %s %s", what, r.Reason, r.Detail)
	}
	fmt.Printf("  %s ok\n", what)
}

func must(err error) {
	if err != nil {
		fail("%v", err)
	}
}

func fail(format string, args ...any) {
	fmt.Printf("FAIL: "+format+"\n", args...)
	os.Exit(1)
}
