package landrop

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
)

func (s *service) watchShare(ctx context.Context) {
	for ctx.Err() == nil {
		err := s.runShareWatcher(ctx)
		if ctx.Err() != nil {
			return
		}

		s.logger.Printf("Shared directory watcher unavailable: %v. Retrying in 30 seconds.", err)
		s.updates.publish(changes{AllFiles: true})
		timer := time.NewTimer(30 * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func (s *service) runShareWatcher(ctx context.Context) error {
	root := s.files.root
	base := root.Name()
	opened, err := root.Stat(".")
	if err != nil {
		return err
	}
	current, err := os.Stat(base)
	if err != nil {
		return err
	}
	if !os.SameFile(opened, current) {
		return errors.New("the shared directory moved or was replaced")
	}
	watcher, err := fsnotify.NewBufferedWatcher(256)
	if err != nil {
		return err
	}
	defer watcher.Close()

	watched := make(map[string]bool)
	addTree := func(dir string) error {
		return fs.WalkDir(root.FS(), dir, func(name string, entry fs.DirEntry, err error) error {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if errors.Is(err, fs.ErrNotExist) && name != "." {
				return nil
			}
			if err != nil {
				return err
			}
			if !entry.IsDir() {
				return nil
			}
			if name != "." && !validPath(name) {
				return fs.SkipDir
			}
			if err := watcher.Add(filepath.Join(base, filepath.FromSlash(name))); err != nil {
				if errors.Is(err, fs.ErrNotExist) && name != "." {
					return fs.SkipDir
				}
				return err
			}
			watched[name] = true
			return nil
		})
	}
	if err := addTree("."); err != nil {
		return err
	}
	s.updates.publish(changes{AllFiles: true})

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err, ok := <-watcher.Errors:
			if !ok {
				return errors.New("watcher closed")
			}
			return err
		case event, ok := <-watcher.Events:
			if !ok {
				return errors.New("watcher closed")
			}
			relative, err := filepath.Rel(base, event.Name)
			if err != nil {
				continue
			}
			name := filepath.ToSlash(relative)
			moved := event.Has(fsnotify.Remove) || event.Has(fsnotify.Rename)
			if name == "." {
				if moved {
					return errors.New("the shared directory moved or was removed")
				}
				continue
			}
			if !validPath(name) || s.files.directory(path.Dir(name), nil) != nil {
				continue
			}

			created := event.Has(fsnotify.Create)
			if watched[name] && !moved && !created {
				s.updates.publish(changes{Folders: []string{name}})
				continue
			}
			if moved && watched[name] {
				for dir := range watched {
					if dir == name || strings.HasPrefix(dir, name+"/") {
						err := watcher.Remove(filepath.Join(base, filepath.FromSlash(dir)))
						if err != nil && !errors.Is(err, fsnotify.ErrNonExistentWatch) {
							return err
						}
						delete(watched, dir)
					}
				}
			}
			// A directory may already contain files when moved into the share.
			if created || moved {
				info, err := root.Lstat(name)
				if err != nil && !errors.Is(err, fs.ErrNotExist) {
					return fmt.Errorf("watch %q: %w", name, err)
				}
				if err == nil && info.IsDir() {
					if err := addTree(name); err != nil {
						return err
					}
				}
			}
			s.updates.filesChanged(name)
			if watched[name] {
				s.updates.publish(changes{Folders: []string{name}})
			}
		}
	}
}
