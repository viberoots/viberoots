#!/usr/bin/env zx-wrapper
// tools/dev/clear-overrides.ts — Unsets Go and C++ dev overrides and prints their values.

const has = (v?: string) => Boolean(v && v.trim() !== "");

if (has(process.env.NIX_GO_DEV_OVERRIDE_JSON)) {
  delete process.env.NIX_GO_DEV_OVERRIDE_JSON;
}
if (has(process.env.NIX_CPP_DEV_OVERRIDE_JSON)) {
  delete process.env.NIX_CPP_DEV_OVERRIDE_JSON;
}

console.log(
  "NIX_GO_DEV_OVERRIDE_JSON=",
  JSON.stringify(process.env.NIX_GO_DEV_OVERRIDE_JSON || ""),
);
console.log(
  "NIX_CPP_DEV_OVERRIDE_JSON=",
  JSON.stringify(process.env.NIX_CPP_DEV_OVERRIDE_JSON || ""),
);
