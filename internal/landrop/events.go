package landrop

import (
	"encoding/json"
	"fmt"
	"net/http"
	"path"
	"slices"
	"sync"
	"time"
)

type changes struct {
	Folders   []string `json:"folders,omitempty"`
	AllFiles  bool     `json:"allFiles,omitempty"`
	Clipboard bool     `json:"clipboard,omitempty"`
	Devices   bool     `json:"devices,omitempty"`
}

type subscription struct {
	ready   chan struct{}
	pending changes
}

type eventHub struct {
	mu          sync.Mutex
	subscribers map[*subscription]struct{}
}

func (h *eventHub) subscribe() *subscription {
	sub := &subscription{ready: make(chan struct{}, 1)}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.subscribers == nil {
		h.subscribers = make(map[*subscription]struct{})
	}
	h.subscribers[sub] = struct{}{}
	return sub
}

func (h *eventHub) unsubscribe(sub *subscription) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.subscribers, sub)
}

func (h *eventHub) publish(change changes) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for sub := range h.subscribers {
		pending := &sub.pending
		pending.Clipboard = pending.Clipboard || change.Clipboard
		pending.Devices = pending.Devices || change.Devices
		if change.AllFiles {
			pending.Folders = nil
			pending.AllFiles = true
		}
		if !pending.AllFiles {
			for _, folder := range change.Folders {
				if !slices.Contains(pending.Folders, folder) {
					pending.Folders = append(pending.Folders, folder)
				}
				if len(pending.Folders) > 128 {
					pending.Folders = nil
					pending.AllFiles = true
					break
				}
			}
		}
		select {
		case sub.ready <- struct{}{}:
		default:
		}
	}
}

func (h *eventHub) take(sub *subscription) changes {
	h.mu.Lock()
	defer h.mu.Unlock()
	pending := sub.pending
	sub.pending = changes{}
	// A publication during the debounce window is already in this batch.
	select {
	case <-sub.ready:
	default:
	}
	return pending
}

func (h *eventHub) filesChanged(entries ...string) {
	if len(entries) == 0 {
		return
	}
	folders := make([]string, 0, len(entries))
	for _, entry := range entries {
		dir := path.Dir(entry)
		if dir == "." {
			dir = ""
		}
		folders = append(folders, dir)
	}
	h.publish(changes{Folders: folders})
}

func (s *service) events(w http.ResponseWriter, r *http.Request, admin bool) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+r.Host {
		fail(w, http.StatusForbidden, "Invalid request origin.")
		return
	}

	sub := s.updates.subscribe()
	defer s.updates.unsubscribe(sub)
	w.Header().Set("Content-Type", "text/event-stream")
	controller := http.NewResponseController(w)
	write := func(message string) bool {
		if err := controller.SetWriteDeadline(time.Now().Add(20 * time.Second)); err != nil {
			return false
		}
		if _, err := fmt.Fprint(w, message); err != nil {
			return false
		}
		return controller.Flush() == nil
	}
	if !write(": connected\n\n") {
		return
	}

	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			if !s.authorized(r, admin) {
				write("event: revoked\ndata: {}\n\n")
				return
			}
			if !write(": heartbeat\n\n") {
				return
			}
		case <-sub.ready:
			batch := time.NewTimer(100 * time.Millisecond)
			select {
			case <-r.Context().Done():
				batch.Stop()
				return
			case <-batch.C:
			}
			if !s.authorized(r, admin) {
				write("event: revoked\ndata: {}\n\n")
				return
			}
			change := s.updates.take(sub)
			change.Devices = change.Devices && admin
			if len(change.Folders) == 0 && !change.AllFiles && !change.Clipboard && !change.Devices {
				continue
			}
			data, err := json.Marshal(change)
			if err != nil || !write("data: "+string(data)+"\n\n") {
				return
			}
		}
	}
}
