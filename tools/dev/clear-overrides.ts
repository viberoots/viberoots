#!/usr/bin/env zx-wrapper
// tools/dev/clear-overrides.ts — Unsets dev overrides and prints the current (empty) value.
if (process.env.NIX_GO_DEV_OVERRIDE_JSON && process.env.NIX_GO_DEV_OVERRIDE_JSON.trim() !== "") {
  delete process.env.NIX_GO_DEV_OVERRIDE_JSON;
}
console.log(
  "NIX_GO_DEV_OVERRIDE_JSON=",
  JSON.stringify(process.env.NIX_GO_DEV_OVERRIDE_JSON || ""),
);
