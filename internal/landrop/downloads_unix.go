//go:build !windows

package landrop

import (
	"os"
	"path/filepath"
)

func downloadsDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Downloads"), nil
}
