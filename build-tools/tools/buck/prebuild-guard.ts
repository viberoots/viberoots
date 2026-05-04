#!/usr/bin/env zx-wrapper
import { run } from "./prebuild/main";

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
