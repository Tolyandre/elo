package api

// ICardRecognizer recognizes Skull King cards from raw image bytes.
type ICardRecognizer interface {
	Recognize(data []byte) (CardRecognizeResult, error)
}

// CardRecognizeResult holds the recognized card type and optional numeric value.
type CardRecognizeResult struct {
	Type  string
	Value *int
}
