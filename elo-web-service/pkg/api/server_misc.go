package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	cfg "github.com/tolyandre/elo-web-service/pkg/configuration"
)

func (s *StrictServer) GetPing(_ context.Context, _ GetPingRequestObject) (GetPingResponseObject, error) {
	return GetPing200JSONResponse{Status: "success", Message: "pong"}, nil
}

func (s *StrictServer) ParseVoiceInput(ctx context.Context, request ParseVoiceInputRequestObject) (ParseVoiceInputResponseObject, error) {
	text := request.Body.Text
	if strings.TrimSpace(text) == "" {
		return ParseVoiceInput400JSONResponse{Status: "fail", Message: "text is required"}, nil
	}

	games, err := s.api.GameService.GetGameTitlesOrderedByLastPlayed(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to load games: %w", err)
	}

	players, err := s.api.PlayerService.ListPlayers(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to load players: %w", err)
	}

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
		if p.GeologistName.Valid && p.GeologistName.String != "" {
			fmt.Fprintf(&playerLines, "- %q -> %q (alias: %q)\n", id, p.Name, p.GeologistName.String)
		} else {
			fmt.Fprintf(&playerLines, "- %q -> %q\n", id, p.Name)
		}
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
		text,
	)

	result, err := callOllamaVoice(prompt)
	if err != nil {
		return ParseVoiceInput500JSONResponse{Status: "fail", Message: fmt.Sprintf("ollama error: %v", err)}, nil
	}

	type scoreItem struct {
		PlayerID string `json:"player_id"`
		Points   *int   `json:"points"`
	}
	var parsed struct {
		GameID *string     `json:"game_id"`
		Scores []scoreItem `json:"scores"`
	}
	if err := json.Unmarshal([]byte(result), &parsed); err != nil {
		return ParseVoiceInput500JSONResponse{Status: "fail", Message: fmt.Sprintf("failed to parse ollama response: %v, raw: %s", err, result)}, nil
	}

	if parsed.GameID != nil {
		if _, ok := gameIDs[*parsed.GameID]; !ok {
			parsed.GameID = nil
		}
	}

	validScores := make([]VoiceScore, 0)
	for _, s := range parsed.Scores {
		if s.Points == nil {
			continue
		}
		if _, ok := playerIDs[s.PlayerID]; !ok {
			continue
		}
		validScores = append(validScores, VoiceScore{PlayerId: s.PlayerID, Points: *s.Points})
	}

	return ParseVoiceInput200JSONResponse{
		Status: "success",
		Data: VoiceParseResult{
			GameId: parsed.GameID,
			Scores: validScores,
		},
	}, nil
}

func callOllamaVoice(prompt string) (string, error) {
	baseURL := cfg.Config.OllamaBaseUrl
	model := cfg.Config.OllamaModel

	reqBody, err := json.Marshal(map[string]interface{}{
		"model":  model,
		"prompt": prompt,
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
