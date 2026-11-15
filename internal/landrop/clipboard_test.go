package landrop

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/gif"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
)

func TestClipboardHistory(t *testing.T) {
	dir := t.TempDir()
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	s := &service{
		adminToken: "test-admin", clipboard: clipboardStore{root: root}, uploadSlots: make(chan struct{}, 1),
	}
	handler := s.handler("12345", true)
	call := func(method, path, contentType, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, "http://127.0.0.1:12345"+api+path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+s.adminToken)
		req.Header.Set("X-LanDrop", "1")
		req.Header.Set("Content-Type", contentType)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("%s %s: got %d, want %d (%s)", method, path, w.Code, want, w.Body)
		}
		return w
	}
	history := func() []clipboardEntry {
		t.Helper()
		w := call("GET", "/clipboard", "", "", http.StatusOK)
		var entries []clipboardEntry
		if err := json.Unmarshal(w.Body.Bytes(), &entries); err != nil || entries == nil {
			t.Fatalf("invalid history: %s (%v)", w.Body, err)
		}
		return entries
	}
	imageFiles := func(want int) {
		t.Helper()
		files, err := os.ReadDir(dir)
		if err != nil || len(files) != want {
			t.Fatalf("image files: got %d, want %d (%v)", len(files), want, err)
		}
	}

	var picture bytes.Buffer
	if err := png.Encode(&picture, image.NewRGBA(image.Rect(0, 0, 4, 4))); err != nil {
		t.Fatal(err)
	}
	call("POST", "/clipboard?name=screen.png", "image/png", "invalid image", http.StatusUnsupportedMediaType)
	imageFiles(0)
	call("POST", "/clipboard?name=screen.png", "image/png", picture.String(), http.StatusNoContent)

	text := strings.Repeat("界", clipboardPreviewRunes+1)
	call("POST", "/clipboard", "text/plain;charset=UTF-8", text, http.StatusNoContent)
	entries := history()
	if len(entries) != 2 || entries[0].Type != "text/plain" || !entries[0].HasMore ||
		entries[0].Preview != strings.Repeat("界", clipboardPreviewRunes) || entries[1].Name != "screen.png" {
		t.Fatalf("unexpected history: %+v", entries)
	}
	imagePath := "/clipboard/" + strconv.FormatUint(entries[1].ID, 10)
	textPath := "/clipboard/" + strconv.FormatUint(entries[0].ID, 10)
	download := call("GET", imagePath+"?download=1", "", "", http.StatusOK)
	if !bytes.Equal(download.Body.Bytes(), picture.Bytes()) || download.Header().Get("Content-Type") != "image/png" ||
		!strings.Contains(download.Header().Get("Content-Disposition"), "screen.png") {
		t.Fatal("image download changed the content or its filename")
	}

	w := call("GET", textPath, "", "", http.StatusOK)
	if w.Body.String() != text {
		t.Fatal("text preview truncated the original")
	}
	call("PATCH", textPath, "text/plain", "Edited text", http.StatusNoContent)
	w = call("GET", "/clip", "", "", http.StatusOK)
	if entries := history(); entries[0].HasMore || entries[0].Preview != "Edited text" || w.Body.String() != "Edited text" {
		t.Fatal("edit did not update history and the CLI")
	}
	call("PUT", "/clip", "", "", http.StatusNoContent)
	if entries := history(); len(entries) != 1 || entries[0].Type != "image/png" {
		t.Fatal("clearing text affected image history")
	}

	for i := range clipboardHistoryLimit {
		call("PUT", "/clip", "", strconv.Itoa(i), http.StatusNoContent)
	}
	entries = history()
	if len(entries) != clipboardHistoryLimit || entries[0].Preview != strconv.Itoa(clipboardHistoryLimit-1) {
		t.Fatal("history did not retain the latest entries")
	}
	imageFiles(0)
	call("GET", imagePath, "", "", http.StatusNotFound)
	call("DELETE", "/clipboard/"+strconv.FormatUint(entries[0].ID, 10), "", "", http.StatusNoContent)
	if len(history()) != clipboardHistoryLimit-1 {
		t.Fatal("entry deletion did not update history")
	}
	call("POST", "/clipboard?name=screen.png", "image/png", picture.String(), http.StatusNoContent)
	call("DELETE", "/clipboard", "", "", http.StatusNoContent)
	imageFiles(0)
	if len(history()) != 0 {
		t.Fatal("history was not cleared")
	}

	mixed := func(secondImage string) (string, string) {
		t.Helper()
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		for _, section := range []struct{ text, filename, image string }{
			{text: "First line\nSecond line"},
			{filename: "first.png", image: picture.String()},
			{text: "Between images"},
			{filename: "second.gif", image: secondImage},
			{text: "After images"},
		} {
			if section.filename == "" {
				if err := writer.WriteField("text", section.text); err != nil {
					t.Fatal(err)
				}
				continue
			}
			part, err := writer.CreateFormFile("image", section.filename)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := part.Write([]byte(section.image)); err != nil {
				t.Fatal(err)
			}
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		return writer.FormDataContentType(), body.String()
	}

	contentType, body := mixed("invalid image")
	call("POST", "/clipboard", contentType, body, http.StatusUnsupportedMediaType)
	imageFiles(0)
	if len(history()) != 0 {
		t.Fatal("partial upload was published")
	}

	palette := color.Palette{color.Black, color.White}
	firstFrame := image.NewPaletted(image.Rect(0, 0, 2, 2), palette)
	secondFrame := image.NewPaletted(firstFrame.Rect, palette)
	secondFrame.SetColorIndex(0, 0, 1)
	var animation bytes.Buffer
	if err := gif.EncodeAll(&animation, &gif.GIF{
		Image: []*image.Paletted{firstFrame, secondFrame}, Delay: []int{5, 5},
	}); err != nil {
		t.Fatal(err)
	}
	contentType, body = mixed(animation.String())
	call("POST", "/clipboard", contentType, body, http.StatusNoContent)
	imageFiles(2)
	entries = history()
	if len(entries) != 1 || entries[0].Type != mixedClipboardType ||
		entries[0].Thumb == nil || *entries[0].Thumb != 1 || entries[0].Preview != "First line\nSecond line" {
		t.Fatalf("unexpected mixed entry: %+v", entries)
	}
	mixedPath := "/clipboard/" + strconv.FormatUint(entries[0].ID, 10)
	w = call("GET", mixedPath, "", "", http.StatusOK)
	var parts []clipboardPart
	if err := json.Unmarshal(w.Body.Bytes(), &parts); err != nil || len(parts) != 5 ||
		parts[0].Text != "First line\nSecond line" || parts[1].Image == nil || parts[1].Image.Name != "first.png" ||
		parts[2].Text != "Between images" || parts[3].Image == nil || parts[3].Image.Name != "second.gif" ||
		parts[3].Image.Type != "image/gif" || parts[4].Text != "After images" {
		t.Fatalf("mixed entry lost its order: %s (%v)", w.Body, err)
	}
	call("GET", mixedPath+"/images/0", "", "", http.StatusNotFound)
	call("GET", mixedPath+"/images/5", "", "", http.StatusNotFound)
	download = call("GET", mixedPath+"/images/3?download=1", "", "", http.StatusOK)
	if !bytes.Equal(download.Body.Bytes(), animation.Bytes()) || download.Header().Get("Content-Type") != "image/gif" ||
		!strings.Contains(download.Header().Get("Content-Disposition"), "second.gif") {
		t.Fatal("GIF download changed the animation, media type, or filename")
	}
	call("PUT", "/clip", "", "", http.StatusNoContent)
	imageFiles(2)
	call("DELETE", mixedPath, "", "", http.StatusNoContent)
	imageFiles(0)
	call("GET", mixedPath+"/images/1", "", "", http.StatusNotFound)

	batch := func(count int, withText bool) (string, string) {
		t.Helper()
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		for i := range count {
			if withText {
				if err := writer.WriteField("text", strconv.Itoa(i)); err != nil {
					t.Fatal(err)
				}
			}
			part, err := writer.CreateFormFile("image", "screen.png")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := part.Write(picture.Bytes()); err != nil {
				t.Fatal(err)
			}
		}
		if withText {
			if err := writer.WriteField("text", "After images"); err != nil {
				t.Fatal(err)
			}
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		return writer.FormDataContentType(), body.String()
	}
	contentType, body = batch(65, false)
	call("POST", "/clipboard", contentType, body, http.StatusBadRequest)
	imageFiles(0)
	contentType, body = batch(64, true)
	call("POST", "/clipboard", contentType, body, http.StatusNoContent)
	imageFiles(64)
	entries = history()
	w = call("GET", "/clipboard/"+strconv.FormatUint(entries[0].ID, 10), "", "", http.StatusOK)
	if err := json.Unmarshal(w.Body.Bytes(), &parts); err != nil || len(parts) != 129 || parts[128].Text != "After images" {
		t.Fatalf("64-image upload lost its sections: got %d (%v)", len(parts), err)
	}
}
