#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";

test("no vendored go sources under third_party/go", async () => {
  const root = process.cwd();
  const tp = path.join(root, "third_party", "go");
  if (!(await fs.pathExists(tp))) return; // ok
  const files: string[] = [];
  async function walk(dir: string) {
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    for (const n of names) {
      const p = path.join(dir, n);
      const st = await fs.stat(p).catch(() => null as any);
      if (!st) continue;
      if (st.isDirectory()) await walk(p);
      else files.push(p);
    }
  }
  await walk(tp);
  const offenders = files.filter((f) => f.endsWith(".go"));
  if (offenders.length > 0) {
    throw new Error(
      `found vendored Go sources under third_party/go — forbidden by PR3:\n` + offenders.join("\n"),
    );
  }
});
