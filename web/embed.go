package web

import (
	"embed"
	"io/fs"
)

//go:embed dist
var dist embed.FS

// Assets returns the compiled web interface rooted at its public directory.
func Assets() fs.FS {
	assets, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err)
	}
	return assets
}
