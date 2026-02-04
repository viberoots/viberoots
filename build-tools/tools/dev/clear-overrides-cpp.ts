#!/usr/bin/env zx-wrapper
// Deprecated shim: invoke the unified clear-overrides script
import path from "node:path";
const p = path.resolve("build-tools/tools/dev/clear-overrides.ts");
await $`node ${p}`;
