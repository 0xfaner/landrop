package landrop

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/netip"
	"strings"

	qrcode "github.com/skip2/go-qrcode"
	"landrop/web"
)

const (
	api                  = "/api/v1"
	maxTextBytes         = 256 << 10
	maxConcurrentUploads = 8
	guestCookie          = "landrop_guest"
	hostCookie           = "landrop_host"
)

type service struct {
	files        fileStore
	pairs        pairing
	adminToken   string
	addresses    []string
	maxFileBytes int64
	logger       *log.Logger
	clipboard    clipboardStore
	uploadSlots  chan struct{}
	updates      eventHub
}

func sendJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func fail(w http.ResponseWriter, status int, message string) {
	sendJSON(w, status, map[string]string{"error": message})
}

func bearer(r *http.Request) string {
	token, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	return token
}

func cookieName(r *http.Request, base string) string {
	_, port, _ := net.SplitHostPort(r.Host)
	return base + "_" + port
}

func credential(r *http.Request, name string) string {
	if r.Header.Get("Authorization") != "" {
		return bearer(r)
	}
	if c, err := r.Cookie(cookieName(r, name)); err == nil {
		return c.Value
	}
	return ""
}

func sessionCookie(w http.ResponseWriter, name, value string) {
	http.SetCookie(w, &http.Cookie{
		Name: name, Value: value, Path: api, HttpOnly: true, SameSite: http.SameSiteStrictMode,
	})
}

func peerIP(addr string) string {
	host, _, _ := net.SplitHostPort(addr)
	return host
}

type sessionInfo struct {
	Host         bool   `json:"host"`
	Authorized   bool   `json:"authorized"`
	MaxFileBytes int64  `json:"maxFileBytes"`
	DeviceName   string `json:"deviceName,omitempty"`
}

func (s *service) session(host, authorized bool) sessionInfo {
	return sessionInfo{Host: host, Authorized: authorized, MaxFileBytes: s.maxFileBytes}
}

func (s *service) handler(port string, admin bool) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /", http.FileServerFS(web.Assets()))
	mux.HandleFunc("GET "+api+"/session", func(w http.ResponseWriter, r *http.Request) {
		if admin {
			sendJSON(w, http.StatusOK, s.session(true, s.authorized(r, true)))
			return
		}
		guest := s.pairs.lookup(credential(r, guestCookie))
		session := s.session(false, guest.Status == "approved")
		if session.Authorized {
			session.DeviceName = guest.Name
		}
		sendJSON(w, http.StatusOK, session)
	})
	mux.HandleFunc("GET "+api+"/events", s.require(admin, func(w http.ResponseWriter, r *http.Request) {
		s.events(w, r, admin)
	}))
	if admin {
		mux.HandleFunc("POST "+api+"/admin/login", func(w http.ResponseWriter, r *http.Request) {
			if !s.authorized(r, true) {
				fail(w, http.StatusUnauthorized, "Invalid host credentials.")
				return
			}
			sessionCookie(w, cookieName(r, hostCookie), s.adminToken)
			sendJSON(w, http.StatusOK, s.session(true, true))
		})
		mux.HandleFunc("GET "+api+"/admin/devices", s.require(true, func(w http.ResponseWriter, r *http.Request) {
			sendJSON(w, http.StatusOK, s.pairs.list())
		}))
		mux.HandleFunc("POST "+api+"/admin/devices/{code}/{action}", s.require(true, func(w http.ResponseWriter, r *http.Request) {
			if !s.pairs.decide(r.PathValue("code"), r.PathValue("action")) {
				fail(w, http.StatusNotFound, "The request expired or the device status changed.")
				return
			}
			s.updates.publish(changes{Devices: true})
			w.WriteHeader(http.StatusNoContent)
		}))
		mux.HandleFunc("GET "+api+"/admin/addresses", s.require(true, func(w http.ResponseWriter, r *http.Request) {
			sendJSON(w, http.StatusOK, s.addresses)
		}))
		mux.HandleFunc("POST "+api+"/admin/open-folder", s.require(true, func(w http.ResponseWriter, r *http.Request) {
			if err := openFolder(s.files.root.Name()); err != nil {
				s.logger.Printf("Could not open the shared directory: %v", err)
				fail(w, http.StatusInternalServerError, "Could not open the shared folder. See the startup terminal for its path.")
				return
			}
			w.WriteHeader(http.StatusNoContent)
		}))
		mux.HandleFunc("GET "+api+"/admin/qr/{index}", s.require(true, s.qr))
	} else {
		mux.HandleFunc("POST "+api+"/pair", s.requestPair)
		mux.HandleFunc("POST "+api+"/pair/status", s.pairStatus)
	}
	s.registerFileRoutes(mux, admin)
	s.registerClipboardRoutes(mux, admin)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' blob:; connect-src 'self' https:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		host, requestPort, _ := net.SplitHostPort(r.Host)
		ip, ipErr := netip.ParseAddr(host)
		if requestPort != port || ipErr != nil || (admin && !ip.IsLoopback()) {
			fail(w, http.StatusForbidden, "Use the IP address and port shown by LanDrop.")
			return
		}
		if strings.HasPrefix(r.URL.Path, api+"/") {
			w.Header().Set("Cache-Control", "no-store")
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				origin := r.Header.Get("Origin")
				if r.Header.Get("X-LanDrop") != "1" || (origin != "" && origin != "http://"+r.Host) {
					fail(w, http.StatusForbidden, "Invalid request origin.")
					return
				}
			}
		}
		mux.ServeHTTP(w, r)
	})
}

func (s *service) authorized(r *http.Request, admin bool) bool {
	if admin {
		return subtle.ConstantTimeCompare([]byte(credential(r, hostCookie)), []byte(s.adminToken)) == 1
	}
	token := credential(r, guestCookie)
	return token != "" && s.pairs.lookup(token).Status == "approved"
}

func (s *service) require(admin bool, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.authorized(r, admin) {
			fail(w, http.StatusUnauthorized, "Connect to the host first.")
			return
		}
		next(w, r)
	}
}

func (s *service) requestPair(w http.ResponseWriter, r *http.Request) {
	var input struct{ Name string }
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048))
	if err := decoder.Decode(&input); err != nil {
		fail(w, http.StatusBadRequest, "Could not read the device name.")
		return
	}
	token, d, err := s.pairs.request(input.Name, peerIP(r.RemoteAddr))
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, errPendingPairLimit) {
			status = http.StatusTooManyRequests
		}
		fail(w, status, err.Error())
		return
	}
	s.updates.publish(changes{Devices: true})
	s.logger.Printf("Pending approval: %s · %s (%s) · landrop approve %s", d.Code, d.Name, d.Address, d.Code)
	sendJSON(w, http.StatusCreated, map[string]string{"code": d.Code, "token": token})
}

func (s *service) pairStatus(w http.ResponseWriter, r *http.Request) {
	token := bearer(r)
	guest := s.pairs.lookup(token)
	result := struct {
		Status  string       `json:"status"`
		Session *sessionInfo `json:"session,omitempty"`
	}{Status: guest.Status}
	if result.Status == "approved" {
		sessionCookie(w, cookieName(r, guestCookie), token)
		session := s.session(false, true)
		session.DeviceName = guest.Name
		result.Session = &session
	}
	sendJSON(w, http.StatusOK, result)
}

func (s *service) qr(w http.ResponseWriter, r *http.Request) {
	for i, address := range s.addresses {
		if fmt.Sprint(i) != r.PathValue("index") {
			continue
		}
		png, err := qrcode.Encode(address, qrcode.Medium, 256)
		if err != nil {
			fail(w, http.StatusInternalServerError, "Could not generate the QR code.")
			return
		}
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(png)
		return
	}
	fail(w, http.StatusNotFound, "Address not found.")
}
