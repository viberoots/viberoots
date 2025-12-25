#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patches-lint (node): json output preserves nonpatch message", async () => {
  await runInTemp("patches-lint-reg-node", async (tmp, $) => {
    const dir = path.join(tmp, "patches", "node");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "foo.txt"), "nope\n", "utf8");

    const res = await $({
      stdio: "pipe",
      nothrow: true,
    })`node tools/dev/patches-lint.ts --lang node --strict --format json`;

    const txt = String(res.stdout || "").trim();
    const json = JSON.parse(txt) as Array<any>;
    const v = json.find((e) => e && e.code === "nonpatch");
    if (!v) {
      console.error("expected nonpatch violation, got:", json);
      process.exit(2);
    }
    if (v.message !== "[node] non-patch file in patches/node: foo.txt") {
      console.error("unexpected message:", v.message);
      process.exit(2);
    }
  });
});
