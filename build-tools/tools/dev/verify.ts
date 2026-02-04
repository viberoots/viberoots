#!/usr/bin/env zx-wrapper
import { runVerify } from "./verify/run-verify.ts";

runVerify().catch((e) => {
  console.error(String((e as any)?.stack || e));
  process.exit((e as any)?.exitCode || 1);
});
