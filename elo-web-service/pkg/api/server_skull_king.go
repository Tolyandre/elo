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

SUIT CARDS have a number (1–14) printed prominently in the corners. Identify the suit by BORDER COLOR and artwork:
- "jolly-roger" — BLACK/DARK border. Artwork: a sailing pirate ship on the sea, or a skull-and-crossbones (Jolly Roger) flag.
- "chest"       — GOLD/YELLOW border. Artwork: a treasure chest, gold chains, or large stacks of gold coins.
- "parrot"      — GREEN border. Artwork: a colorful tropical parrot (green and red plumage).
- "map"         — PURPLE/VIOLET border. Artwork: a brown parchment scroll with a treasure map.

SPECIAL CARDS have NO number. Identify by the character or symbol depicted:
- "skull-king"   — The Skull King pirate captain: dominant, elaborately dressed pirate figure. Boss of the game.
- "pirate"       — A regular male pirate character (simpler than Skull King, may hold a sword or pistol).
- "tigress"      — A female pirate character (Tigress). She may hold a white flag or sword.
- "mermaid"      — An underwater scene with a woman (fish tail may not be visible; look for blue water, feminine figure).
- "escape"       — A plain white flag / surrender flag. Simple white flag design.
- "loot"         — Piles of gold coins or treasure (NO number printed — if there is a number it is a "chest" suit card instead).
- "kraken"       — A giant octopus / sea monster with tentacles emerging from the sea.
- "white-whale"  — A white beluga whale / white whale in the ocean.

DISAMBIGUATION TIPS:
- If you see gold coins WITH a number → "chest" (suit card). If gold coins with NO number → "loot" (special).
- "skull-king" is the main boss figure; "pirate" is a regular pirate. When in doubt between the two, check for regalia/crown.
- "mermaid" has a human/feminine figure in water; "white-whale" has a whale.
- "tigress" is female; "pirate" is male.
- Border color is a reliable indicator for suit cards when the artwork is unclear.

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
