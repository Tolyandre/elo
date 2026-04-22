package skullking

type RecognizerConfig struct {
	ConfidenceThreshold float64
}

func DefaultConfig() RecognizerConfig {
	return RecognizerConfig{ConfidenceThreshold: 0.75}
}
