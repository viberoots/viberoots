#!/usr/bin/env zx-wrapper
import { main } from "./install/deps-main.ts";

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
