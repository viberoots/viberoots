#!/usr/bin/env zx-wrapper
import { run } from "./exporter/main.ts";

async function main() {
  await run();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
