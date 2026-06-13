#!/usr/bin/env zx-wrapper
import { getFlagBool, getFlagStr } from "../lib/cli";
import { generateInvalidationReport } from "./invalidation-report-lib";
import {
  DEFAULT_AUTO_MAP_PATH,
  DEFAULT_INVALIDATION_REPORT_PATH,
} from "../lib/workspace-state-paths";

async function main(): Promise<void> {
  await generateInvalidationReport({
    graphPath: getFlagStr("graph", ""),
    autoMapPath: getFlagStr("auto-map", DEFAULT_AUTO_MAP_PATH),
    outPath: getFlagStr("out", DEFAULT_INVALIDATION_REPORT_PATH),
    jsonOutPath: getFlagStr("json-out", ""),
    jsonOnly: getFlagBool("json-only"),
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
