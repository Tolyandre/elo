package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	cfg "github.com/tolyandre/elo-web-service/pkg/configuration"
)

// ParseVoiceInput uses Ollama to extract game and player scores from natural language speech.
// It loads all games and players from the DB, builds a prompt, and calls Ollama with JSON mode.
func (a *API) ParseVoiceInput(c *gin.Context) {
	var body struct {
		Text string `json:"text"`
	}
	if err := c.BindJSON(&body); err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}
	if strings.TrimSpace(body.Text) == "" {
		ErrorResponse(c, http.StatusBadRequest, "text is required")
		return
	}

	// Load games
	games, err := a.GameService.GetGameTitlesOrderedByLastPlayed(c.Request.Context())
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, fmt.Errorf("failed to load games: %w", err))
		return
	}

	// Load players
	players, err := a.PlayerService.ListPlayers(c.Request.Context())
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, fmt.Errorf("failed to load players: %w", err))
		return
	}

	// Build lookup sets and prompt lines
	gameIDs := make(map[string]struct{}, len(games))
	var gameLines strings.Builder
	for _, g := range games {
		gameIDs[g.Id] = struct{}{}
		fmt.Fprintf(&gameLines, "- %q -> %q\n", g.Id, g.Name)
	}

	playerIDs := make(map[string]struct{}, len(players))
	var playerLines strings.Builder
	for _, p := range players {
		id := fmt.Sprintf("%d", p.ID)
		playerIDs[id] = struct{}{}
		fmt.Fprintf(&playerLines, "- %q -> %q\n", id, p.Name)
	}

	prompt := fmt.Sprintf(`You are a board game score parser. Extract game and player scores from spoken text (speech). Text may contain speech-to-text recognition errors, ignore errors. Text may contain partial information, like only game name or only players.

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
		gameLines.String(),
		playerLines.String(),
		body.Text,
	)

	print(prompt)

	// Call Ollama
	result, err := callOllama(prompt)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, fmt.Errorf("ollama error: %w", err))
		return
	}

	// Parse Ollama JSON response.
	// Use *int for points so we can detect null (model didn't know the score).
	type scoreItem struct {
		PlayerID string `json:"player_id"`
		Points   *int   `json:"points"`
	}
	var parsed struct {
		GameID *string     `json:"game_id"`
		Scores []scoreItem `json:"scores"`
	}
	if err := json.Unmarshal([]byte(result), &parsed); err != nil {
		ErrorResponse(c, http.StatusInternalServerError, fmt.Errorf("failed to parse ollama response: %w, raw: %s", err, result))
		return
	}

	// Validate all IDs against sets loaded from DB.
	// Discards hallucinated IDs so an invalid game_id never reaches the frontend combobox.
	if parsed.GameID != nil {
		if _, ok := gameIDs[*parsed.GameID]; !ok {
			parsed.GameID = nil
		}
	}

	type validScore struct {
		PlayerID string `json:"player_id"`
		Points   int    `json:"points"`
	}
	validScores := make([]validScore, 0)
	for _, s := range parsed.Scores {
		if s.Points == nil {
			continue // model returned null points — skip
		}
		if _, ok := playerIDs[s.PlayerID]; !ok {
			continue // hallucinated or empty player_id — skip
		}
		validScores = append(validScores, validScore{PlayerID: s.PlayerID, Points: *s.Points})
	}

	SuccessDataResponse(c, gin.H{
		"game_id": parsed.GameID,
		"scores":  validScores,
	})
}

// callOllama sends a prompt to Ollama and returns the response text.
// Uses Ollama's /api/generate endpoint with JSON format mode.
func callOllama(prompt string) (string, error) {
	baseURL := cfg.Config.OllamaBaseUrl
	model := cfg.Config.OllamaModel

	reqBody, err := json.Marshal(map[string]interface{}{
		"model":  model,
		"prompt": prompt,
		// JSON mode: Ollama guarantees valid JSON output
		"format": "json",
		"stream": false,
	})
	if err != nil {
		return "", err
	}

	resp, err := http.Post(baseURL+"/api/generate", "application/json", bytes.NewReader(reqBody))
	if err != nil {
		return "", fmt.Errorf("ollama unreachable at %s: %w", baseURL, err)
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
