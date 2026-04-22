package api

import (
	"encoding/base64"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
)

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

	data, err := base64.StdEncoding.DecodeString(req.Image)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"status": "fail", "message": "invalid base64 encoding"})
		return
	}

	result, err := a.CardRecognizer.Recognize(data)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"status":  "fail",
			"message": fmt.Sprintf("could not recognize card: %v", err),
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

	if validSuits[result.Type] {
		if result.Value == nil || *result.Value < 1 || *result.Value > 14 {
			c.JSON(http.StatusUnprocessableEntity, gin.H{
				"status":  "fail",
				"message": fmt.Sprintf("suit card %q requires value 1-14", result.Type),
			})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"status": "success",
			"data":   gin.H{"type": result.Type, "value": *result.Value},
		})
	} else if validSpecials[result.Type] {
		c.JSON(http.StatusOK, gin.H{
			"status": "success",
			"data":   gin.H{"type": result.Type},
		})
	} else {
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"status":  "fail",
			"message": fmt.Sprintf("unrecognized card type: %q", result.Type),
		})
	}
}
