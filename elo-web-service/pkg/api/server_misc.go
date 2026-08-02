package api

import (
	"context"
	"fmt"
	"strings"
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

	parsed, err := s.api.VoiceParser.Parse(ctx, text, games, players)
	if err != nil {
		return ParseVoiceInput500JSONResponse{Status: "fail", Message: fmt.Sprintf("ollama error: %v", err)}, nil
	}

	validScores := make([]VoiceScore, 0, len(parsed.Scores))
	for _, s := range parsed.Scores {
		validScores = append(validScores, VoiceScore{PlayerId: s.PlayerID, Points: s.Points})
	}

	return ParseVoiceInput200JSONResponse{
		Status: "success",
		Data: VoiceParseResult{
			GameId: parsed.GameID,
			Scores: validScores,
		},
	}, nil
}
