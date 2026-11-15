package landrop

import (
	"io"
	"os/exec"
	"runtime"
)

func openBrowser(address string) error {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		command = exec.Command("open", address)
	case "windows":
		command = exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", address)
	default:
		command = exec.Command("xdg-open", address)
	}
	command.Stderr = io.Discard
	return command.Run()
}

func openFolder(path string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", path).Run()
	case "windows":
		command := exec.Command("explorer.exe", path)
		if err := command.Start(); err != nil {
			return err
		}
		go command.Wait()
		return nil
	default:
		return exec.Command("xdg-open", path).Run()
	}
}
