package landrop

import (
	"context"
	_ "embed"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"strings"
)

const version = "0.1.1"

//go:embed THIRD_PARTY_NOTICES.txt
var notices string

func flagSet(name, usage string) *flag.FlagSet {
	f := flag.NewFlagSet(name, flag.ContinueOnError)
	f.Usage = func() {
		fmt.Fprintln(f.Output(), "Usage: landrop "+usage)
		f.PrintDefaults()
	}
	return f
}

// Run executes a LanDrop command using args without the executable name.
func Run(ctx context.Context, args []string) error {
	if len(args) == 0 {
		return serve(ctx, nil)
	}
	var err error
	switch args[0] {
	case "help", "--help", "-h":
		fmt.Print(`LanDrop — LAN file and clipboard sharing

  landrop                                   Start the server and open the host page
  landrop serve --no-open                   Start the server without opening a browser
  landrop licenses                          Show third-party licenses
  landrop host                              Show the host page and guest addresses
  landrop devices                           List pending and connected devices
  landrop approve|reject|remove <code>      Manage device access
  landrop pair --to <address>               Request to join a host
  landrop put [options] <file...>           Upload files
  landrop ls [options]                     List shared files
  landrop get [--to <address>] <id> [path]  Download a file
  landrop mkdir [--to <address>] <path>     Create a folder
  landrop mv [--to <address>] <id> <path>   Move or rename an entry
  landrop rm [options] <id>                 Delete an entry
  landrop clip get|set [--to <address>]     Read the latest text or add text from stdin

Run landrop <command> --help for command options.
`)
	case "licenses":
		fmt.Print(notices)
	case "version", "--version":
		fmt.Println("LanDrop", version)
	case "serve":
		err = serve(ctx, args[1:])
	case "host", "devices", "approve", "reject", "remove", "pair", "put", "ls", "get", "mkdir", "mv", "rm", "clip":
		err = runClient(ctx, args[0], args[1:])
	default:
		err = fmt.Errorf("unknown command %q. Run landrop --help", args[0])
	}
	if errors.Is(err, flag.ErrHelp) || errors.Is(err, context.Canceled) {
		return nil
	}
	return err
}

func runClient(ctx context.Context, command string, args []string) error {
	clipAction := ""
	if command == "clip" {
		if len(args) == 0 || args[0] == "--help" || args[0] == "-h" {
			fmt.Println("Usage: landrop clip get|set [--to <address>]")
			return nil
		}
		clipAction, args = args[0], args[1:]
		if clipAction != "get" && clipAction != "set" {
			return errors.New("clip requires get or set")
		}
	}
	usage := map[string]string{
		"host": "host", "devices": "devices", "approve": "approve <code>",
		"reject": "reject <code>", "remove": "remove <code>",
		"pair":  "pair --to <address> [--name <device-name>]",
		"put":   "put [--to <address>] [--dir <folder>] [--jobs <count>] <file...>",
		"ls":    "ls [--to <address>] [--dir <folder>]",
		"get":   "get [--to <address>] <id> [path]",
		"mkdir": "mkdir [--to <address>] <path>",
		"mv":    "mv [--to <address>] <id> <path>",
		"rm":    "rm [--to <address>] [--recursive] <id>",
		"clip":  "clip " + clipAction + " [--to <address>]",
	}
	f := flagSet(command, usage[command])
	to := ""
	name := ""
	switch command {
	case "pair", "put", "ls", "get", "mkdir", "mv", "rm", "clip":
		f.StringVar(&to, "to", "", "Guest URL (defaults to the local host instance)")
	}
	dir := ""
	if command == "ls" || command == "put" {
		f.StringVar(&dir, "dir", "", "Relative shared folder path")
	}
	jobs := defaultUploadJobs
	if command == "put" {
		f.IntVar(&jobs, "jobs", defaultUploadJobs, "Number of simultaneous uploads (1–8)")
	}
	recursive := false
	if command == "rm" {
		f.BoolVar(&recursive, "recursive", false, "Delete a folder and all its contents")
	}
	if command == "pair" {
		f.StringVar(&name, "name", "", "Device name (defaults to the computer name)")
	}
	if err := f.Parse(args); err != nil {
		return err
	}
	n := f.NArg()
	switch command {
	case "approve", "reject", "remove":
		if n != 1 || len(f.Arg(0)) != 4 || strings.Trim(f.Arg(0), "0123456789") != "" {
			return errors.New("enter a four-digit confirmation code")
		}
	case "put":
		if n < 1 {
			return errors.New("specify at least one file to upload")
		}
		if jobs < 1 || jobs > maxConcurrentUploads {
			return fmt.Errorf("--jobs must be between 1 and %d", maxConcurrentUploads)
		}
	case "mkdir":
		if n != 1 {
			return errors.New("specify one shared folder path")
		}
	case "rm":
		if n != 1 {
			return errors.New("specify one entry ID")
		}
	case "mv":
		if n != 2 {
			return errors.New("specify an entry ID and destination path")
		}
	case "get":
		if n < 1 || n > 2 {
			return errors.New("specify a file ID and an optional destination path")
		}
	default:
		if n != 0 {
			return errors.New("unexpected command arguments")
		}
	}
	home, err := appDir()
	if err != nil {
		return err
	}
	if command == "pair" {
		if to == "" {
			return errors.New("use --to with the guest address shown by the host")
		}
		return pairClient(ctx, home, strings.TrimSuffix(to, "/"), name)
	}
	var conn connection
	if to != "" {
		to = strings.TrimSuffix(to, "/")
		if _, err := endpoint(to, ""); err != nil {
			return err
		}
		conn, err = readConnection(peerPath(home, to))
		if errors.Is(err, os.ErrNotExist) {
			return errors.New("first run landrop pair --to " + to)
		}
	} else {
		conn, err = findHost(ctx, home)
	}
	if err != nil {
		return err
	}

	switch command {
	case "host":
		fmt.Println("Host page: " + conn.Address + "/#host=" + conn.Token)
		res, err := conn.request(ctx, "GET", "/admin/addresses", nil, 0)
		if err != nil {
			return err
		}
		var addresses []string
		if err := decodeResponse(res, &addresses); err != nil {
			return err
		}
		for _, address := range addresses {
			fmt.Println("Guest address: " + address)
		}
	case "devices":
		res, err := conn.request(ctx, "GET", "/admin/devices", nil, 0)
		if err != nil {
			return err
		}
		var devices []device
		if err := decodeResponse(res, &devices); err != nil {
			return err
		}
		for _, d := range devices {
			fmt.Printf("%s\t%s\t%s\t%s\n", d.Code, d.Status, d.Address, d.Name)
		}
	case "approve", "reject", "remove":
		res, err := conn.request(ctx, "POST", "/admin/devices/"+f.Arg(0)+"/"+command, nil, 0)
		if err != nil {
			return err
		}
		res.Body.Close()
	case "put":
		return putFiles(ctx, conn, f.Args(), dir, jobs)
	case "ls":
		res, err := conn.request(ctx, "GET", "/files?dir="+url.QueryEscape(dir), nil, 0)
		if err != nil {
			return err
		}
		var items []fileItem
		if err := decodeResponse(res, &items); err != nil {
			return err
		}
		for _, item := range items {
			if item.Directory {
				fmt.Printf("%s\t-\t%s/\n", item.ID, item.Path)
			} else {
				fmt.Printf("%s\t%d\t%s\n", item.ID, item.Size, item.Path)
			}
		}
	case "get":
		return getFile(ctx, conn, f.Arg(0), f.Arg(1))
	case "mkdir", "mv", "rm":
		method, target := "POST", "/folders?path="+url.QueryEscape(f.Arg(0))
		if command == "mv" {
			method = "PATCH"
			target = "/files/" + url.PathEscape(f.Arg(0)) + "?path=" + url.QueryEscape(f.Arg(1))
		}
		if command == "rm" {
			method = "DELETE"
			target = "/files/" + url.PathEscape(f.Arg(0))
			if recursive {
				target += "?recursive=1"
			}
		}
		res, err := conn.request(ctx, method, target, nil, 0)
		if err != nil {
			return err
		}
		return res.Body.Close()
	case "clip":
		if clipAction == "get" {
			res, err := conn.request(ctx, "GET", "/clip", nil, 0)
			if err != nil {
				return err
			}
			defer res.Body.Close()
			_, err = io.Copy(os.Stdout, res.Body)
			return err
		}
		res, err := conn.request(ctx, "PUT", "/clip", io.LimitReader(os.Stdin, maxTextBytes+1), -1)
		if err != nil {
			return err
		}
		return res.Body.Close()
	}
	return nil
}
