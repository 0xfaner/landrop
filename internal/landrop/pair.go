package landrop

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode"
)

const (
	pairTimeout          = 5 * time.Minute
	maxPendingPairsPerIP = 2
)

var errPendingPairLimit = errors.New("Too many pending pairing requests from this IP address. Wait for one to finish, then try again.")

type device struct {
	Code    string `json:"code"`
	Name    string `json:"name"`
	Address string `json:"address"`
	Status  string `json:"status"`
	expires time.Time
}

type pairing struct {
	mu      sync.Mutex
	devices map[string]*device
}

func (p *pairing) prune(now time.Time) {
	for token, d := range p.devices {
		if !d.expires.IsZero() && !now.Before(d.expires) {
			delete(p.devices, token)
		}
	}
}

func (p *pairing) request(name, address string) (string, device, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	p.prune(now)
	if len(p.devices) >= 64 {
		return "", device{}, fmt.Errorf("Too many pairing requests. Try again later.")
	}
	name = strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, name))
	if name == "" || len(name) > 120 {
		return "", device{}, fmt.Errorf("The device name must be 1 to 120 bytes long.")
	}

	used := make(map[string]bool, len(p.devices))
	pending := 0
	for _, d := range p.devices {
		used[d.Code] = true
		if d.Address == address && d.Status == "pending" {
			pending++
		}
	}
	if pending >= maxPendingPairsPerIP {
		return "", device{}, errPendingPairLimit
	}
	for {
		n, err := rand.Int(rand.Reader, big.NewInt(9000))
		if err != nil {
			return "", device{}, err
		}
		code := fmt.Sprintf("%04d", 1000+n.Int64())
		if used[code] {
			continue
		}
		token := rand.Text() + rand.Text()
		d := device{Code: code, Name: name, Address: address, Status: "pending", expires: now.Add(pairTimeout)}
		p.devices[token] = &d
		return token, d, nil
	}
}

func (p *pairing) lookup(token string) device {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.prune(time.Now())
	if d := p.devices[token]; d != nil {
		return *d
	}
	return device{Status: "expired"}
}

func (p *pairing) list() []device {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.prune(time.Now())
	devices := []device{}
	for _, d := range p.devices {
		if d.Status == "pending" || d.Status == "approved" {
			devices = append(devices, *d)
		}
	}
	slices.SortFunc(devices, func(a, b device) int { return strings.Compare(a.Code, b.Code) })
	return devices
}

func (p *pairing) decide(code, action string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.prune(time.Now())
	for token, d := range p.devices {
		if d.Code != code {
			continue
		}
		switch {
		case d.Status == "pending" && action == "approve":
			d.Status = "approved"
			d.expires = time.Time{}
		case d.Status == "pending" && action == "reject":
			d.Status = "rejected"
		case d.Status == "approved" && action == "remove":
			delete(p.devices, token)
		default:
			return false
		}
		return true
	}
	return false
}
