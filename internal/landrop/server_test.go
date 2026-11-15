package landrop

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestApprovalAndRevocation(t *testing.T) {
	s := &service{
		adminToken:   "test-admin",
		maxFileBytes: 1 << 20,
		pairs:        pairing{devices: make(map[string]*device)},
		logger:       log.New(io.Discard, "", 0),
	}
	host := s.handler("12345", true)
	guest := s.handler("8765", false)
	call := func(h http.Handler, port, method, path, token, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, "http://127.0.0.1:"+port+api+path, strings.NewReader(body))
		req.Header.Set("X-LanDrop", "1")
		req.Header.Set("Authorization", "Bearer "+token)
		result := httptest.NewRecorder()
		h.ServeHTTP(result, req)
		return result
	}
	checkSessionCookie := func(h http.Handler, port string, res *httptest.ResponseRecorder, want sessionInfo) {
		t.Helper()
		cookies := res.Result().Cookies()
		if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
			t.Fatalf("unexpected session cookie attributes")
		}
		req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:"+port+api+"/session", nil)
		req.AddCookie(cookies[0])
		current := httptest.NewRecorder()
		h.ServeHTTP(current, req)
		var session sessionInfo
		if err := json.Unmarshal(current.Body.Bytes(), &session); err != nil || session != want {
			t.Fatalf("session from cookie: %+v, %v, want %+v", session, err, want)
		}
	}
	denied := call(host, "12345", "POST", "/admin/login", "wrong", "")
	if denied.Code != http.StatusUnauthorized || len(denied.Result().Cookies()) != 0 {
		t.Fatalf("invalid host credentials accepted: %d", denied.Code)
	}
	login := call(host, "12345", "POST", "/admin/login", s.adminToken, "")
	wantHost := sessionInfo{Host: true, Authorized: true, MaxFileBytes: 1 << 20}
	var hostSession sessionInfo
	if err := json.Unmarshal(login.Body.Bytes(), &hostSession); err != nil || login.Code != http.StatusOK || hostSession != wantHost {
		t.Fatalf("host login: %d %s (%v)", login.Code, login.Body, err)
	}
	checkSessionCookie(host, "12345", login, wantHost)

	start := call(guest, "8765", "POST", "/pair", "", `{"name":"test"}`)
	if start.Code != 201 {
		t.Fatalf("pairing request: %d %s", start.Code, start.Body)
	}
	var pending struct{ Token, Code string }
	if err := json.Unmarshal(start.Body.Bytes(), &pending); err != nil {
		t.Fatal(err)
	}
	approve := "/admin/devices/" + pending.Code + "/approve"
	var approval struct {
		Status  string
		Session *sessionInfo
	}
	waiting := call(guest, "8765", "POST", "/pair/status", pending.Token, "")
	if err := json.Unmarshal(waiting.Body.Bytes(), &approval); err != nil || approval.Status != "pending" ||
		approval.Session != nil || len(waiting.Result().Cookies()) != 0 {
		t.Fatalf("pending response: %d %s (%v)", waiting.Code, waiting.Body, err)
	}
	if result := call(guest, "8765", "PUT", "/clip", pending.Token, "hello"); result.Code != 401 {
		t.Fatalf("unapproved access: got %d", result.Code)
	}
	if result := call(host, "12345", "POST", approve, pending.Token, ""); result.Code != 401 {
		t.Fatalf("guest approval: got %d", result.Code)
	}
	if result := call(host, "12345", "POST", approve, s.adminToken, ""); result.Code != 204 {
		t.Fatalf("host approval: got %d", result.Code)
	}
	status := call(guest, "8765", "POST", "/pair/status", pending.Token, "")
	wantGuest := sessionInfo{Authorized: true, MaxFileBytes: 1 << 20, DeviceName: "test"}
	if err := json.Unmarshal(status.Body.Bytes(), &approval); err != nil || status.Code != http.StatusOK ||
		approval.Status != "approved" || approval.Session == nil || *approval.Session != wantGuest {
		t.Fatalf("approval status: %d %s (%v)", status.Code, status.Body, err)
	}
	checkSessionCookie(guest, "8765", status, wantGuest)
	if result := call(guest, "8765", "PUT", "/clip", pending.Token, "hello"); result.Code != 204 {
		t.Fatalf("publish: got %d", result.Code)
	}
	if result := call(host, "12345", "GET", "/clip", s.adminToken, ""); result.Body.String() != "hello" {
		t.Fatalf("read: got %q", result.Body.String())
	}
	if result := call(host, "12345", "POST", "/admin/devices/"+pending.Code+"/remove", s.adminToken, ""); result.Code != 204 {
		t.Fatalf("remove: got %d", result.Code)
	}
	if result := call(guest, "8765", "GET", "/clip", pending.Token, ""); result.Code != 401 {
		t.Fatalf("revoked access: got %d", result.Code)
	}
	current := call(guest, "8765", "GET", "/session", pending.Token, "")
	var revoked sessionInfo
	if err := json.Unmarshal(current.Body.Bytes(), &revoked); err != nil || revoked.Authorized || revoked.DeviceName != "" {
		t.Fatalf("revoked session: %d %s (%v)", current.Code, current.Body, err)
	}
}

func TestPairingLimitsPendingRequestsPerIP(t *testing.T) {
	s := &service{
		pairs:  pairing{devices: make(map[string]*device)},
		logger: log.New(io.Discard, "", 0),
	}
	guest := s.handler("8765", false)
	request := func(remoteAddr string, wantStatus int) (code, token string) {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8765"+api+"/pair", strings.NewReader(`{"name":"test"}`))
		req.RemoteAddr = remoteAddr
		req.Header.Set("X-LanDrop", "1")
		res := httptest.NewRecorder()
		guest.ServeHTTP(res, req)
		if res.Code != wantStatus {
			t.Fatalf("pairing request from %s: got %d, want %d: %s", remoteAddr, res.Code, wantStatus, res.Body)
		}
		if wantStatus != http.StatusCreated {
			return "", ""
		}
		var pair struct{ Code, Token string }
		if err := json.Unmarshal(res.Body.Bytes(), &pair); err != nil || pair.Code == "" || pair.Token == "" {
			t.Fatalf("invalid pairing response: %s (%v)", res.Body, err)
		}
		return pair.Code, pair.Token
	}

	firstCode, firstToken := request("192.0.2.1:10001", http.StatusCreated)
	secondCode, secondToken := request("192.0.2.1:10002", http.StatusCreated)
	request("192.0.2.1:10003", http.StatusTooManyRequests)
	request("192.0.2.2:10001", http.StatusCreated)
	if !s.pairs.decide(firstCode, "approve") || s.pairs.lookup(firstToken).Status != "approved" {
		t.Fatal("the first request could not be approved after reaching the limit")
	}
	_, expiringToken := request("192.0.2.1:10003", http.StatusCreated)
	if !s.pairs.decide(secondCode, "reject") || s.pairs.lookup(secondToken).Status != "rejected" {
		t.Fatal("the second request could not be rejected after reaching the limit")
	}
	request("192.0.2.1:10004", http.StatusCreated)
	request("192.0.2.1:10005", http.StatusTooManyRequests)

	s.pairs.devices[expiringToken].expires = time.Now().Add(-time.Second)
	request("192.0.2.1:10005", http.StatusCreated)
}

func TestUploadPublishesOnlyCompleteFiles(t *testing.T) {
	dir := t.TempDir()
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	s := &service{
		files:        fileStore{root: root},
		maxFileBytes: 5,
		uploadSlots:  make(chan struct{}, 8),
		logger:       log.New(io.Discard, "", 0),
	}
	req := httptest.NewRequest("POST", "/files?name=big.txt", bytes.NewReader([]byte("123456")))
	req.ContentLength = -1 // Exercise the streamed size limit.
	result := httptest.NewRecorder()
	s.upload(result, req)
	if result.Code != 413 {
		t.Fatalf("oversized upload: got %d", result.Code)
	}
	if entries, err := os.ReadDir(dir); err != nil || len(entries) != 0 {
		t.Fatalf("incomplete upload left files: %v, %v", entries, err)
	}

	var wg sync.WaitGroup
	for i := range 6 {
		wg.Go(func() {
			_, _, err := s.files.save("sample.txt", strings.NewReader(fmt.Sprint(i)), 1)
			if err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	items, err := s.files.listFolder("")
	if err != nil || len(items) != 6 {
		t.Fatalf("same-name uploads: %v, %v", items, err)
	}
	contents := make(map[string]bool)
	for _, item := range items {
		content, err := os.ReadFile(filepath.Join(dir, item.Name))
		if err != nil {
			t.Fatal(err)
		}
		contents[string(content)] = true
	}
	if len(contents) != 6 {
		t.Fatalf("uploads overwrote contents: %v", contents)
	}
}

func TestGuestFileManagementIsScopedToTheShare(t *testing.T) {
	share := t.TempDir()
	root, err := os.OpenRoot(share)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	s := &service{
		files: fileStore{root: root}, pairs: pairing{devices: map[string]*device{"guest-token": {Status: "approved"}}},
		maxFileBytes: 1024, uploadSlots: make(chan struct{}, 1), logger: log.New(io.Discard, "", 0),
	}
	handler := s.handler("8765", false)
	call := func(method, route, token, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, "http://127.0.0.1:8765"+api+route, strings.NewReader(body))
		req.Header.Set("X-LanDrop", "1")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != want {
			t.Fatalf("%s %s: got %d, want %d: %s", method, route, res.Code, want, res.Body)
		}
		return res
	}
	entry := func(name string) string {
		return "/files/" + base64.RawURLEncoding.EncodeToString([]byte(name))
	}
	const token = "guest-token"
	call("POST", "/folders?path=docs", "", "", 401)
	call("POST", "/folders?path=docs", token, "", 204)
	call("POST", "/files?name=docs%2Fsub%2Fsample.txt", token, "sample", 201)
	call("POST", "/files?name=existing.txt", token, "existing", 201)
	call("PATCH", entry("docs/sub/sample.txt")+"?path=existing.txt", token, "", 409)
	call("PATCH", entry("docs/sub/sample.txt")+"?path=docs%2Frenamed.txt", token, "", 204)
	res := call("GET", "/files?dir=docs", token, "", 200)
	var items []fileItem
	if err := json.Unmarshal(res.Body.Bytes(), &items); err != nil || len(items) != 2 || !items[0].Directory || items[1].Path != "docs/renamed.txt" {
		t.Fatalf("nested listing: %+v, %v", items, err)
	}
	if res := call("GET", entry("docs/renamed.txt"), token, "", 200); res.Body.String() != "sample" {
		t.Fatalf("download: %q", res.Body)
	}
	call("DELETE", entry("docs")+"?recursive=1", "", "", 401)
	call("DELETE", entry("docs"), token, "", 409)
	call("PATCH", entry("docs")+"?path=docs%2Fsub%2Fdocs", token, "", 400)
	for _, bad := range []string{"../outside", "docs/../existing.txt", "/tmp/example", "C:/Windows", "docs\\existing.txt", "docs/.landrop-upload-hidden", "docs/NUL.txt"} {
		query := url.QueryEscape(bad)
		call("POST", "/files?name="+query, token, "sample", 400)
		call("POST", "/folders?path="+query, token, "", 400)
		call("PATCH", entry("existing.txt")+"?path="+query, token, "", 400)
		call("DELETE", entry(bad)+"?recursive=1", token, "", 400)
	}
	call("DELETE", entry(".")+"?recursive=1", token, "", 400)
	call("DELETE", entry("docs")+"?recursive=1", token, "", 204)
	call("GET", entry("existing.txt"), token, "", 200)
}

func TestFileChangesRejectReplacedEntries(t *testing.T) {
	dir := t.TempDir()
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	s := &service{
		files:  fileStore{root: root},
		pairs:  pairing{devices: map[string]*device{"guest-token": {Status: "approved"}}},
		logger: log.New(io.Discard, "", 0),
	}
	handler := s.handler("8765", false)
	call := func(method, route, version string, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, "http://127.0.0.1:8765"+api+route, nil)
		req.Header.Set("X-LanDrop", "1")
		req.Header.Set("Authorization", "Bearer guest-token")
		if version != "" {
			req.Header.Set("If-Match", `"`+version+`"`)
		}
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != want {
			t.Fatalf("%s %s: got %d, want %d: %s", method, route, res.Code, want, res.Body)
		}
		return res
	}
	list := func() fileItem {
		t.Helper()
		res := call("GET", "/files", "", 200)
		var items []fileItem
		if err := json.Unmarshal(res.Body.Bytes(), &items); err != nil || len(items) != 1 || items[0].Version == "" {
			t.Fatalf("expected one versioned entry: %s (%v)", res.Body, err)
		}
		return items[0]
	}
	write := func(name, contents string) {
		t.Helper()
		if err := root.WriteFile(name, []byte(contents), 0600); err != nil {
			t.Fatal(err)
		}
		ts := time.Unix(1700000000, 0)
		if err := os.Chtimes(filepath.Join(dir, name), ts, ts); err != nil {
			t.Fatal(err)
		}
	}

	write("report.txt", "old")
	old := list()
	route := "/files/" + old.ID
	if err := root.Rename("report.txt", stagingPrefix+"original"); err != nil {
		t.Fatal(err)
	}
	call("DELETE", route, old.Version, 412)

	write("report.txt", "new")
	current := list()
	if current.ID != old.ID || current.Size != old.Size || !current.Modified.Equal(old.Modified) || current.Version == old.Version {
		t.Fatalf("expected a different version at the same path and with the same size and time: old=%+v current=%+v", old, current)
	}
	call("DELETE", route, old.Version, 412)
	call("PATCH", route+"?path=moved.txt", old.Version, 412)
	if body := call("GET", route, "", 200).Body.String(); body != "new" {
		t.Fatalf("replacement changed: got %q", body)
	}
	call("PATCH", route+"?path=moved.txt", current.Version, 204)
	moved := list()
	call("DELETE", "/files/"+moved.ID, moved.Version, 204)
}

func TestSharedFileOperationsDoNotFollowSymlinks(t *testing.T) {
	share := t.TempDir()
	outside := t.TempDir()
	sentinel := filepath.Join(outside, "sentinel.txt")
	if err := os.WriteFile(sentinel, []byte("outside"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(share, "folder"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(share, "folder", "link")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	root, err := os.OpenRoot(share)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	store := &fileStore{root: root}
	id := base64.RawURLEncoding.EncodeToString
	if _, err := store.listFolder("folder/link"); err == nil {
		t.Fatal("listed a linked folder")
	}
	if file, _, err := store.open(id([]byte("folder/link/sentinel.txt"))); err == nil {
		file.Close()
		t.Fatal("opened a file through a link")
	}
	if _, _, err := store.save("folder/link/new.txt", strings.NewReader("new"), 3); err == nil {
		t.Fatal("uploaded through a link")
	}
	if err := store.remove(id([]byte("folder/link/sentinel.txt")), false, ""); err == nil {
		t.Fatal("deleted through a link")
	}
	if err := store.remove(id([]byte("folder")), true, ""); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(sentinel); err != nil || string(data) != "outside" {
		t.Fatalf("recursive deletion escaped the share: %q, %v", data, err)
	}
}

func TestEventHubCoalescesChangesWithoutDroppingOtherUpdates(t *testing.T) {
	var hub eventHub
	sub := hub.subscribe()
	defer hub.unsubscribe(sub)
	hub.filesChanged("photos/day/image.jpg")
	hub.filesChanged("photos/day/image.jpg")
	hub.filesChanged("photos/day/other.jpg")
	hub.publish(changes{Clipboard: true, Devices: true})
	<-sub.ready
	update := hub.take(sub)
	if !slices.Equal(update.Folders, []string{"photos/day"}) || !update.Clipboard || !update.Devices {
		t.Fatalf("unexpected combined update: %+v", update)
	}

	for i := range 130 {
		hub.filesChanged(fmt.Sprintf("folder-%d/file.txt", i))
	}
	hub.publish(changes{Clipboard: true})
	<-sub.ready
	update = hub.take(sub)
	if !update.AllFiles || len(update.Folders) != 0 || !update.Clipboard {
		t.Fatalf("expected a full file refresh and clipboard update after overflow: %+v", update)
	}
}

func TestCleanupUploadStagingRemovesOnlyGeneratedFilesAtShareRoot(t *testing.T) {
	dir := t.TempDir()
	stale := stagingPrefix + strings.Repeat("a", 26)
	ordinary := []string{"finished.bin", stagingPrefix + "notes.txt", stagingPrefix + strings.Repeat("0", 26)}
	for _, name := range append(ordinary, stale) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("keep or clean"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	folder := stagingPrefix + strings.Repeat("b", 26)
	if err := os.Mkdir(filepath.Join(dir, folder), 0700); err != nil {
		t.Fatal(err)
	}
	nested := filepath.Join(folder, stale)
	if err := os.WriteFile(filepath.Join(dir, nested), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	link := stagingPrefix + strings.Repeat("c", 26)
	if err := os.Symlink(filepath.Join(dir, ordinary[0]), filepath.Join(dir, link)); err == nil {
		ordinary = append(ordinary, link)
	}
	ordinary = append(ordinary, folder, nested)

	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if removed, err := cleanupUploadStaging(root); err != nil || removed != 1 {
		t.Fatalf("cleanup removed %d files, error: %v", removed, err)
	}
	if _, err := root.Lstat(stale); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("temporary file still present: %v", err)
	}
	for _, name := range ordinary {
		if _, err := root.Lstat(name); err != nil {
			t.Errorf("cleanup touched %q: %v", name, err)
		}
	}
	if removed, err := cleanupUploadStaging(root); err != nil || removed != 0 {
		t.Fatalf("second cleanup removed %d files, error: %v", removed, err)
	}
}

func TestUploadNotifiesOnlyChangedDirectories(t *testing.T) {
	root, err := os.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	s := &service{
		files:       fileStore{root: root},
		uploadSlots: make(chan struct{}, 1),
		logger:      log.New(io.Discard, "", 0),
	}
	sub := s.updates.subscribe()
	defer s.updates.unsubscribe(sub)
	upload := func(name string, want []string) {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/files?name="+url.QueryEscape(name), strings.NewReader("file"))
		res := httptest.NewRecorder()
		s.upload(res, req)
		if res.Code != http.StatusCreated {
			t.Fatalf("upload %q: %d %s", name, res.Code, res.Body)
		}
		update := s.updates.take(sub)
		if !slices.Equal(update.Folders, want) {
			t.Fatalf("upload %q notified %v, want %v", name, update.Folders, want)
		}
	}
	upload("photos/day/first.txt", []string{"", "photos", "photos/day"})
	upload("photos/day/second.txt", []string{"photos/day"})
}
