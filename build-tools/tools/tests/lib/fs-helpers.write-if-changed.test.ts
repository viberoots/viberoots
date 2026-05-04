#!/usr/bin/env zx-wrapper
import path from "node:path";
import { test } from "node:test";
import { writeIfChanged } from "../../lib/fs-helpers";
import { runInTemp } from "../lib/test-helpers";

test("writeIfChanged: second write is no-op", async () => {
  await runInTemp("write-if-changed", async (tmp, $) => {
    const dst = path.join(tmp, "out.txt");
    const first = "hello\n";
    await writeIfChanged(dst, first);
    const h1 = await $({ cwd: tmp, stdio: "pipe" })`shasum -a 256 ${dst}`;
    const out1 = String(h1.stdout || "");
    await writeIfChanged(dst, first);
    const h2 = await $({ cwd: tmp, stdio: "pipe" })`shasum -a 256 ${dst}`;
    const out2 = String(h2.stdout || "");
    if (out1.split(" ")[0] !== out2.split(" ")[0]) {
      console.error("file hash changed despite identical content");
      process.exit(2);
    }
  });
});
