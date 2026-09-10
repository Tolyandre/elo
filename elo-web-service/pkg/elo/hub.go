package elo

import (
	"encoding/json"
	"sync"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

// Hub is the single in-process SSE fan-out point. Every realtime stream in the
// service (markets, game tables, global data-change signals, per-user
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
	TopicLobbyMarkets = "lobby:markets" // markets-list change signals
	TopicLobbyTables  = "lobby:tables"  // game-table-list change signals
	TopicData         = "data"          // global matches/players change signals
)

func MarketTopic(marketID id.ID) string { return "market:" + string(marketID) }
func TableTopic(tableID id.ID) string   { return "table:" + string(tableID) }
func UserTopic(userID id.ID) string     { return "user:" + string(userID) }

// TaggedFrame pairs a broadcast payload with the topic it arrived on, so one
// multiplexed subscription can serve several topics at once.
type TaggedFrame struct {
	Topic   string
	Payload []byte
}

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
// The RLock is held for the whole iteration: cancel() deletes and closes
// channels under the write lock, so iterating without it races a concurrent
// unsubscribe (concurrent map iteration and map write, or a send on a closed
// channel — both fatal).
func (h *Hub) Broadcast(topic string, payload []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for ch := range h.subscribers[topic] {
		select {
		case ch <- payload:
		default:
		}
	}
}

// SubscribeMany subscribes to several topics at once and fans their frames
// into a single tagged channel — the multiplexed /events endpoint serves all
// app-global topics over one SSE connection this way.
//
// Slow-client semantics match Subscribe: each per-topic channel drops when the
// subscriber stalls (Broadcast is non-blocking), so a stalled client only ever
// loses events, never blocks producers. The caller MUST invoke cancel().
func (h *Hub) SubscribeMany(topics ...string) (<-chan TaggedFrame, func()) {
	out := make(chan TaggedFrame, 8)
	cancels := make([]func(), 0, len(topics))
	done := make(chan struct{})
	var forwarders sync.WaitGroup

	for _, topic := range topics {
		ch, cancel := h.Subscribe(topic)
		cancels = append(cancels, cancel)
		forwarders.Add(1)
		go func(topic string, ch <-chan []byte) {
			defer forwarders.Done()
			for payload := range ch {
				select {
				case out <- TaggedFrame{Topic: topic, Payload: payload}:
				case <-done:
					return
				}
			}
		}(topic, ch)
	}

	cancel := func() {
		close(done)
		for _, c := range cancels {
			c()
		}
		forwarders.Wait()
		close(out)
	}
	return out, cancel
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
