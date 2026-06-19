#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("runBuckCommand defaults to direct stderr (no process-substitution hang risk)", async () => {
  const txt = await fsp.readFile("viberoots/build-tools/tools/dev/dev-build/buck.ts", "utf8");
  if (
    !txt.includes(
      'const useStderrFilter = String(process.env.BUCK_STDERR_FILTER || "").trim() === "1";',
    )
  ) {
    throw new Error("buck.ts must support optional stderr filtering toggle");
  }
  if (!txt.includes("const cmd = useStderrFilter")) {
    throw new Error("buck.ts must choose command form based on filter toggle");
  }
  if (!txt.includes("Default to direct stderr passthrough")) {
    throw new Error("buck.ts must document why process-substitution is disabled by default");
  }
});
