#!/usr/bin/env zx-wrapper
import { getArgvTokens } from "../lib/argv";
import { runSprinkleRefCli } from "./sprinkleref-cli";

await runSprinkleRefCli({ argv: getArgvTokens() }).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
