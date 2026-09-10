package elo

import (
	"encoding/json"
	"sync"
	"testing"
	"time"
)

func TestHub_BroadcastReachesSubscriber(t *testing.T) {
	h := NewHub()
	ch, cancel := h.Subscribe(TopicData)
	defer cancel()

	h.Broadcast(TopicData, []byte(`{"type":"matches-changed"}`))

	select {
	case msg := <-ch:
		var evt SSEEvent
		if err := json.Unmarshal(msg, &evt); err != nil {
			t.Fatalf("payload not valid SSEEvent: %v", err)
		}
		if evt.Type != "matches-changed" {
			t.Errorf("type = %q, want matches-changed", evt.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("no message received")
	}
}

func TestHub_BroadcastIsTopicScoped(t *testing.T) {
	h := NewHub()
	dataCh, cancelData := h.Subscribe(TopicData)
	defer cancelData()
	otherCh, cancelOther := h.Subscribe(UserTopic("00000000-0000-0000-0000-000000000001"))
	defer cancelOther()

	h.Broadcast(UserTopic("00000000-0000-0000-0000-000000000001"), []byte(`{"type":"table-invite"}`))

	select {
	case msg := <-otherCh:
		if string(msg) != `{"type":"table-invite"}` {
			t.Errorf("user topic payload = %s", msg)
		}
	case <-time.After(time.Second):
		t.Fatal("no message on user topic")
	}
	select {
	case msg := <-dataCh:
		t.Errorf("data topic must not receive user events, got %s", msg)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestHub_CancelStopsDeliveryAndCleansUp(t *testing.T) {
	h := NewHub()
	ch, cancel := h.Subscribe(TopicLobbyMarkets)

	cancel()
	// Sending on the closed channel would panic if the hub still delivered.
	h.Broadcast(TopicLobbyMarkets, []byte(`{}`))

	h.mu.RLock()
	_, topicExists := h.subscribers[TopicLobbyMarkets]
	h.mu.RUnlock()
	if topicExists {
		t.Error("topic must be removed after the last subscriber cancels")
	}
	if _, open := <-ch; open {
		t.Error("channel must be closed after cancel")
	}
}

func TestHub_SlowSubscriberIsSkippedNotBlocked(t *testing.T) {
	h := NewHub()
	_, cancelFast := h.Subscribe(TopicData)
	defer cancelFast()
	// Slow subscriber: never drains its buffered channel.
	slowCh, cancelSlow := h.Subscribe(TopicData)
	defer cancelSlow()

	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 100; i++ {
			h.Broadcast(TopicData, []byte(`{"type":"players-changed"}`))
		}
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Broadcast blocked on a slow subscriber")
	}
	if len(slowCh) != 8 {
		t.Errorf("slow subscriber buffer = %d, want the cap of 8", len(slowCh))
	}
}

func TestHub_PublishSignal(t *testing.T) {
	h := NewHub()
	ch, cancel := h.Subscribe(TopicLobbyTables)
	defer cancel()

	h.PublishSignal(TopicLobbyTables, "tables-changed")

	select {
	case msg := <-ch:
		var evt SSEEvent
		if err := json.Unmarshal(msg, &evt); err != nil {
			t.Fatalf("payload not valid SSEEvent: %v", err)
		}
		if evt.Type != "tables-changed" {
			t.Errorf("type = %q, want tables-changed", evt.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("no message received")
	}
}

func TestHub_SubscribeManyFansInTaggedFrames(t *testing.T) {
	h := NewHub()
	ch, cancel := h.SubscribeMany(TopicData, TopicLobbyTables)
	defer cancel()

	h.PublishSignal(TopicData, "players-changed")
	h.PublishSignal(TopicLobbyTables, "tables-changed")

	got := map[string]string{}
	for range []int{0, 1} {
		select {
		case frame := <-ch:
			got[frame.Topic] = string(frame.Payload)
		case <-time.After(time.Second):
			t.Fatalf("missing frame; got %v", got)
		}
	}
	for topic, want := range map[string]string{
		TopicData:        "players-changed",
		TopicLobbyTables: "tables-changed",
	} {
		var evt SSEEvent
		if err := json.Unmarshal([]byte(got[topic]), &evt); err != nil {
			t.Errorf("%s payload not valid SSEEvent: %v", topic, err)
			continue
		}
		if evt.Type != want {
			t.Errorf("%s type = %q, want %q", topic, evt.Type, want)
		}
	}
}

func TestHub_SubscribeManyCancelStopsDeliveryAndCleansUp(t *testing.T) {
	h := NewHub()
	ch, cancel := h.SubscribeMany(TopicData, TopicLobbyMarkets)

	cancel()
	// Sending on the closed per-topic channels would panic if the hub still
	// delivered.
	h.Broadcast(TopicData, []byte(`{}`))
	h.Broadcast(TopicLobbyMarkets, []byte(`{}`))

	for topic := range map[string]bool{TopicData: true, TopicLobbyMarkets: true} {
		h.mu.RLock()
		_, topicExists := h.subscribers[topic]
		h.mu.RUnlock()
		if topicExists {
			t.Errorf("topic %q must be removed after cancel", topic)
		}
	}
	// The fanned-out channel is closed once the forwarders drain — the same
	// "cancel closes the channel" contract as Subscribe.
	if _, open := <-ch; open {
		t.Error("channel must be closed after cancel")
	}
}

// Regression for the broadcast-vs-cancel race: Broadcast used to iterate the
// subscriber map after releasing RLock while cancel() deleted and closed
// channels — a concurrent map iteration / send-on-closed-channel crash.
// Meaningful under `go test -race`.
func TestHub_ConcurrentBroadcastAndCancel(t *testing.T) {
	h := NewHub()

	const workers = 8
	var wg sync.WaitGroup
	wg.Add(2 * workers)

	for i := 0; i < workers; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < 500; j++ {
				_, cancel := h.Subscribe(TopicData)
				h.Broadcast(TopicData, []byte(`{"type":"matches-changed"}`))
				cancel()
			}
		}()
	}
	for i := 0; i < workers; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < 500; j++ {
				h.PublishSignal(TopicData, "players-changed")
				h.Broadcast(UserTopic("00000000-0000-0000-0000-000000000001"), []byte(`{}`))
			}
		}()
	}
	wg.Wait()
}
