//go:build !unix && !windows

package landrop

import "os"

func fileIdentity(_ *os.Root, _ string, _ os.FileInfo) (string, error) {
	return "", os.ErrInvalid
}
