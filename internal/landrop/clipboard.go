package landrop

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	clipboardHistoryLimit  = 20
	maxClipboardImageBytes = 256 << 20
	clipboardPreviewRunes  = 240
)

var clipboardImageExtensions = map[string]string{
	"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
}

type clipboardEntry struct {
	ID      uint64    `json:"id"`
	Type    string    `json:"type"`
	Created time.Time `json:"created"`
	Name    string    `json:"name,omitempty"`
	Preview string    `json:"preview,omitempty"`
	HasMore bool      `json:"hasMore,omitempty"`
	Thumb   *int      `json:"thumb,omitempty"`
	text    string
	file    string
	parts   []clipboardPart
}

type clipboardStore struct {
	mu      sync.RWMutex
	root    *os.Root
	nextID  uint64
	entries []clipboardEntry
}

func (c *clipboardStore) add(entry clipboardEntry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.nextID++
	entry.ID = c.nextID
	entry.Created = time.Now()
	if len(c.entries) == clipboardHistoryLimit {
		c.remove(len(c.entries) - 1)
	}
	c.entries = slices.Insert(c.entries, 0, entry)
}

// remove requires c.mu to be held for writing.
func (c *clipboardStore) remove(index int) {
	entry := c.entries[index]
	if file := entry.file; file != "" {
		_ = c.root.Remove(file)
	}
	c.removePartImages(entry.parts)
	c.entries = slices.Delete(c.entries, index, index+1)
}

func (s *service) registerClipboardRoutes(mux *http.ServeMux, admin bool) {
	mux.HandleFunc("GET "+api+"/clip", s.require(admin, s.getClip))
	mux.HandleFunc("PUT "+api+"/clip", s.require(admin, s.setClip))
	mux.HandleFunc("GET "+api+"/clipboard", s.require(admin, s.listClipboard))
	mux.HandleFunc("POST "+api+"/clipboard", s.require(admin, s.addClipboard))
	mux.HandleFunc("DELETE "+api+"/clipboard", s.require(admin, s.clearClipboard))
	mux.HandleFunc("GET "+api+"/clipboard/{id}", s.require(admin, s.getClipboardEntry))
	mux.HandleFunc("GET "+api+"/clipboard/{id}/images/{part}", s.require(admin, s.getClipboardPartImage))
	mux.HandleFunc("PATCH "+api+"/clipboard/{id}", s.require(admin, s.editClipboardEntry))
	mux.HandleFunc("DELETE "+api+"/clipboard/{id}", s.require(admin, s.deleteClipboardEntry))
}

func (s *service) listClipboard(w http.ResponseWriter, r *http.Request) {
	s.clipboard.mu.RLock()
	entries := append([]clipboardEntry{}, s.clipboard.entries...)
	s.clipboard.mu.RUnlock()
	sendJSON(w, http.StatusOK, entries)
}

func (s *service) clipboardChanged(w http.ResponseWriter) {
	s.updates.publish(changes{Clipboard: true})
	w.WriteHeader(http.StatusNoContent)
}

func (s *service) clearClipboard(w http.ResponseWriter, r *http.Request) {
	c := &s.clipboard
	c.mu.Lock()
	for len(c.entries) > 0 {
		c.remove(len(c.entries) - 1)
	}
	c.mu.Unlock()
	s.clipboardChanged(w)
}

func readClipboardText(w http.ResponseWriter, r *http.Request) (string, bool) {
	content, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxTextBytes))
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			fail(w, http.StatusRequestEntityTooLarge, "Text exceeds 256 KiB.")
		} else {
			fail(w, http.StatusBadRequest, "Could not read the text.")
		}
		return "", false
	}
	if !utf8.Valid(content) {
		fail(w, http.StatusBadRequest, "Text must be encoded as UTF-8.")
		return "", false
	}
	return string(content), true
}

func (entry *clipboardEntry) setText(text string) {
	entry.text = text
	entry.setPreview(text)
}

func (entry *clipboardEntry) setPreview(text string) {
	count := 0
	for offset := range text {
		if count == clipboardPreviewRunes {
			entry.Preview = text[:offset]
			entry.HasMore = true
			return
		}
		count++
	}
	entry.Preview = text
	entry.HasMore = false
}

func (s *service) addClipboard(w http.ResponseWriter, r *http.Request) {
	contentType, params, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	switch contentType {
	case "multipart/form-data":
		s.addClipboardParts(w, r, params["boundary"])
		return
	case "text/plain":
	default:
		s.addClipboardImage(w, r)
		return
	}
	text, ok := readClipboardText(w, r)
	if !ok {
		return
	}
	if text == "" {
		fail(w, http.StatusBadRequest, "Enter text to share.")
		return
	}
	entry := clipboardEntry{Type: "text/plain"}
	entry.setText(text)
	s.clipboard.add(entry)
	s.clipboardChanged(w)
}

func (s *service) addClipboardImage(w http.ResponseWriter, r *http.Request) {
	if r.ContentLength > maxClipboardImageBytes {
		fail(w, http.StatusRequestEntityTooLarge, "Images must be 256 MiB or smaller.")
		return
	}
	if !s.beginClipboardUpload(w) {
		return
	}
	defer func() { <-s.uploadSlots }()
	picture, _, ok := s.storeClipboardImage(w, r.Body, r.URL.Query().Get("name"), maxClipboardImageBytes)
	if !ok {
		return
	}
	s.clipboard.add(clipboardEntry{Type: picture.Type, Name: picture.Name, file: picture.file})
	s.clipboardChanged(w)
}

func (s *service) beginClipboardUpload(w http.ResponseWriter) bool {
	if s.clipboard.root == nil {
		fail(w, http.StatusInternalServerError, "Clipboard image storage is unavailable.")
		return false
	}
	return s.takeClipboardUploadSlot(w)
}

func (s *service) takeClipboardUploadSlot(w http.ResponseWriter) bool {
	select {
	case s.uploadSlots <- struct{}{}:
		return true
	default:
		fail(w, http.StatusServiceUnavailable, "Too many uploads in progress. Try again later.")
		return false
	}
}

func (s *service) storeClipboardImage(w http.ResponseWriter, body io.Reader, name string, limit int64) (*clipboardImage, int64, bool) {
	root := s.clipboard.root
	file, err := os.CreateTemp(root.Name(), "image-")
	if err != nil {
		fail(w, http.StatusInternalServerError, "Could not store the image.")
		return nil, 0, false
	}
	fileName := filepath.Base(file.Name())
	keep := false
	defer func() {
		if !keep {
			_ = root.Remove(fileName)
		}
	}()
	size, copyErr := io.Copy(file, io.LimitReader(body, limit+1))
	if size > limit {
		file.Close()
		fail(w, http.StatusRequestEntityTooLarge, "Images must total 256 MiB or less per entry.")
		return nil, 0, false
	}
	header := make([]byte, min(size, 512))
	_, readErr := file.ReadAt(header, 0)
	closeErr := file.Close()
	if copyErr != nil || readErr != nil || closeErr != nil {
		var tooBig *http.MaxBytesError
		if errors.As(copyErr, &tooBig) {
			fail(w, http.StatusRequestEntityTooLarge, "Images must total 256 MiB or less per entry.")
		} else {
			fail(w, http.StatusBadRequest, "Could not read or store the image.")
		}
		return nil, 0, false
	}
	contentType := http.DetectContentType(header)
	ext, supported := clipboardImageExtensions[contentType]
	if !supported {
		fail(w, http.StatusUnsupportedMediaType, "Choose a PNG, JPEG, WebP, or GIF image.")
		return nil, 0, false
	}
	name = clipboardImageName(name, ext)
	keep = true
	return &clipboardImage{Type: contentType, Name: name, file: fileName}, size, true
}

func clipboardImageName(name, ext string) string {
	name = path.Base(strings.ReplaceAll(name, "\\", "/"))
	if !validName(name) || strings.TrimSpace(name) == "" {
		name = "clipboard." + ext
	} else if suffix := strings.ToLower(path.Ext(name)); suffix != "."+ext && !(ext == "jpg" && suffix == ".jpeg") {
		name = strings.TrimSuffix(name, path.Ext(name)) + "." + ext
		if !validName(name) {
			name = "clipboard." + ext
		}
	}
	return name
}

func clipboardIndex(entries []clipboardEntry, rawID string) int {
	id, err := strconv.ParseUint(rawID, 10, 64)
	if err != nil {
		return -1
	}
	return slices.IndexFunc(entries, func(entry clipboardEntry) bool { return entry.ID == id })
}

func (s *service) getClipboardEntry(w http.ResponseWriter, r *http.Request) {
	c := &s.clipboard
	c.mu.RLock()
	index := clipboardIndex(c.entries, r.PathValue("id"))
	if index < 0 {
		c.mu.RUnlock()
		fail(w, http.StatusNotFound, "Clipboard entry no longer exists.")
		return
	}
	entry := c.entries[index]
	if entry.Type == mixedClipboardType {
		c.mu.RUnlock()
		sendJSON(w, http.StatusOK, entry.parts)
		return
	}
	var file *os.File
	var err error
	if entry.file != "" {
		file, err = c.root.Open(entry.file)
	}
	c.mu.RUnlock()
	if err != nil {
		fail(w, http.StatusInternalServerError, "Could not read the image.")
		return
	}
	if entry.file == "" {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = io.WriteString(w, entry.text)
		return
	}
	serveClipboardImage(w, r, file, entry.Type, entry.Name)
}

func serveClipboardImage(w http.ResponseWriter, r *http.Request, file *os.File, contentType, name string) {
	defer file.Close()
	if r.URL.Query().Get("download") == "1" {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	}
	w.Header().Set("Content-Type", contentType)
	http.ServeContent(w, r, name, time.Time{}, file)
}

func (s *service) editClipboardEntry(w http.ResponseWriter, r *http.Request) {
	text, ok := readClipboardText(w, r)
	if !ok {
		return
	}
	if text == "" {
		fail(w, http.StatusBadRequest, "Enter text to share.")
		return
	}
	c := &s.clipboard
	c.mu.Lock()
	index := clipboardIndex(c.entries, r.PathValue("id"))
	if index < 0 {
		c.mu.Unlock()
		fail(w, http.StatusNotFound, "Clipboard entry no longer exists.")
		return
	}
	if c.entries[index].Type != "text/plain" {
		c.mu.Unlock()
		fail(w, http.StatusBadRequest, "Only text entries can be edited.")
		return
	}
	c.entries[index].setText(text)
	c.mu.Unlock()
	s.clipboardChanged(w)
}

func (s *service) deleteClipboardEntry(w http.ResponseWriter, r *http.Request) {
	c := &s.clipboard
	c.mu.Lock()
	index := clipboardIndex(c.entries, r.PathValue("id"))
	if index < 0 {
		c.mu.Unlock()
		fail(w, http.StatusNotFound, "Clipboard entry no longer exists.")
		return
	}
	c.remove(index)
	c.mu.Unlock()
	s.clipboardChanged(w)
}

func (s *service) getClip(w http.ResponseWriter, r *http.Request) {
	c := &s.clipboard
	c.mu.RLock()
	var text string
	if index := slices.IndexFunc(c.entries, func(entry clipboardEntry) bool { return entry.Type == "text/plain" }); index >= 0 {
		text = c.entries[index].text
	}
	c.mu.RUnlock()
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = io.WriteString(w, text)
}

func (s *service) setClip(w http.ResponseWriter, r *http.Request) {
	text, ok := readClipboardText(w, r)
	if !ok {
		return
	}
	if text == "" {
		c := &s.clipboard
		c.mu.Lock()
		c.entries = slices.DeleteFunc(c.entries, func(entry clipboardEntry) bool { return entry.Type == "text/plain" })
		c.mu.Unlock()
		s.clipboardChanged(w)
		return
	}
	entry := clipboardEntry{Type: "text/plain"}
	entry.setText(text)
	s.clipboard.add(entry)
	s.clipboardChanged(w)
}
