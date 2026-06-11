package elo

import "sync"

// SkullKingHub manages SSE subscriber channels per table.
// Each subscriber receives the full serialised event payload.
type SkullKingHub struct {
	mu          sync.RWMutex
	subscribers map[string]map[chan []byte]struct{} // tableID (UUID string) → set of channels
	lobby       map[chan []byte]struct{}            // lobby subscribers (table-list change signals)
}

func NewSkullKingHub() *SkullKingHub {
	return &SkullKingHub{
		subscribers: make(map[string]map[chan []byte]struct{}),
		lobby:       make(map[chan []byte]struct{}),
	}
}

// Subscribe registers a buffered channel for the given table.
// The caller MUST invoke cancel() (typically via defer) when the connection closes.
func (h *SkullKingHub) Subscribe(tableID string) (ch chan []byte, cancel func()) {
	ch = make(chan []byte, 8)
	h.mu.Lock()
	if h.subscribers[tableID] == nil {
		h.subscribers[tableID] = make(map[chan []byte]struct{})
	}
	h.subscribers[tableID][ch] = struct{}{}
	h.mu.Unlock()

	cancel = func() {
		h.mu.Lock()
		delete(h.subscribers[tableID], ch)
		if len(h.subscribers[tableID]) == 0 {
			delete(h.subscribers, tableID)
		}
		h.mu.Unlock()
		close(ch)
	}
	return ch, cancel
}

// Broadcast sends payload to all current subscribers of tableID.
// Slow subscribers are skipped (non-blocking send) — they resync on reconnect.
func (h *SkullKingHub) Broadcast(tableID string, payload []byte) {
	h.mu.RLock()
	subs := h.subscribers[tableID]
	h.mu.RUnlock()

	for ch := range subs {
		select {
		case ch <- payload:
		default:
		}
	}
}

// SubscribeLobby registers a buffered channel for table-list change signals.
// The caller MUST invoke cancel() (typically via defer) when the connection closes.
func (h *SkullKingHub) SubscribeLobby() (ch chan []byte, cancel func()) {
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
func (h *SkullKingHub) BroadcastLobby(payload []byte) {
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
