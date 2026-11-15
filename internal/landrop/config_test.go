package landrop

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOpenShareKeepsCredentialsPrivate(t *testing.T) {
	base := t.TempDir()
	home := filepath.Join(base, "profile")
	for _, share := range []string{base, home, filepath.Join(home, instanceDirectory), filepath.Join(home, peerDirectory, "nested")} {
		root, err := openShare(home, share)
		if err == nil {
			root.Close()
			t.Errorf("opened private share %q", share)
		} else if !strings.Contains(err.Error(), "private configuration or credentials") {
			t.Errorf("unexpected error for %q: %v", share, err)
		}
	}
	for _, share := range []string{filepath.Join(home, "shared"), filepath.Join(base, "downloads", "LanDrop")} {
		root, err := openShare(home, share)
		if err != nil {
			t.Errorf("could not open ordinary share %q: %v", share, err)
		} else {
			root.Close()
		}
	}
}

func TestOpenShareResolvesCredentialDirectoryLinks(t *testing.T) {
	base := t.TempDir()
	home := filepath.Join(base, "profile")
	if err := os.Mkdir(home, 0700); err != nil {
		t.Fatal(err)
	}
	share := filepath.Join(base, "shared")
	if err := os.Mkdir(share, 0700); err != nil {
		t.Fatal(err)
	}
	private := filepath.Join(share, "redirected")
	if err := os.Mkdir(private, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(private, filepath.Join(home, peerDirectory)); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	root, err := openShare(home, share)
	if err == nil {
		root.Close()
		t.Fatal("opened share containing a redirected credential directory")
	}
	if !strings.Contains(err.Error(), "private configuration or credentials") {
		t.Fatal(err)
	}
}
