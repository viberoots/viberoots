#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("writeStamp is deterministic and orders inputs by path", async () => {
  await runInTemp("fs-helpers-write-stamp", async (tmp) => {
    const stamp = path.join(tmp, "out.stamp");
    const a = path.join(tmp, "a.txt");
    const b = path.join(tmp, "b.txt");
    await fs.outputFile(b, "B", "utf8");
    await fs.outputFile(a, "A", "utf8");

    const { writeStamp } = await import("../../lib/fs-helpers");
    await writeStamp(stamp, [{ path: b }, { path: a }]);
    const first = await fs.readFile(stamp, "utf8");

    // Re-run with reversed order and an explicit content override; expect identical output
    await writeStamp(stamp, [{ path: a }, { path: b, content: "B" }]);
    const second = await fs.readFile(stamp, "utf8");

    if (first !== second) {
      console.error("writeStamp output changed across runs; expected deterministic content");
      process.exit(2);
    }

    // Ensure path markers appear in sorted order
    const idxA = first.indexOf(`# path=${a}`);
    const idxB = first.indexOf(`# path=${b}`);
    if (!(idxA >= 0 && idxB >= 0 && idxA < idxB)) {
      console.error("expected paths to be ordered lexicographically in stamp file");
      process.exit(2);
    }
  });
});
