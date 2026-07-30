#!/usr/bin/env zx-wrapper
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runRustWatchEntrypoint } from "./rust-dev-watch";

const invoked = path.resolve(process.argv[1] || "");
if (invoked === fileURLToPath(import.meta.url)) {
  runRustWatchEntrypoint({ watchAll: true, eventPrefix: "tauri-watch" }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
