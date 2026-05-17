#!/usr/bin/env zx-wrapper
import { getArgvTokens } from "../lib/argv";
import { runSprinkleRefCli } from "./sprinkleref-cli";

await runSprinkleRefCli({ argv: getArgvTokens() }).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  const exitCode =
    error && typeof error === "object" && "exitCode" in error
      ? Number((error as { exitCode?: unknown }).exitCode)
      : 1;
  process.exit(Number.isFinite(exitCode) ? exitCode : 1);
});
