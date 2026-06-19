#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patches-lint (go): json output preserves filename_shape message", async () => {
  await runInTemp("patches-lint-reg-go", async (tmp, $) => {
    const dir = path.join(tmp, "patches", "go");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "missing-at-separator.patch"), "# bad\n", "utf8");

    const res = await $({
      stdio: "pipe",
      nothrow: true,
    })`node viberoots/build-tools/tools/dev/patches-lint.ts --lang go --strict --format json`;

    const txt = String(res.stdout || "").trim();
    const json = JSON.parse(txt) as Array<any>;
    const v = json.find((e) => e && e.code === "filename_shape");
    if (!v) {
      console.error("expected filename_shape violation, got:", json);
      process.exit(2);
    }
    if (v.message !== "[go] invalid filename (missing @): missing-at-separator.patch") {
      console.error("unexpected message:", v.message);
      process.exit(2);
    }
  });
});
