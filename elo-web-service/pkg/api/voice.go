package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
)

// VoiceParser turns free-form speech-to-text into a structured game+scores
// result by prompting a local Ollama LLM. It was previously inline in the
// ParseVoiceInput handler (server_misc.go); extracted here so the handler is a
// thin caller and the prompt-building + HTTP client are independently testable.
type VoiceParser struct {
	baseURL string
	model   string
	client  voiceHTTPDoer
}

// voiceHTTPDoer is the subset of *http.Client behaviour VoiceParser needs,
// factored out so the parser can be unit-tested with a fake transport.
type voiceHTTPDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

// NewVoiceParser constructs a parser targeting the given Ollama base URL/model.
func NewVoiceParser(baseURL, model string) *VoiceParser {
	return &VoiceParser{baseURL: baseURL, model: model, client: http.DefaultClient}
}

// voiceScore is the per-player entry the LLM is asked to return.
type voiceScore struct {
	PlayerID string `json:"player_id"`
	Points   *int   `json:"points"`
}

type voiceLLMResponse struct {
	GameID *string      `json:"game_id"`
	Scores []voiceScore `json:"scores"`
}

// voiceParseOutput is the validated, ID-checked result of parsing one utterance.
// (Not exported because the public-facing response type is the generated
// VoiceParseResult in generated.go; the handler maps between the two.)
type voiceParseOutput struct {
	GameID *string
	Scores []voiceScoreEntry
}

// voiceScoreEntry is a single validated player/points pair (points always set).
type voiceScoreEntry struct {
	PlayerID string
	Points   int
}

// Parse loads the valid game/player ids, builds the prompt, calls the model, and
// returns only entries whose ids are known and whose points are present.
func (p *VoiceParser) Parse(ctx context.Context, text string, games []elo.GameTitles, players []db.Player) (voiceParseOutput, error) {
	gameIDs := make(map[string]struct{}, len(games))
	var gameLines strings.Builder
	for _, g := range games {
		gameIDs[g.Id] = struct{}{}
		fmt.Fprintf(&gameLines, "- %q -> %q\n", g.Id, g.Name)
	}

	playerIDs := make(map[string]struct{}, len(players))
	var playerLines strings.Builder
	for _, pl := range players {
		id := pl.ID
		playerIDs[id] = struct{}{}
		if pl.GeologistName.Valid && pl.GeologistName.String != "" {
			fmt.Fprintf(&playerLines, "- %q -> %q (alias: %q)\n", id, pl.Name, pl.GeologistName.String)
		} else {
			fmt.Fprintf(&playerLines, "- %q -> %q\n", id, pl.Name)
		}
	}

	prompt := buildVoicePrompt(text, gameLines.String(), playerLines.String())

	result, err := p.callOllama(ctx, prompt)
	if err != nil {
		return voiceParseOutput{}, err
	}

	var parsed voiceLLMResponse
	if err := json.Unmarshal([]byte(result), &parsed); err != nil {
		return voiceParseOutput{}, fmt.Errorf("failed to parse ollama response: %v, raw: %s", err, result)
	}

	if parsed.GameID != nil {
		if _, ok := gameIDs[*parsed.GameID]; !ok {
			parsed.GameID = nil
		}
	}

	validScores := make([]voiceScoreEntry, 0, len(parsed.Scores))
	for _, s := range parsed.Scores {
		if s.Points == nil {
			continue
		}
		if _, ok := playerIDs[s.PlayerID]; !ok {
			continue
		}
		validScores = append(validScores, voiceScoreEntry{PlayerID: s.PlayerID, Points: *s.Points})
	}

	return voiceParseOutput{GameID: parsed.GameID, Scores: validScores}, nil
}

// buildVoicePrompt assembles the instruction string sent to the LLM.
func buildVoicePrompt(text, gameList, playerList string) string {
	return fmt.Sprintf(`You are a board game score parser. Extract game and player scores from spoken text (speech). Text may contain speech-to-text recognition errors, ignore errors. Text may contain partial information, like only game name or only players.

Rules:
- Extract game name, players names and their scores
- Match game and player names by partial name semantic similarity: handle typos, transliteration (e.g. "Скалл Кинг" -> "Skull King"), nicknames (e.g. "Ваня" -> "Иван")
- If a player is mentioned multiple times, use the LAST mentioned score (corrections like "нет, Ваня 18" override previous values)
- Set game_id to null if no game is clearly recognized
- Do not include player if name or score is not clearly recognized
- Do not include players with unknown or null score
- Only include players that are clearly mentioned with a score
- If no player scores are mentioned, return an empty scores array: []
- game_id and player_id MUST be copied verbatim from the lists below — never invent, guess, or substitute an ID
- player_id and points MUST NOT be null — omit the entry entirely if either is unclear
- Return ONLY valid JSON, no explanation

Available games (id -> name):
%s
Available players (id -> name):
%s
Return JSON in this exact format:
{"game_id": "<id from list above, or null>", "scores": [{"player_id": "<id from list above>", "points": <non-null integer>}]}

Speech: %q`,
		gameList,
		playerList,
		text,
	)
}

// callOllama posts the prompt to the Ollama /api/generate endpoint and returns
// the model's raw response string. The request honors the caller's context.
func (p *VoiceParser) callOllama(ctx context.Context, prompt string) (string, error) {
	reqBody, err := json.Marshal(map[string]interface{}{
		"model":  p.model,
		"prompt": prompt,
		"format": "json",
		"stream": false,
	})
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+"/api/generate", bytes.NewReader(reqBody))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("ollama unreachable at %s: %w", p.baseURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("ollama returned %d: %s", resp.StatusCode, string(body))
	}

	var ollamaResp struct {
		Response string `json:"response"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&ollamaResp); err != nil {
		return "", fmt.Errorf("failed to decode ollama response: %w", err)
	}

	return ollamaResp.Response, nil
}
