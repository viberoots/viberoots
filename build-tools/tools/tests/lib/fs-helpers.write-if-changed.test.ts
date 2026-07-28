#!/usr/bin/env zx-wrapper
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { writeIfChanged } from "../../lib/fs-helpers";
import { runInTemp } from "../lib/test-helpers";

test("writeIfChanged: second write is no-op", async () => {
  await runInTemp("write-if-changed", async (tmp) => {
    const dst = path.join(tmp, "out.txt");
    const first = "hello\n";
    await writeIfChanged(dst, first);
    const out1 = createHash("sha256").update(first).digest("hex");
    await writeIfChanged(dst, first);
    const out2 = createHash("sha256")
      .update(await fs.readFile(dst))
      .digest("hex");
    if (out1 !== out2) {
      console.error("file hash changed despite identical content");
      process.exit(2);
    }
  });
});
