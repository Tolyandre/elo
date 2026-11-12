//go:build js && wasm

// Command settlementwasm compiles the pure settlement core (pkg/settlement)
// to WebAssembly for the offline client (ADR-38): the browser runs the exact
// same settlement math as the server, so offline values cannot drift from the
// server's. The bridge is a single JSON-in/JSON-out function —
// eloSettlement.replayArena(inputJSON) returns the replay output as a JSON
// string, or an {"error": ...} object on failure. Build with GOOS=js
// GOARCH=wasm (make build-wasm) and load together with the Go wasm_exec.js
// runtime.
package main

import (
	"encoding/json"
	"syscall/js"

	"github.com/tolyandre/elo-web-service/pkg/settlement"
)

func main() {
	js.Global().Set("eloSettlement", map[string]any{
		"replayArena": js.FuncOf(replayArena),
	})
	// Keep the wasm module resident; the Go js/wasm runtime parks here.
	select {}
}

func replayArena(_ js.Value, args []js.Value) any {
	if len(args) != 1 {
		return errorJSON("replayArena expects one JSON string argument")
	}
	var input settlement.ReplayInput
	if err := json.Unmarshal([]byte(args[0].String()), &input); err != nil {
		return errorJSON("invalid replay input: " + err.Error())
	}
	out, err := settlement.ReplayArena(input)
	if err != nil {
		return errorJSON(err.Error())
	}
	data, err := json.Marshal(out)
	if err != nil {
		return errorJSON("marshal replay output: " + err.Error())
	}
	return string(data)
}

func errorJSON(msg string) string {
	data, _ := json.Marshal(map[string]string{"error": msg})
	return string(data)
}
