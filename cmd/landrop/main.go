package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"landrop/internal/landrop"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := landrop.Run(ctx, os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "LanDrop:", err)
		os.Exit(1)
	}
}
