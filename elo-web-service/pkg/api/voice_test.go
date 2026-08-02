package api

import (
	"strings"
	"testing"
)

func TestBuildVoicePrompt(t *testing.T) {
	prompt := buildVoicePrompt("ваня 18", "- \"g1\" -> \"Skull King\"\n", "- \"p1\" -> \"Иван\"\n")

	// The prompt must carry the speech text and both id lists verbatim, so the
	// model can copy ids without inventing them.
	for _, want := range []string{"ваня 18", "\"g1\" -> \"Skull King\"", "\"p1\" -> \"Иван\""} {
		if !strings.Contains(prompt, want) {
			t.Errorf("prompt missing %q\n--- prompt ---\n%s", want, prompt)
		}
	}
	// The exact JSON return contract must be stated.
	if !strings.Contains(prompt, `"game_id"`) || !strings.Contains(prompt, `"scores"`) {
		t.Errorf("prompt must describe the JSON return shape")
	}
}
