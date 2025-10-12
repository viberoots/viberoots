#!/usr/bin/env zx-wrapper
// tools/dev/clear-overrides-cpp.ts — unsets C++ dev override env and prints the value
if (process.env.NIX_CPP_DEV_OVERRIDE_JSON && process.env.NIX_CPP_DEV_OVERRIDE_JSON.trim() !== "") {
  delete process.env.NIX_CPP_DEV_OVERRIDE_JSON;
}
console.log(
  "NIX_CPP_DEV_OVERRIDE_JSON=",
  JSON.stringify(process.env.NIX_CPP_DEV_OVERRIDE_JSON || ""),
);
