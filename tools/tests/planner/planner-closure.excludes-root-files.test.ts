#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

// PR1 closure test: ensure that content written to a root-only file does not
// appear anywhere under the materialized graph outputs, as a proxy that the
// filtered srcRoot (apps/libs only) excludes root files from the closure.

test("planner: root-only files are excluded from materialized outputs", async () => {
  await runInTemp("planner-closure-excludes-root", async (tmp, $) => {
    // Create a unique sentinel at repo root
    const sentinelTxt = `SENTINEL-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await fsp.writeFile(path.join(tmp, "ONLY_AT_REPO_ROOT.txt"), sentinelTxt + "\n", "utf8");

    // Scaffold a small CLI app under apps/
    await $`scaf new go cli demo-cli --yes --path=apps/demo-cli`;
    await $({ cwd: path.join(tmp, "apps", "demo-cli"), stdio: "inherit" })`go mod tidy`;
    await $({ cwd: tmp, stdio: "inherit" })`tools/bin/gomod2nix --dir apps/demo-cli`;
    await fsp.copyFile(
      path.join(tmp, "apps", "demo-cli", "gomod2nix.toml"),
      path.join(tmp, "gomod2nix.toml"),
    );

    // Glue + build
    await $`tools/dev/install-deps.ts --glue-only`;
    const outLink = `buck-go-${Date.now()}`;
    await $({ cwd: tmp, stdio: "inherit" })`nix build .#graph-generator --out-link ${outLink}`;

    // Walk the outLink tree and ensure sentinel is absent from files
    const root = path.join(tmp, outLink);
    async function listFilesRec(dir: string): Promise<string[]> {
      const out: string[] = [];
      const stack: string[] = [dir];
      while (stack.length) {
        const cur = stack.pop()!;
        let names: string[] = [];
        try {
          names = await fsp.readdir(cur);
        } catch {
          continue;
        }
        for (const name of names) {
          const p = path.join(cur, name);
          try {
            const st = await fsp.stat(p);
            if (st.isDirectory()) stack.push(p);
            else if (st.isFile()) out.push(p);
          } catch {}
        }
      }
      return out;
    }
    const files = await listFilesRec(root);
    for (const f of files) {
      // Reasonable size cap to avoid reading large binaries; sentinel is small
      let ok = false;
      try {
        const buf = await fsp.readFile(f, "utf8");
        ok = !buf.includes(sentinelTxt);
      } catch {
        ok = true; // binary or unreadable; assume sentinel absent
      }
      if (!ok) {
        console.error("found sentinel content in materialized output:", f);
        process.exit(2);
      }
    }
  });
});
