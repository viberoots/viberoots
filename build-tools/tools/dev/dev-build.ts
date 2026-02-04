#!/usr/bin/env zx-wrapper
import { runDevBuild } from "./dev-build/run-dev-build.ts";

runDevBuild().catch((e) => {
  console.error(e);
  process.exit(1);
});
