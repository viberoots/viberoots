#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";
import { runInTemp } from "../lib/test-helpers";

process.env.TEST_NEED_DEV_ENV = "1";

function commandOutput(err: unknown): string {
  const e = err as { message?: unknown; stdout?: unknown; stderr?: unknown };
  return [e?.message, e?.stdout, e?.stderr].map((x) => String(x || "")).join("\n");
}

function isTransientNixStoreError(err: unknown): boolean {
  const text = commandOutput(err);
  return /path '\/nix\/store\/[^']+' is not valid/.test(text) || /database is locked/.test(text);
}

async function retryTransientNixStoreError<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientNixStoreError(err) || attempt > 0) throw err;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw lastErr;
}

describe("pre-commit hook (lint-staged with Prettier + ESLint)", () => {
  test("blocks commit on lint/format errors and allows commit when fixed", async () => {
    await runInTemp("linting", async (tmp, $) => {
      const eslintBin = ensureNixStoreToolPathSync("eslint", process.env);
      const toolNodeModules = await fsp.realpath(path.dirname(path.dirname(eslintBin)));
      const fixture$ = $({
        cwd: tmp,
        env: {
          ...process.env,
          NODE_PATH: [toolNodeModules, process.env.NODE_PATH || ""]
            .filter(Boolean)
            .join(path.delimiter),
        },
      });
      await fixture$`git init`;
      await fixture$`git config user.email tester@example.com`;
      await fixture$`git config user.name Tester`;
      // Speed: avoid running pre-commit across the entire temp repo during the
      // initial commit. Configure hooks after the first commit so the test only
      // exercises the hook on the targeted commit(s) below.
      await fixture$`git add .buckroot .buckconfig .viberoots viberoots config toolchains`;
      await fixture$`git commit --allow-empty -m "chore: init"`;
      await fixture$`git config core.hooksPath viberoots/.husky`;

      const badFile = path.join(tmp, "viberoots", "build-tools", "tools", "dev", "bad.ts");
      await fsp.mkdir(path.dirname(badFile), { recursive: true });
      await fsp.writeFile(badFile, `const x = ;\n`, "utf8");
      await fixture$`git add ${path.relative(tmp, badFile)}`;

      let blocked = false;
      try {
        await fixture$({ stdio: "pipe" })`git commit -m "feat: add bad file"`;
      } catch {
        blocked = true;
      }
      if (!blocked) {
        console.error("commit unexpectedly succeeded");
        process.exit(2);
      }

      await fsp.writeFile(badFile, `if (true) { console.log('ok'); }\n`, "utf8");
      await fixture$`git add ${path.relative(tmp, badFile)}`;
      await retryTransientNixStoreError(
        async () => await fixture$`git commit -m "style: fix lint issues"`,
      );

      const fixed = await fsp.readFile(badFile, "utf8");
      if (!/if\s*\(\s*true\s*\)\s*\{[\s\S]*?console\.log\((['"])ok\1\);[\s\S]*?\}/m.test(fixed)) {
        console.error("file missing braces/log pattern");
        process.exit(2);
      }
    });
  });
});
