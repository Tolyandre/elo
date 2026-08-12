package elo

import "sync"

// MarketsHub manages SSE subscriber channels per market, plus a lobby channel
// that signals markets-list changes. It mirrors SkullKingHub: in-process only
// (no Redis pub/sub), so it fans out only within a single backend instance —
// the same constraint the Skull King live game already has.
type MarketsHub struct {
	mu          sync.RWMutex
	subscribers map[string]map[chan []byte]struct{} // marketID (UUID string) → set of channels
	lobby       map[chan []byte]struct{}            // markets-list change signals
}

func NewMarketsHub() *MarketsHub {
	return &MarketsHub{
		subscribers: make(map[string]map[chan []byte]struct{}),
		lobby:       make(map[chan []byte]struct{}),
	}
}

// Subscribe registers a buffered channel for the given market.
// The caller MUST invoke cancel() (typically via defer) when the connection closes.
func (h *MarketsHub) Subscribe(marketID string) (ch chan []byte, cancel func()) {
	ch = make(chan []byte, 8)
	h.mu.Lock()
	if h.subscribers[marketID] == nil {
		h.subscribers[marketID] = make(map[chan []byte]struct{})
	}
	h.subscribers[marketID][ch] = struct{}{}
	h.mu.Unlock()

	cancel = func() {
		h.mu.Lock()
		delete(h.subscribers[marketID], ch)
		if len(h.subscribers[marketID]) == 0 {
			delete(h.subscribers, marketID)
		}
		h.mu.Unlock()
		close(ch)
	}
	return ch, cancel
}

// Broadcast sends payload to all current subscribers of marketID.
// Slow subscribers are skipped (non-blocking send) — they resync on reconnect.
func (h *MarketsHub) Broadcast(marketID string, payload []byte) {
	h.mu.RLock()
	subs := h.subscribers[marketID]
	h.mu.RUnlock()

	for ch := range subs {
		select {
		case ch <- payload:
		default:
		}
	}
}

// SubscribeLobby registers a buffered channel for markets-list change signals.
// The caller MUST invoke cancel() (typically via defer) when the connection closes.
func (h *MarketsHub) SubscribeLobby() (ch chan []byte, cancel func()) {
	ch = make(chan []byte, 8)
	h.mu.Lock()
	h.lobby[ch] = struct{}{}
	h.mu.Unlock()

	cancel = func() {
		h.mu.Lock()
		delete(h.lobby, ch)
		h.mu.Unlock()
		close(ch)
	}
	return ch, cancel
}

// BroadcastLobby sends payload to all current lobby subscribers.
// Slow subscribers are skipped (non-blocking send) — they resync on reconnect.
func (h *MarketsHub) BroadcastLobby(payload []byte) {
	h.mu.RLock()
	subs := make([]chan []byte, 0, len(h.lobby))
	for ch := range h.lobby {
		subs = append(subs, ch)
	}
	h.mu.RUnlock()

	for _, ch := range subs {
		select {
		case ch <- payload:
		default:
		}
	}
}
