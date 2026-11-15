package landrop

import (
	"fmt"
	"os"

	"golang.org/x/sys/windows"
)

func fileIdentity(root *os.Root, name string, info os.FileInfo) (string, error) {
	// FileInfo.Sys exposes timestamps and attributes, but not the Windows file ID.
	file, err := root.Open(name)
	if err != nil {
		return "", err
	}
	defer file.Close()
	var data windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(windows.Handle(file.Fd()), &data); err != nil {
		return "", err
	}
	size := int64(data.FileSizeHigh)<<32 | int64(data.FileSizeLow)
	isDir := data.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY != 0
	if isDir != info.IsDir() || size != info.Size() || data.LastWriteTime.Nanoseconds() != info.ModTime().UnixNano() {
		return "", errFileChanged
	}
	return fmt.Sprintf("%d:%d:%d:%d", data.VolumeSerialNumber, data.FileIndexHigh, data.FileIndexLow, data.CreationTime.Nanoseconds()), nil
}
