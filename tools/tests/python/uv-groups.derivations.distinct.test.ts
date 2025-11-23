#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python uv groups: base vs dev/test produce distinct, stable derivations", async () => {
  await runInTemp("py-uv-groups", async (tmp, _$) => {
    const $ = _$
      ? _$
      : (cmd: TemplateStringsArray, ...args: any[]) => (global as any).$`${cmd}${args}`;

    // 1) Create a minimal Python importer with uv.lock
    const appName = "pyenv_demo";
    const appDir = path.join(tmp, "apps", appName);
    await fs.mkdirp(appDir);
    const lockText = ["# uv lock", "[[package]]", 'name = "foo"', 'version = "1.0.0"', ""].join(
      "\n",
    );
    await fs.writeFile(path.join(appDir, "uv.lock"), lockText, "utf8");

    // 2) Build base, dev, and test variants via flake outputs
    async function nixOut(attr: string): Promise<string> {
      const { stdout } = await $({
        cwd: tmp,
        stdio: "pipe",
        env: { ...process.env, NIX_PY_USE_STUB_BACKEND: "1" },
      })`nix build --impure --accept-flake-config --no-link --print-out-paths .#${attr}`;
      return String(stdout || "")
        .trim()
        .split(/\s+/)
        .pop() as string;
    }
    const attrBase = "py-apps-" + appName;
    const attrDev = "py-apps-" + appName + "-dev";
    const attrTest = "py-apps-" + appName + "-test";

    const base1 = await nixOut(attrBase);
    const dev1 = await nixOut(attrDev);
    const test1 = await nixOut(attrTest);

    if (!base1 || !dev1 || !test1) {
      console.error("missing outPath(s):", { base1, dev1, test1 });
      process.exit(2);
    }
    if (base1 === dev1 || base1 === test1 || dev1 === test1) {
      console.error("expected distinct out paths for groups", { base1, dev1, test1 });
      process.exit(2);
    }

    // 3) Re-build to confirm idempotency (store paths stable)
    const base2 = await nixOut(attrBase);
    const dev2 = await nixOut(attrDev);
    const test2 = await nixOut(attrTest);

    if (base1 !== base2 || dev1 !== dev2 || test1 !== test2) {
      console.error("non-idempotent build results", { base1, base2, dev1, dev2, test1, test2 });
      process.exit(2);
    }
  });
});
