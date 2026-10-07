package mission

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// Shared with the browser's preview translator (testdata/mission-translation/README.md).
const goldenDir = "../../../testdata/mission-translation"

type golden struct {
	Home     *Home   `json:"home"`
	Mission  Mission `json:"mission"`
	Expected struct {
		Items  []Row              `json:"items"`
		Fence  []Row              `json:"fence"`
		Params map[string]float64 `json:"params"`
		Issues []struct {
			ItemIndex *int   `json:"itemIndex"`
			Code      string `json:"code"`
			Severity  string `json:"severity"`
		} `json:"issues"`
	} `json:"expected"`
}

func TestGoldenFiles(t *testing.T) {
	files, err := filepath.Glob(filepath.Join(goldenDir, "*.json"))
	if err != nil || len(files) == 0 {
		t.Fatalf("no golden files in %s (err %v)", goldenDir, err)
	}
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

			got, err := Translate(g.Mission, g.Home)
			if err != nil {
				t.Fatal(err)
			}

			if !reflect.DeepEqual(got.Items, g.Expected.Items) {
				t.Errorf("items:\n got  %s\n want %s", mustJSON(t, got.Items), mustJSON(t, g.Expected.Items))
			}
			if !reflect.DeepEqual(got.Fence, g.Expected.Fence) {
				t.Errorf("fence:\n got  %s\n want %s", mustJSON(t, got.Fence), mustJSON(t, g.Expected.Fence))
			}
			if !reflect.DeepEqual(got.Params, g.Expected.Params) {
				t.Errorf("params: got %v, want %v", got.Params, g.Expected.Params)
			}
			gotIssues := make([]any, len(got.Issues))
			for i, is := range got.Issues {
				gotIssues[i] = map[string]any{"itemIndex": is.ItemIndex, "code": is.Code, "severity": is.Severity}
			}
			wantIssues := make([]any, len(g.Expected.Issues))
			for i, is := range g.Expected.Issues {
				wantIssues[i] = map[string]any{"itemIndex": is.ItemIndex, "code": is.Code, "severity": is.Severity}
			}
			if mustJSON(t, gotIssues) != mustJSON(t, wantIssues) {
				t.Errorf("issues:\n got  %s\n want %s", mustJSON(t, gotIssues), mustJSON(t, wantIssues))
			}
		})
	}
}

func TestUnknownItemTypeIsRefused(t *testing.T) {
	_, err := Translate(Mission{Items: []Item{{Type: "doSetServo"}}}, nil)
	if err == nil {
		t.Fatal("expected an unknown item type to be refused")
	}
}

func TestAppIndexForSeq(t *testing.T) {
	res, err := Translate(Mission{Items: []Item{{Type: "vtolTakeoff", AltM: 30}, {Type: "returnToLaunch"}}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if AppIndexForSeq(res.Items, 0) != nil {
		t.Error("home should have no app index")
	}
	if got := AppIndexForSeq(res.Items, 2); got == nil || *got != 1 {
		t.Errorf("seq 2 → %v, want 1", got)
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
