package elo

import (
	"encoding/json"
	"sync"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

// Hub is the single in-process SSE fan-out point. Every realtime stream in the
// service (markets, Skull King tables, global data-change signals, per-user
// events) subscribes to a topic here; producers broadcast marshalled SSEEvent
// payloads to a topic. In-process only (no Redis pub/sub), so it fans out only
// within a single backend instance — the deployment runs one instance per
// environment; Postgres LISTEN/NOTIFY is the escape hatch if that ever changes.
type Hub struct {
	mu          sync.RWMutex
	subscribers map[string]map[chan []byte]struct{} // topic → set of channels
}

func NewHub() *Hub {
	return &Hub{
		subscribers: make(map[string]map[chan []byte]struct{}),
	}
}

// SSEEvent is the wire envelope for every SSE frame: {"type":"...","data":...}.
// SSE frames bypass the JSON DTO layer, so producers building Data payloads
// must apply the Base58 wire encoding themselves (ADR-12).
type SSEEvent struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

// Topic constants for the non-entity streams. Entity streams append the
// canonical UUID to a prefix below.
const (
	TopicLobbyMarkets   = "lobby:markets"   // markets-list change signals
	TopicLobbySkullKing = "lobby:skull-king" // table-list change signals
	TopicData           = "data"             // global matches/players change signals
)

func MarketTopic(marketID id.ID) string        { return "market:" + string(marketID) }
func SkullKingTableTopic(tableID id.ID) string { return "skull-king-table:" + string(tableID) }
func UserTopic(userID id.ID) string            { return "user:" + string(userID) }

// Subscribe registers a buffered channel for the given topic.
// The caller MUST invoke cancel() (typically via defer) when the connection closes.
func (h *Hub) Subscribe(topic string) (<-chan []byte, func()) {
	ch := make(chan []byte, 8)
	h.mu.Lock()
	if h.subscribers[topic] == nil {
		h.subscribers[topic] = make(map[chan []byte]struct{})
	}
	h.subscribers[topic][ch] = struct{}{}
	h.mu.Unlock()

	cancel := func() {
		h.mu.Lock()
		delete(h.subscribers[topic], ch)
		if len(h.subscribers[topic]) == 0 {
			delete(h.subscribers, topic)
		}
		h.mu.Unlock()
		close(ch)
	}
	return ch, cancel
}

// Broadcast sends payload to all current subscribers of the topic.
// Slow subscribers are skipped (non-blocking send) — they resync on reconnect.
func (h *Hub) Broadcast(topic string, payload []byte) {
	h.mu.RLock()
	subs := h.subscribers[topic]
	h.mu.RUnlock()

	for ch := range subs {
		select {
		case ch <- payload:
		default:
		}
	}
}

// PublishSignal marshals a payload-less SSEEvent ({"type":"..."}) and
// broadcasts it — the shape every lobby/data stream uses, where clients
// refetch on each signal instead of consuming a payload.
func (h *Hub) PublishSignal(topic, eventType string) {
	payload, err := json.Marshal(SSEEvent{Type: eventType})
	if err != nil {
		return
	}
	h.Broadcast(topic, payload)
}
