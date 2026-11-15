# LanDrop

Share files, clipboard text, and images on a local network. Run one executable on the host and connect from another device with a browser or the CLI.

## Quick start

1. Run `landrop.exe` on Windows or `./landrop` in a macOS terminal. LanDrop creates a shared folder, starts the server, and opens the host page.
2. Scan the QR code with another device or open the guest address in its browser. The device must be able to reach the host's local IP address and port.
3. Select **Request access** on the guest device. Match the confirmation code on the host page and select **Allow**. Approved devices can manage shared files and clipboard entries. Each IP address can have two requests awaiting approval at a time.

The default shared folder is `Downloads/LanDrop`. Select **Open folder on host** to open it in your file manager. Files placed there appear on connected devices. Same-name uploads keep both copies. Use `--max-file-mib` to set a per-file upload limit.

The host can remove connected devices. Stopping LanDrop ends the session and clears the clipboard history. Files stay in the shared folder. Guests must pair again after a restart. The default HTTP connection sends data and credentials in plain text and is intended for trusted local networks.

### Clipboard

Type or paste text, then paste or drop images to insert them between text sections. Select **Share** to send everything as one entry. The clipboard keeps the latest 20 entries. Each entry accepts up to 256 KiB of UTF-8 text and up to 64 PNG, JPEG, WebP, or GIF images totaling 256 MiB. Open an entry to see its full contents in order. Save edits to text-only entries with `Ctrl+S` or `Cmd+S`. To copy an image directly, use a browser that supports image clipboard writes in a secure context, such as the local host page. On a LAN HTTP address, download the image or use the browser's image menu.

Pasting a web selection keeps its text and images in order. The browser downloads linked HTTPS images concurrently while you edit. Sharing becomes available once all images load. If an image fails to load, remove it from the draft or replace it by pasting or dropping the original image.

### Manage shared files

Use **List view** to browse one folder or **Tree view** to expand several folders. The arrow expands a folder in the tree, and its name selects it as the upload destination. Use the column headers or **Sort by** to change the sort order.

Use **Upload** to pick files or folders, or drag them into the destination folder. The row menu provides download, rename, move, and delete. On desktop, right-click for the menu, press **F2** to rename the focused entry, or drag an entry to another folder or a parent in the breadcrumb bar.

Deleting a folder permanently removes its contents. If an entry changes before you confirm a web operation, select it again from the refreshed list. The file browser lists regular files and folders inside the share.

## Command line

Start the host and manage access from another terminal:

```sh
landrop serve --no-open
landrop devices
landrop approve 4821
```

Use the guest address shown by the host. The pairing command displays a confirmation code and waits for approval.

```sh
landrop pair --to http://192.168.1.23:8765
landrop put --to http://192.168.1.23:8765 report.pdf
landrop ls --to http://192.168.1.23:8765
landrop mkdir --to http://192.168.1.23:8765 photos
landrop ls --to http://192.168.1.23:8765 --dir photos
landrop mv --to http://192.168.1.23:8765 <file-id> photos/report.pdf
landrop rm --to http://192.168.1.23:8765 <file-id>
landrop get --to http://192.168.1.23:8765 <file-id>
landrop clip get --to http://192.168.1.23:8765
landrop clip set --to http://192.168.1.23:8765 < note.txt
```

The web app and CLI upload four files concurrently by default. Use `put --jobs <count>` to tune CLI concurrency, or `put --dir <folder>` to upload into a shared subfolder. Use `rm --recursive <folder-id>` to remove a non-empty folder. Get a fresh ID from `ls` after moving or renaming an entry.

The text redirection example works in macOS shells and Windows Command Prompt. In PowerShell, pipe UTF-8 text to `clip set`. This adds a history entry, and empty input clears the text entries. `clip get` prints the newest text entry. Omit `--to` to send files and text to the local instance running under your user account. Use `landrop host` to find the host URL, `landrop reject <code>` to decline a request, or `landrop remove <code>` to revoke a device's access.

Run `landrop serve --help` for all startup options. Common options include `--dir`, `--port`, `--listen`, `--local`, and `--no-open`. If the default port 8765 is taken, LanDrop picks an available port. Set `LANDROP_HOME` to use a different configuration directory and default to its `shared` subfolder. An explicit `--dir` takes precedence. The shared folder must be separate from LanDrop’s private configuration and credential directories. If the host has a firewall, allow inbound connections to the guest port.

If files from an earlier release are still in `LanDrop/shared` under your user configuration directory, move them into the new shared folder or use `--dir` to keep sharing the old one.

## Build

Requires Go 1.25 or later and Node.js 22.12 or later. The build embeds the Vite, React, and TypeScript frontend from `web/dist` into the Go executable.

```sh
npm --prefix web ci
node scripts/build.mjs
node scripts/build.mjs --release
```

The local build produces `dist/landrop` (`dist/landrop.exe` on Windows). The release build produces four single-file executables for macOS and Windows on arm64 and amd64. Each has an uncompressed size budget of 10 MiB.

To run Go tests or start the application from source, build the frontend first.

```sh
npm --prefix web run build
go test ./...
go run ./cmd/landrop serve --no-open
```

### Frontend development

Start LanDrop, then run Vite in a second terminal:

```sh
npm --prefix web ci
npm --prefix web run dev
```

Open the Vite URL. It proxies API requests to the guest listener at `http://127.0.0.1:8765`. If LanDrop uses another guest port, set `LANDROP_API_URL` to the guest address printed on startup.

For the host view, point a separate Vite instance at the origin of the **Host page** URL printed by LanDrop:

```sh
LANDROP_API_URL=http://127.0.0.1:HOST_PORT npm --prefix web run dev -- --port 5174
```

Replace `HOST_PORT` with the actual port. Open `http://127.0.0.1:5174/` with the original host URL's `#host=…` fragment to sign in.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).
