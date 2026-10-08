package mission

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// Every golden mission must survive Translate → FromRows → Translate, so a
// mission read back from the FC looks the same as the one uploaded.
func TestFromRowsInvertsTranslate(t *testing.T) {
	files, _ := filepath.Glob(filepath.Join(goldenDir, "*.json"))
	for _, file := range files {
		t.Run(filepath.Base(file), func(t *testing.T) {
			raw, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			var g golden
			if err := json.Unmarshal(raw, &g); err != nil {
				t.Fatal(err)
			}
			first, err := Translate(g.Mission, g.Home)
			if err != nil {
				t.Fatal(err)
			}

			rebuilt, rows, err := FromRows(first.Items)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(rows, first.Items) {
				t.Errorf("app indices:\n got  %s\n want %s", mustJSON(t, rows), mustJSON(t, first.Items))
			}
			again, err := Translate(rebuilt, g.Home)
			if err != nil {
				t.Fatal(err)
			}
			if !Same(first.Items, again.Items) {
				t.Errorf("round trip changed the mission:\n first %s\n again %s", mustJSON(t, first.Items), mustJSON(t, again.Items))
			}

			id1 := rebuilt.ID
			rebuilt2, _, _ := FromRows(first.Items)
			if id1 != rebuilt2.ID {
				t.Error("the same rows should give the same id")
			}
		})
	}
}

func TestFromRowsRefusesCommandsWithoutAppItems(t *testing.T) {
	rows := []Row{{Seq: 0, Command: CmdNavWaypoint}, {Seq: 1, Command: 183 /* DO_SET_SERVO */}}
	if _, _, err := FromRows(rows); err == nil {
		t.Fatal("expected a command with no app item to be refused")
	}
	bare := []Row{{Seq: 0, Command: CmdNavWaypoint}, {Seq: 1, Command: CmdNavLoiterUnlim}}
	if _, _, err := FromRows(bare); err == nil {
		t.Fatal("expected an unlimited loiter without its marker to be refused")
	}
}

func TestSameAllowsStorageRounding(t *testing.T) {
	a := []Row{{Seq: 0, Lat: 1}, {Seq: 1, Command: CmdNavWaypoint, Lat: -37.86, Lon: 145.063, AltM: 60}}
	b := []Row{{Seq: 0, Lat: 9}, {Seq: 1, Command: CmdNavWaypoint, Lat: -37.8600001, Lon: 145.063, AltM: 60.004, Frame: 6}}
	if !Same(a, b) {
		t.Error("home and storage rounding should not count as a difference")
	}
	b[1].AltM = 61
	if Same(a, b) {
		t.Error("a changed altitude should count")
	}
}

func TestValidate(t *testing.T) {
	ok := Mission{Items: []Item{{Type: "vtolTakeoff", AltM: 40}, {Type: "returnToLaunch"}}}
	if err := Validate(ok); err != nil {
		t.Fatalf("valid mission refused: %v", err)
	}
	for name, m := range map[string]Mission{
		"empty":      {},
		"no takeoff": {Items: []Item{{Type: "waypoint"}, {Type: "returnToLaunch"}}},
		"no ending":  {Items: []Item{{Type: "vtolTakeoff"}, {Type: "waypoint"}}},
		"too high":   {Items: []Item{{Type: "vtolTakeoff", AltM: 150}, {Type: "returnToLaunch"}}},
	} {
		if Validate(m) == nil {
			t.Errorf("%s: expected a refusal", name)
		}
	}
}
