package landrop

import (
	"errors"
	"fmt"
	"mime"
	"net/http"
	"os"
	"time"
)

func (s *service) registerFileRoutes(mux *http.ServeMux, admin bool) {
	mux.HandleFunc("GET "+api+"/files", s.require(admin, s.listFiles))
	mux.HandleFunc("POST "+api+"/files", s.require(admin, s.upload))
	mux.HandleFunc("GET "+api+"/files/{id}", s.require(admin, s.download))
	mux.HandleFunc("POST "+api+"/folders", s.require(admin, s.createFolder))
	mux.HandleFunc("PATCH "+api+"/files/{id}", s.require(admin, s.moveFile))
	mux.HandleFunc("DELETE "+api+"/files/{id}", s.require(admin, s.deleteFile))
}

func (s *service) listFiles(w http.ResponseWriter, r *http.Request) {
	items, err := s.files.listFolder(r.URL.Query().Get("dir"))
	if err != nil {
		s.fileError(w, err)
		return
	}
	sendJSON(w, http.StatusOK, items)
}

func (s *service) createFolder(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("path")
	s.finishFileChange(w, s.files.mkdir(target), target)
}

func (s *service) moveFile(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	source, _ := decodeID(id)
	target := r.URL.Query().Get("path")
	s.finishFileChange(w, s.files.move(id, target, r.Header.Get("If-Match")), source, target)
}

func (s *service) deleteFile(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	source, _ := decodeID(id)
	s.finishFileChange(w, s.files.remove(id, r.URL.Query().Get("recursive") == "1", r.Header.Get("If-Match")), source)
}

func (s *service) upload(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if !validPath(name) {
		fail(w, http.StatusBadRequest, "Invalid shared path.")
		return
	}
	if s.maxFileBytes > 0 && r.ContentLength > s.maxFileBytes {
		s.uploadTooLarge(w)
		return
	}
	select {
	case s.uploadSlots <- struct{}{}:
	default:
		wait := time.NewTimer(2 * time.Second)
		defer wait.Stop()
		select {
		case s.uploadSlots <- struct{}{}:
		case <-r.Context().Done():
			return
		case <-wait.C:
			fail(w, http.StatusServiceUnavailable, "Too many uploads in progress. Try again later.")
			return
		}
	}
	defer func() { <-s.uploadSlots }()
	body := r.Body
	if s.maxFileBytes > 0 {
		body = http.MaxBytesReader(w, body, s.maxFileBytes)
	}
	item, created, err := s.files.save(name, body, r.ContentLength)
	if err != nil {
		s.updates.filesChanged(created...)
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			s.uploadTooLarge(w)
			return
		}
		s.fileError(w, err)
		return
	}
	s.updates.filesChanged(append(created, item.Path)...)
	sendJSON(w, http.StatusCreated, item)
}

func (s *service) uploadTooLarge(w http.ResponseWriter) {
	limit := fmt.Sprintf("%d bytes", s.maxFileBytes)
	if s.maxFileBytes%(1<<20) == 0 {
		limit = fmt.Sprintf("%d MiB", s.maxFileBytes>>20)
	}
	fail(w, http.StatusRequestEntityTooLarge, fmt.Sprintf(
		"This host limits uploads to %s per file. To remove the limit, start the host with --max-file-mib 0.", limit))
}

func (s *service) finishFileChange(w http.ResponseWriter, err error, entries ...string) {
	if err == nil || errors.Is(err, errFileChanged) {
		s.updates.filesChanged(entries...)
	}
	if err != nil {
		s.fileError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *service) fileError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errInvalidPath):
		fail(w, http.StatusBadRequest, "Invalid shared path.")
	case errors.Is(err, errFileChanged):
		fail(w, http.StatusPreconditionFailed, "This file or folder changed. Select it again from the updated list.")
	case errors.Is(err, os.ErrNotExist):
		fail(w, http.StatusNotFound, "File or folder not found.")
	case errors.Is(err, os.ErrExist):
		fail(w, http.StatusConflict, "A file or folder already exists at that path.")
	case errors.Is(err, errFolderNotEmpty):
		fail(w, http.StatusConflict, "This folder is not empty. Confirm recursive deletion to remove its contents.")
	default:
		s.logger.Printf("Shared file operation failed: %v", err)
		fail(w, http.StatusInternalServerError, "The shared file operation failed.")
	}
}

func (s *service) download(w http.ResponseWriter, r *http.Request) {
	file, info, err := s.files.open(r.PathValue("id"))
	if err != nil {
		fail(w, http.StatusNotFound, "File not found.")
		return
	}
	defer file.Close()
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": info.Name()}))
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeContent(w, r, info.Name(), info.ModTime(), file)
}
