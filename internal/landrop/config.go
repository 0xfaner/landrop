package landrop

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const (
	instanceDirectory = "instances"
	peerDirectory     = "peers"
)

func appDir() (string, error) {
	if dir := os.Getenv("LANDROP_HOME"); dir != "" {
		return filepath.Abs(dir)
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "LanDrop"), nil
}

func sharedDir(override, appHome string) (string, error) {
	if override != "" {
		return filepath.Abs(override)
	}
	if os.Getenv("LANDROP_HOME") != "" {
		return filepath.Join(appHome, "shared"), nil
	}
	downloads, err := downloadsDir()
	if err != nil {
		return "", fmt.Errorf("could not find the Downloads folder: %w. Use --dir to set the shared directory", err)
	}
	return filepath.Join(downloads, "LanDrop"), nil
}

func openShare(home, share string) (*os.Root, error) {
	for _, dir := range []string{home, share} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			return nil, err
		}
	}
	home, err := filepath.EvalSymlinks(home)
	if err != nil {
		return nil, err
	}
	share, err = filepath.EvalSymlinks(share)
	if err != nil {
		return nil, err
	}

	conflict := errors.New("the shared directory overlaps LanDrop's private configuration or credentials; choose another --dir")
	if overlaps, err := containsDirectory(share, home); err != nil {
		return nil, err
	} else if overlaps {
		return nil, conflict
	}
	for _, name := range []string{instanceDirectory, peerDirectory} {
		resolved, err := filepath.EvalSymlinks(filepath.Join(home, name))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		for _, paths := range [][2]string{{share, resolved}, {resolved, share}} {
			overlaps, err := containsDirectory(paths[0], paths[1])
			if err != nil {
				return nil, err
			}
			if overlaps {
				return nil, conflict
			}
		}
	}
	return os.OpenRoot(share)
}

func containsDirectory(parent, child string) (bool, error) {
	info, err := os.Stat(parent)
	if err != nil {
		return false, err
	}
	for {
		candidate, err := os.Stat(child)
		if err != nil {
			return false, err
		}
		if os.SameFile(info, candidate) {
			return true, nil
		}
		next := filepath.Dir(child)
		if next == child {
			return false, nil
		}
		child = next
	}
}

func warnLegacyShare(appHome, current string) {
	legacy := filepath.Join(appHome, "shared")
	if legacy == current {
		return
	}
	dir, err := os.Open(legacy)
	if err != nil {
		return
	}
	defer dir.Close()
	if names, err := dir.Readdirnames(1); err == nil && len(names) != 0 {
		fmt.Fprintf(os.Stderr, "Files from an earlier version may still be in %s. Move them to the new shared directory or start with --dir to use the old folder.\n", legacy)
	}
}
