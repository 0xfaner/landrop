package landrop

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const defaultUploadJobs = 4

type connection struct {
	Address string `json:"address"`
	Token   string `json:"token"`
}

var client = &http.Client{
	Transport: &http.Transport{
		DialContext:           (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
		ResponseHeaderTimeout: 10 * time.Second, IdleConnTimeout: 30 * time.Second,
		MaxIdleConnsPerHost: defaultUploadJobs,
	},
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

func endpoint(address, path string) (string, error) {
	u, err := url.Parse(address)
	if err != nil || u.Scheme != "http" || u.User != nil || u.RawQuery != "" ||
		u.Fragment != "" || (u.Path != "" && u.Path != "/") || u.Port() == "" {
		return "", fmt.Errorf("use a connection URL like http://192.168.1.23:8765")
	}
	if _, err := netip.ParseAddr(u.Hostname()); err != nil {
		return "", fmt.Errorf("the connection URL must use an IP address")
	}
	return "http://" + u.Host + api + path, nil
}

func (c connection) request(ctx context.Context, method, path string, body io.Reader, size int64) (*http.Response, error) {
	target, err := endpoint(c.Address, path)
	if err != nil {
		return nil, err
	}
	r, err := http.NewRequestWithContext(ctx, method, target, body)
	if err != nil {
		return nil, err
	}
	r.ContentLength = size
	r.Header.Set("X-LanDrop", "1")
	if c.Token != "" {
		r.Header.Set("Authorization", "Bearer "+c.Token)
	}
	res, err := client.Do(r)
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		return res, nil
	}
	defer res.Body.Close()
	var message struct{ Error string }
	_ = json.NewDecoder(io.LimitReader(res.Body, 4096)).Decode(&message)
	if res.StatusCode == http.StatusUnauthorized {
		return nil, errors.New("access denied or session expired. Pair again or run landrop host")
	}
	if message.Error != "" {
		return nil, errors.New(message.Error)
	}
	return nil, fmt.Errorf("HTTP %s", res.Status)
}

func decodeResponse(res *http.Response, value any) error {
	defer res.Body.Close()
	return json.NewDecoder(res.Body).Decode(value)
}

func readConnection(path string) (connection, error) {
	var c connection
	data, err := os.ReadFile(path)
	if err != nil {
		return c, err
	}
	err = json.Unmarshal(data, &c)
	return c, err
}

func findHost(ctx context.Context, home string) (connection, error) {
	paths, err := filepath.Glob(filepath.Join(home, instanceDirectory, "host-*.json"))
	if err != nil {
		return connection{}, err
	}
	var found connection
	for _, path := range paths {
		c, err := readConnection(path)
		if err != nil {
			continue
		}
		u, err := url.Parse(c.Address)
		if err != nil || u.Hostname() != "127.0.0.1" || c.Token == "" {
			continue
		}
		probe, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
		res, err := c.request(probe, "GET", "/admin/addresses", nil, 0)
		if err == nil {
			res.Body.Close()
		}
		cancel()
		if err != nil {
			continue
		}
		if found.Address != "" {
			return connection{}, errors.New("multiple local instances found. Set a separate LANDROP_HOME for each instance")
		}
		found = c
	}
	if found.Address == "" {
		return connection{}, errors.New("no local host found. Run landrop serve first")
	}
	return found, nil
}

func peerPath(home, address string) string {
	return filepath.Join(home, peerDirectory, fmt.Sprintf("%x.json", sha256.Sum256([]byte(address))))
}

func pairClient(ctx context.Context, home, address, name string) error {
	if name == "" {
		name, _ = os.Hostname()
		if name == "" {
			name = "CLI device"
		}
	}
	c := connection{Address: address}
	body, _ := json.Marshal(map[string]string{"name": name})
	res, err := c.request(ctx, "POST", "/pair", strings.NewReader(string(body)), int64(len(body)))
	if err != nil {
		return err
	}
	var req struct{ Token, Code string }
	if err := decodeResponse(res, &req); err != nil {
		return err
	}
	if req.Token == "" || req.Code == "" {
		return errors.New("the host did not return a pairing request")
	}
	c.Token = req.Token
	fmt.Fprintln(os.Stderr, "Confirmation code: "+req.Code+". Ask the host to approve your request.")
	wait, cancel := context.WithTimeout(ctx, pairTimeout)
	defer cancel()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		res, err := c.request(wait, "POST", "/pair/status", nil, 0)
		if err != nil {
			return err
		}
		var status struct{ Status string }
		if err := decodeResponse(res, &status); err != nil {
			return err
		}
		switch status.Status {
		case "approved":
			path := peerPath(home, address)
			if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
				return err
			}
			file, err := os.CreateTemp(filepath.Dir(path), "peer-*.tmp")
			if err != nil {
				return err
			}
			defer os.Remove(file.Name())
			if err := errors.Join(json.NewEncoder(file).Encode(c), file.Close()); err != nil {
				return err
			}
			if err := os.Rename(file.Name(), path); err != nil {
				return err
			}
			fmt.Fprintln(os.Stderr, "Connected to "+address)
			return nil
		case "rejected":
			return errors.New("the host declined your request")
		case "expired":
			return errors.New("the pairing request expired")
		case "pending":
		default:
			return errors.New("unknown pairing status")
		}
		select {
		case <-wait.Done():
			return wait.Err()
		case <-ticker.C:
		}
	}
}

func putFiles(ctx context.Context, c connection, paths []string, dir string, jobs int) error {
	type result struct {
		index int
		item  fileItem
		err   error
	}
	indices := make(chan int)
	completed := make(chan result)
	var workers sync.WaitGroup
	for range min(jobs, len(paths)) {
		workers.Go(func() {
			for i := range indices {
				item, err := putFile(ctx, c, paths[i], dir)
				completed <- result{i, item, err}
			}
		})
	}
	go func() {
	queue:
		for i := range paths {
			select {
			case <-ctx.Done():
				break queue
			case indices <- i:
			}
		}
		close(indices)
		workers.Wait()
		close(completed)
	}()

	// Keep stdout in argument order even when requests finish out of order.
	var failures []error
	pending := make(map[int]result)
	next := 0
	for result := range completed {
		pending[result.index] = result
		for {
			ready, ok := pending[next]
			if !ok {
				break
			}
			if ready.err != nil {
				failures = append(failures, fmt.Errorf("%s: %w", paths[next], ready.err))
			} else {
				fmt.Printf("%s\t%s\n", ready.item.ID, ready.item.Name)
			}
			delete(pending, next)
			next++
		}
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return errors.Join(failures...)
}

func putFile(ctx context.Context, c connection, path, dir string) (fileItem, error) {
	var item fileItem
	file, err := os.Open(path)
	if err != nil {
		return item, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return item, err
	}
	if !info.Mode().IsRegular() {
		return item, errors.New("choose a regular file")
	}
	var body io.Reader = file
	if info.Size() == 0 {
		body = http.NoBody
	}
	name := info.Name()
	if dir != "" {
		name = dir + "/" + name
	}
	res, err := c.request(ctx, "POST", "/files?name="+url.QueryEscape(name), body, info.Size())
	if err != nil {
		return item, err
	}
	err = decodeResponse(res, &item)
	return item, err
}

func getFile(ctx context.Context, c connection, id, path string) error {
	res, err := c.request(ctx, "GET", "/files/"+url.PathEscape(id), nil, 0)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if path == "" {
		_, params, _ := mime.ParseMediaType(res.Header.Get("Content-Disposition"))
		path = params["filename"]
		if !validName(path) {
			return errors.New("the host returned an invalid filename. Specify a destination path")
		}
	}
	out, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, res.Body)
	if err := errors.Join(copyErr, out.Close()); err != nil {
		if removeErr := os.Remove(path); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			return errors.Join(err, fmt.Errorf("could not remove incomplete download: %w", removeErr))
		}
		return err
	}
	fmt.Fprintln(os.Stderr, "Saved to "+path)
	return nil
}
