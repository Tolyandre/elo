package api

import (
	"encoding/json"
	"fmt"

	"github.com/tolyandre/elo-web-service/pkg/calculator"
	"github.com/tolyandre/elo-web-service/pkg/elo"
)

// buildCalculatorInput validates the (kind, data) pair from an AddMatch request
// and returns the domain representation for storage. Returns a 400-bound error
// message when validation fails.
func buildCalculatorInput(kind string, data *map[string]interface{}) (*elo.CalculatorInput, error) {
	schema, err := calculator.Lookup(kind)
	if err != nil {
		return nil, fmt.Errorf("calculator_kind: %v", err)
	}
	raw, err := canonicalizeData(data)
	if err != nil {
		return nil, err
	}
	if err := calculator.Validate(kind, raw); err != nil {
		return nil, err
	}
	return &elo.CalculatorInput{
		Kind:    kind,
		Version: schema.CurrentVersion,
		Data:    raw,
	}, nil
}

// buildCalculatorUpdate translates the (kind, data) pair from an UpdateMatch
// request into a domain CalculatorUpdate:
//   - kind pointer non-nil, data present → replace with validated document
//   - kind pointer non-nil, data absent/null → clear the columns
//
// (An entirely-absent `calculator_kind` key never reaches here: the caller
// treats a nil pointer as "leave the existing columns untouched".)
func buildCalculatorUpdate(kind string, data *map[string]interface{}) (*elo.CalculatorUpdate, error) {
	if data == nil {
		// Explicit clear (calculator_kind was present and null, or data was null).
		return &elo.CalculatorUpdate{Kind: nil}, nil
	}
	schema, err := calculator.Lookup(kind)
	if err != nil {
		return nil, fmt.Errorf("calculator_kind: %v", err)
	}
	raw, err := canonicalizeData(data)
	if err != nil {
		return nil, err
	}
	if err := calculator.Validate(kind, raw); err != nil {
		return nil, err
	}
	kindCopy := kind
	return &elo.CalculatorUpdate{
		Kind:    &kindCopy,
		Version: schema.CurrentVersion,
		Data:    raw,
	}, nil
}

// canonicalizeData re-serializes the decoded JSON map into canonical bytes so
// the stored form (and the form validated by the JSON Schema) is stable
// regardless of map iteration order / float formatting quirks.
func canonicalizeData(data *map[string]interface{}) (json.RawMessage, error) {
	if data == nil {
		return nil, fmt.Errorf("calculator_data: required when calculator_kind is set")
	}
	raw, err := json.Marshal(*data)
	if err != nil {
		return nil, fmt.Errorf("calculator_data: %v", err)
	}
	return raw, nil
}
