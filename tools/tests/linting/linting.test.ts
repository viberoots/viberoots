#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

describe("pre-commit hook (lint-staged with Prettier + ESLint)", () => {
  test("blocks commit on lint/format errors and allows commit when fixed", async () => {
    await runInTemp("linting", async (tmp, $) => {
      await $`git init`;
      await $`git config user.email tester@example.com`;
      await $`git config user.name Tester`;
      await $`git config core.hooksPath .husky`;
      await $`git add -A`;
      await $`git commit -m "chore: init"`;

      const badFile = path.join(tmp, "tools", "dev", "bad.ts");
      await fsp.mkdir(path.dirname(badFile), { recursive: true });
      await fsp.writeFile(badFile, `const x = ;\n`, "utf8");
      await $`git add ${path.relative(tmp, badFile)}`;

      let blocked = false;
      try {
        await $({ stdio: "pipe" })`git commit -m "feat: add bad file"`;
      } catch {
        blocked = true;
      }
      if (!blocked) {
        console.error("commit unexpectedly succeeded");
        process.exit(2);
      }

      await fsp.writeFile(badFile, `if (true) { console.log('ok'); }\n`, "utf8");
      await $`git add ${path.relative(tmp, badFile)}`;
      await $`git commit -m "style: fix lint issues"`;

      const fixed = await fsp.readFile(badFile, "utf8");
      if (!/if\s*\(\s*true\s*\)\s*\{[\s\S]*?console\.log\((['"])ok\1\);[\s\S]*?\}/m.test(fixed)) {
        console.error("file missing braces/log pattern");
        process.exit(2);
      }
    });
  });
});
