//go:build !opencv

package api

import "errors"

type noopRecognizer struct{}

func (n *noopRecognizer) Recognize(_ []byte) (CardRecognizeResult, error) {
	return CardRecognizeResult{}, errors.New("card recognition not available: build without opencv tag")
}

func newCardRecognizer() ICardRecognizer {
	return &noopRecognizer{}
}
