#!/usr/bin/env zx-wrapper
import { runDevBuild } from "./dev-build/run-dev-build";
import { withRegisteredToolState } from "./registered-tool-state";

withRegisteredToolState("dev-build", runDevBuild).catch((e) => {
  console.error(e);
  process.exit(1);
});
