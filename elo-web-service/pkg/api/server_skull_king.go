package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	cfg "github.com/tolyandre/elo-web-service/pkg/configuration"
)

var skullKingCardPrompt = `You are a Skull King card game expert. Identify the card shown in the image.

Suit cards — each suit has values 1 through 14 printed on the card:
- "jolly-roger": black Jolly Roger flag (skull and crossbones)
- "chest": yellow/gold treasure chest
- "parrot": green colourful parrot bird
- "map": purple parchment treasure map

Special cards — no numeric value, recognized by the character or symbol:
- "skull-king": pirate captain
- "pirate": a pirate character
- "tigress": a female pirate with white flag
- "mermaid": a mermaid (woman, fish tail might not be visible)
- "escape": a white flag / surrender flag
- "loot": a card with money
- "kraken": a giant octopus / kraken sea monster
- "white-whale": a white whale / beluga

Return ONLY valid JSON, no explanation:
- Suit card:    {"type": "<suit-name>", "value": <integer 1-14>}
- Special card: {"type": "<special-name>"}

Examples: {"type": "chest", "value": 7} or {"type": "pirate"}`

// ParseSkullKingCardImage handles POST /skull-king/parse-card-image.
// It accepts a JSON body {"image": "<base64>"} and returns the identified Skull King card.
// The image must be base64-encoded without the data-URI prefix.
func (a *API) ParseSkullKingCardImage(c *gin.Context) {
	var req struct {
		Image string `json:"image"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Image == "" {
		c.JSON(http.StatusBadRequest, gin.H{"status": "fail", "message": "image is required (base64 string)"})
		return
	}

	raw, err := callOllamaVision(req.Image)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"status": "fail", "message": fmt.Sprintf("ollama error: %v", err)})
		return
	}

	var card struct {
		Type  string `json:"type"`
		Value *int   `json:"value"`
	}
	if err := json.Unmarshal([]byte(raw), &card); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"status":  "fail",
			"message": fmt.Sprintf("failed to parse ollama response: %s", raw),
		})
		return
	}

	validSuits := map[string]bool{
		"jolly-roger": true,
		"chest":       true,
		"parrot":      true,
		"map":         true,
	}
	validSpecials := map[string]bool{
		"skull-king":  true,
		"pirate":      true,
		"tigress":     true,
		"mermaid":     true,
		"escape":      true,
		"loot":        true,
		"kraken":      true,
		"white-whale": true,
	}

	if validSuits[card.Type] {
		if card.Value == nil || *card.Value < 1 || *card.Value > 14 {
			c.JSON(http.StatusUnprocessableEntity, gin.H{
				"status":  "fail",
				"message": fmt.Sprintf("suit card %q requires value 1-14", card.Type),
			})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"status": "success",
			"data":   gin.H{"type": card.Type, "value": *card.Value},
		})
	} else if validSpecials[card.Type] {
		c.JSON(http.StatusOK, gin.H{
			"status": "success",
			"data":   gin.H{"type": card.Type},
		})
	} else {
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"status":  "fail",
			"message": fmt.Sprintf("unrecognized card type: %q", card.Type),
		})
	}
}

func callOllamaVision(imageBase64 string) (string, error) {
	baseURL := cfg.Config.OllamaBaseUrl
	model := cfg.Config.OllamaVisionModel

	reqBody, err := json.Marshal(map[string]interface{}{
		"model":  model,
		"prompt": skullKingCardPrompt,
		"images": []string{imageBase64},
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
