#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { buildToolPath } from "../../dev/dev-build/paths";

test("zx-init resolves extensionless dotted TypeScript helper modules", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "zx-init-dotted-helper-"));
  const entry = path.join(dir, "entry.ts");
  const helper = path.join(dir, "local.fixture.ts");
  try {
    await fsp.writeFile(helper, "export const value = 42;\n", "utf8");
    await fsp.writeFile(
      entry,
      [
        'import assert from "node:assert/strict";',
        'import { value } from "./local.fixture";',
        "assert.equal(value, 42);",
        "",
      ].join("\n"),
      "utf8",
    );
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "--import",
        buildToolPath(process.cwd(), "tools/dev/zx-init.mjs"),
        entry,
      ],
      { cwd: process.cwd(), env: process.env, stdio: "ignore" },
    );
    const code = await new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (value) => resolve(typeof value === "number" ? value : 1));
    });
    assert.equal(code, 0);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
