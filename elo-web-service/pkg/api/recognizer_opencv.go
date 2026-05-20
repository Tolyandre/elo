//go:build opencv

package api

import (
	"log"

	skullking "github.com/tolyandre/elo-web-service/pkg/cardrecognition/skull-king"
	cfg "github.com/tolyandre/elo-web-service/pkg/configuration"
)

type opencvRecognizer struct {
	r *skullking.Recognizer
}

func (o *opencvRecognizer) Recognize(data []byte) (CardRecognizeResult, error) {
	result, err := o.r.Recognize(data)
	if err != nil {
		return CardRecognizeResult{}, err
	}
	return CardRecognizeResult{Type: result.Type, Value: result.Value}, nil
}

func newCardRecognizer() ICardRecognizer {
	recognizerCfg := skullking.DefaultConfig()
	if cfg.Config.SkullKingConfidenceThreshold > 0 {
		recognizerCfg.ConfidenceThreshold = cfg.Config.SkullKingConfidenceThreshold
	}
	recognizer, err := skullking.NewRecognizer(recognizerCfg)
	if err != nil {
		log.Fatalf("failed to initialize card recognizer: %v", err)
	}
	return &opencvRecognizer{r: recognizer}
}
