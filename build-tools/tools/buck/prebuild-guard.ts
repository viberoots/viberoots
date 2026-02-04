#!/usr/bin/env zx-wrapper
import { run } from "./prebuild/main.ts";

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
