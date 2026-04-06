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

	// Build lists for prompt
	var gameLines strings.Builder
	for _, g := range games {
		fmt.Fprintf(&gameLines, "- %q -> %q\n", g.Id, g.Name)
	}

	var playerLines strings.Builder
	for _, p := range players {
		fmt.Fprintf(&playerLines, "- %q -> %q\n", fmt.Sprintf("%d", p.ID), p.Name)
	}

	prompt := fmt.Sprintf(`You are a board game score parser. Your job is to extract game and player scores from spoken text.

Rules:
- Match game and player names by semantic similarity: handle typos, transliteration (e.g. "Скалл Кинг" -> "Skull King"), nicknames (e.g. "Ваня" -> "Иван"), and partial names
- If a player is mentioned multiple times, use the LAST mentioned score (corrections like "нет, Ваня 18" override previous values)
- Set game_id to null if no game is recognized
- Only include players that are clearly mentioned with a score
- Return ONLY valid JSON, no explanation

Available games (id -> name):
%s
Available players (id -> name):
%s
Return JSON in this exact format:
{"game_id": "<id or null>", "scores": [{"player_id": "<id>", "points": <integer>}]}

Speech: %q`,
		gameLines.String(),
		playerLines.String(),
		body.Text,
	)

	// Call Ollama
	result, err := callOllama(prompt)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, fmt.Errorf("ollama error: %w", err))
		return
	}

	// Parse Ollama JSON response
	type scoreItem struct {
		PlayerID string `json:"player_id"`
		Points   int    `json:"points"`
	}
	var parsed struct {
		GameID *string     `json:"game_id"`
		Scores []scoreItem `json:"scores"`
	}
	if err := json.Unmarshal([]byte(result), &parsed); err != nil {
		ErrorResponse(c, http.StatusInternalServerError, fmt.Errorf("failed to parse ollama response: %w, raw: %s", err, result))
		return
	}

	SuccessDataResponse(c, gin.H{
		"game_id": parsed.GameID,
		"scores":  parsed.Scores,
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
