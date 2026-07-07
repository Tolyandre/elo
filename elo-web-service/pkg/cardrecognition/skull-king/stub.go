package skull_king

// Recognizer is an alias for the minimal implementation used when CGo cannot be built.
type Recognizer Rec

type Rec struct{}
	type CardResult struct{ Type string; Value *int }
	type SkullKingConfig struct{ ConfidenceThreshold float64 }

func DefaultConfig() interface{} { return &SkullKingConfig{} }

func NewRecognizer(cfg interface{}) (*Recognizer, error) {
    // The cfg argument is ignored.
    return &Recognizer{}, nil
}

func (r *Recognizer) Recognize([]byte) (CardResult, error) {
    return CardResult{Type: "stub", Value: nil}, nil
}

func (r *Recognizer) Close() {}
