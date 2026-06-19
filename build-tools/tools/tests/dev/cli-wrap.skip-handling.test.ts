#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cli-wrap treats SkipError as exit 0 and prints [skip]", async () => {
  await runInTemp("cli-wrap-skip", async (tmp, $) => {
    const script = [
      "#!/usr/bin/env zx-wrapper",
      "import { runMain, SkipError } from '../lib/cli-wrap';",
      "await runMain(async () => {",
      "  throw new SkipError('not-applicable', 'demo');",
      "});",
      "",
    ].join("\n");
    const p = path.join(tmp, "viberoots/build-tools/tools/dev/demo-skip.ts");
    await fs.outputFile(p, script, "utf8");
    const res = await $({ cwd: tmp, stdio: "pipe" })`node ${p}`;
    const out = String(res.stderr || res.stdout || "");
    assert.match(out, /\[skip\]/);
  });
});
