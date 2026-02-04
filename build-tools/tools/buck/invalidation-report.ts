#!/usr/bin/env zx-wrapper
import { getFlagBool, getFlagStr } from "../lib/cli.ts";
import { generateInvalidationReport } from "./invalidation-report-lib.ts";

async function main(): Promise<void> {
  await generateInvalidationReport({
    graphPath: getFlagStr("graph", ""),
    autoMapPath: getFlagStr("auto-map", "third_party/providers/auto_map.bzl"),
    outPath: getFlagStr("out", "build-tools/tools/buck/invalidation-report.txt"),
    jsonOutPath: getFlagStr("json-out", ""),
    jsonOnly: getFlagBool("json-only"),
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
