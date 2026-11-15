package landrop

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/netip"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"time"
)

func serve(ctx context.Context, args []string) error {
	f := flagSet("serve", "serve [options]")
	local := f.Bool("local", false, "Allow access from this machine only")
	listen := f.String("listen", "", "Guest IPv4 bind address (default 0.0.0.0)")
	port := f.Int("port", 8765, "Guest port (0 picks an available port)")
	noOpen := f.Bool("no-open", false, "Start without opening a browser")
	dir := f.String("dir", "", "Shared directory (default Downloads/LanDrop, or shared under LANDROP_HOME)")
	maxFileMiB := f.Int64("max-file-mib", 0, "Maximum file size in MiB (0 means no limit)")
	if err := f.Parse(args); err != nil {
		return err
	}
	if f.NArg() != 0 || *port < 0 || *port > 65535 || *maxFileMiB < 0 || *maxFileMiB > 1<<30 {
		return errors.New("invalid server options")
	}
	portSet := false
	f.Visit(func(flag *flag.Flag) { portSet = portSet || flag.Name == "port" })
	if *local && *listen != "" {
		return errors.New("use either --local or --listen")
	}
	if *listen == "" {
		*listen = "0.0.0.0"
		if *local {
			*listen = "127.0.0.1"
		}
	}
	ip, err := netip.ParseAddr(*listen)
	if err != nil || !ip.Is4() {
		return errors.New("--listen requires an IPv4 address")
	}
	home, err := appDir()
	if err != nil {
		return err
	}
	path, err := sharedDir(*dir, home)
	if err != nil {
		return err
	}
	root, err := openShare(home, path)
	if err != nil {
		return err
	}
	defer root.Close()

	guest, err := net.Listen("tcp4", net.JoinHostPort(*listen, strconv.Itoa(*port)))
	if err != nil && !portSet {
		guest, err = net.Listen("tcp4", net.JoinHostPort(*listen, "0"))
	}
	if err != nil {
		return err
	}
	defer guest.Close()
	host, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return err
	}
	defer host.Close()

	logger := log.New(os.Stderr, "", log.Ltime)
	removed, err := cleanupUploadStaging(root)
	if err != nil {
		logger.Printf("Could not clean up all incomplete uploads: %v", err)
	}
	if removed > 0 {
		logger.Printf("Removed %d incomplete upload files from a previous run.", removed)
	}

	guestPort := strconv.Itoa(guest.Addr().(*net.TCPAddr).Port)
	hostPort := strconv.Itoa(host.Addr().(*net.TCPAddr).Port)
	admin := connection{Address: "http://127.0.0.1:" + hostPort, Token: rand.Text() + rand.Text()}
	stateFile, err := writeInstance(home, admin)
	if err != nil {
		return err
	}
	defer os.Remove(stateFile)

	clipboardDir, err := os.MkdirTemp("", "landrop-clipboard-")
	if err != nil {
		return fmt.Errorf("could not create clipboard storage: %w", err)
	}
	defer os.RemoveAll(clipboardDir)
	clipboardRoot, err := os.OpenRoot(clipboardDir)
	if err != nil {
		return fmt.Errorf("could not open clipboard storage: %w", err)
	}
	defer clipboardRoot.Close()

	s := &service{
		clipboard: clipboardStore{root: clipboardRoot},
		files:     fileStore{root: root}, pairs: pairing{devices: make(map[string]*device)},
		adminToken: admin.Token, maxFileBytes: *maxFileMiB << 20, logger: logger,
		addresses: guestAddresses(ip, guestPort), uploadSlots: make(chan struct{}, maxConcurrentUploads),
	}
	watchContext, stopWatcher := context.WithCancel(ctx)
	watchDone := make(chan struct{})
	go func() {
		defer close(watchDone)
		s.watchShare(watchContext)
	}()
	defer func() {
		stopWatcher()
		<-watchDone
	}()
	hostURL := admin.Address + "/#host=" + admin.Token
	fmt.Fprintln(os.Stderr, "LanDrop "+version)
	fmt.Fprintln(os.Stderr, "Shared directory: "+path)
	warnLegacyShare(home, path)
	fmt.Fprintln(os.Stderr, "Host page: "+hostURL)
	for _, address := range s.addresses {
		fmt.Fprintln(os.Stderr, "Guest address: "+address)
	}
	if *maxFileMiB == 0 {
		fmt.Fprintln(os.Stderr, "Upload size limit: none")
	} else {
		fmt.Fprintf(os.Stderr, "Upload size limit: %d MiB per file\n", *maxFileMiB)
	}
	fmt.Fprintln(os.Stderr, "When a guest requests access, approve it on the host page or run landrop approve <code>.")
	guestServer := httpServer(s.handler(guestPort, false))
	hostServer := httpServer(s.handler(hostPort, true))
	serveErrors := make(chan error, 2)
	go func() { serveErrors <- guestServer.Serve(guest) }()
	go func() { serveErrors <- hostServer.Serve(host) }()
	if !*noOpen {
		if err := openBrowser(hostURL); err != nil {
			logger.Printf("Could not open the browser. Open the host URL shown above: %v", err)
		}
	}

	var serveErr error
	select {
	case <-ctx.Done():
	case serveErr = <-serveErrors:
	}
	guestServer.Close()
	hostServer.Close()
	if errors.Is(serveErr, http.ErrServerClosed) {
		return nil
	}
	return serveErr
}

func httpServer(handler http.Handler) *http.Server {
	return &http.Server{
		Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 2 * time.Hour,
		WriteTimeout: 2 * time.Hour, IdleTimeout: 90 * time.Second, MaxHeaderBytes: 16 << 10,
	}
}

func guestAddresses(listen netip.Addr, port string) []string {
	if !listen.IsUnspecified() {
		return []string{"http://" + net.JoinHostPort(listen.String(), port)}
	}
	addresses, _ := net.InterfaceAddrs()
	var urls []string
	for _, address := range addresses {
		ip, _, _ := net.ParseCIDR(address.String())
		if ip.To4() != nil && !ip.IsLoopback() {
			urls = append(urls, "http://"+net.JoinHostPort(ip.String(), port))
		}
	}
	slices.Sort(urls)
	urls = slices.Compact(urls)
	if len(urls) == 0 {
		return []string{"http://127.0.0.1:" + port}
	}
	return urls
}

func writeInstance(home string, admin connection) (string, error) {
	dir := filepath.Join(home, instanceDirectory)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	file, err := os.CreateTemp(dir, "host-*.json")
	if err != nil {
		return "", err
	}
	err = errors.Join(json.NewEncoder(file).Encode(admin), file.Close())
	if err != nil {
		os.Remove(file.Name())
	}
	return file.Name(), err
}
