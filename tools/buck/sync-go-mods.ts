#!/usr/bin/env zx-wrapper

// Deprecated: Vendoring and synthetic third_party/go targets have been removed.
// PR3: We rely solely on Nix + gomod2nix for external modules. This script is a no-op
// kept for backwards compatibility to avoid breaking older flows that still invoke it.

console.log(
  "[sync-go-mods] deprecated; skipping vendoring and third_party/go TARGETS generation.\n" +
    "External modules are resolved by Nix per gomod2nix.toml; providers remain for invalidation/patch plumbing.",
);
process.exit(0);
