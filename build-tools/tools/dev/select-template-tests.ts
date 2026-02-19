#!/usr/bin/env zx-wrapper
import process from "node:process";
import { getFlagBool, getFlagList, getFlagStr } from "../lib/cli.ts";
import { resolveTemplateTestSelection } from "../lib/template-test-selector.ts";

async function main() {
  const root = getFlagStr("root", process.cwd());
  const changed = getFlagList("changed").map((p) => String(p).trim());
  const targetsOnly = getFlagBool("targets-only");
  const result = await resolveTemplateTestSelection({
    root,
    changedPaths: changed.length > 0 ? changed : undefined,
  });

  if (targetsOnly) {
    for (const target of result.targets) {
      console.log(target);
    }
    return;
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(String((e as any)?.stack || e));
  process.exit((e as any)?.exitCode || 1);
});
