//go:build unix

package landrop

import (
	"fmt"
	"os"
	"syscall"
)

func fileIdentity(_ *os.Root, _ string, info os.FileInfo) (string, error) {
	stat := info.Sys().(*syscall.Stat_t)
	return fmt.Sprintf("%d:%d", stat.Dev, stat.Ino), nil
}
