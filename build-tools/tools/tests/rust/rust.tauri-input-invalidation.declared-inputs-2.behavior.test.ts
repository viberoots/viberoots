#!/usr/bin/env zx-wrapper
process.env.VBR_TAURI_INPUT_INVALIDATION_CASE = "declared-inputs-2";
await import("./rust.tauri-input-invalidation.behavior.test.ts");
