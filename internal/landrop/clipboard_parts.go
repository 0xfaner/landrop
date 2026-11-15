package landrop

import (
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"
)

const (
	mixedClipboardType = "application/json"
	maxClipboardImages = 64
	maxClipboardParts  = 2*maxClipboardImages + 1
)

type clipboardImage struct {
	Type string `json:"type"`
	Name string `json:"name"`
	file string
}

type clipboardPart struct {
	Text  string          `json:"text,omitempty"`
	Image *clipboardImage `json:"image,omitempty"`
}

func (c *clipboardStore) removePartImages(parts []clipboardPart) {
	for _, part := range parts {
		if part.Image != nil {
			_ = c.root.Remove(part.Image.file)
		}
	}
}

func (s *service) addClipboardParts(w http.ResponseWriter, r *http.Request, boundary string) {
	if !s.beginClipboardUpload(w) {
		return
	}
	defer func() { <-s.uploadSlots }()
	body := http.MaxBytesReader(w, r.Body, maxClipboardImageBytes+maxTextBytes+maxClipboardParts*(8<<10))
	reader := multipart.NewReader(body, boundary)
	entry := clipboardEntry{Type: mixedClipboardType}
	committed := false
	defer func() {
		if !committed {
			s.clipboard.removePartImages(entry.parts)
		}
	}()
	var textBytes int64
	var imageBytes int64
	var preview string
	images := 0
	for count := 0; ; count++ {
		part, err := reader.NextRawPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			failClipboardParts(w, err)
			return
		}
		if count == maxClipboardParts {
			fail(w, http.StatusBadRequest, "A clipboard entry has too many sections.")
			return
		}
		switch part.FormName() {
		case "text":
			content, err := io.ReadAll(io.LimitReader(part, maxTextBytes-textBytes+1))
			if err != nil {
				failClipboardParts(w, err)
				return
			}
			textBytes += int64(len(content))
			if textBytes > maxTextBytes {
				fail(w, http.StatusRequestEntityTooLarge, "Text exceeds 256 KiB.")
				return
			}
			if !utf8.Valid(content) {
				fail(w, http.StatusBadRequest, "Text must be encoded as UTF-8.")
				return
			}
			if len(content) != 0 {
				text := string(content)
				entry.parts = append(entry.parts, clipboardPart{Text: text})
				if preview == "" {
					preview = strings.TrimSpace(text)
				}
			}
		case "image":
			if images == maxClipboardImages {
				fail(w, http.StatusBadRequest, "A clipboard entry can include up to 64 images.")
				return
			}
			image, size, ok := s.storeClipboardImage(w, part, part.FileName(), maxClipboardImageBytes-imageBytes)
			if !ok {
				return
			}
			if images == 0 {
				index := len(entry.parts)
				entry.Thumb = &index
			}
			entry.parts = append(entry.parts, clipboardPart{Image: image})
			imageBytes += size
			images++
		default:
			failClipboardParts(w, nil)
			return
		}
	}
	if images == 0 {
		failClipboardParts(w, nil)
		return
	}
	entry.setPreview(preview)
	s.clipboard.add(entry)
	committed = true
	s.clipboardChanged(w)
}

func failClipboardParts(w http.ResponseWriter, err error) {
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		fail(w, http.StatusRequestEntityTooLarge, "Clipboard entry is too large.")
		return
	}
	fail(w, http.StatusBadRequest, "Could not read the clipboard entry.")
}

func (s *service) getClipboardPartImage(w http.ResponseWriter, r *http.Request) {
	part, err := strconv.Atoi(r.PathValue("part"))
	if err != nil || part < 0 {
		fail(w, http.StatusNotFound, "Clipboard entry no longer exists.")
		return
	}
	c := &s.clipboard
	c.mu.RLock()
	index := clipboardIndex(c.entries, r.PathValue("id"))
	if index < 0 || part >= len(c.entries[index].parts) || c.entries[index].parts[part].Image == nil {
		c.mu.RUnlock()
		fail(w, http.StatusNotFound, "Clipboard entry no longer exists.")
		return
	}
	image := c.entries[index].parts[part].Image
	file, err := c.root.Open(image.file)
	c.mu.RUnlock()
	if err != nil {
		fail(w, http.StatusInternalServerError, "Could not read the image.")
		return
	}
	serveClipboardImage(w, r, file, image.Type, image.Name)
}
