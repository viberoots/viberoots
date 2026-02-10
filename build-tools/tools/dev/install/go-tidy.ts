#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function runGoModTidyForMissingSum(
  root: string,
  dryRun: boolean,
  verbose: boolean,
): Promise<void> {
  const bases = [".", path.join("projects", "apps"), path.join("projects", "libs")];
  for (const base of bases) {
    const baseAbs = path.join(root, base);
    let entries: string[] = [];
    try {
      entries = await fsp.readdir(baseAbs).catch(() => [] as string[]);
    } catch {}

    if (base === ".") {
      const hasRootMod = await fsp
        .access(path.join(baseAbs, "go.mod"))
        .then(() => true)
        .catch(() => false);
      const hasRootSum = await fsp
        .access(path.join(baseAbs, "go.sum"))
        .then(() => true)
        .catch(() => false);
      if (hasRootMod && !hasRootSum) {
        if (dryRun) {
          console.log(`[go] dry-run: (missing go.sum) in .: go mod tidy (isolated)`);
        } else {
          if (verbose) console.log(`[go] go mod tidy (isolated) for .`);
          const tmpTidy = await fsp.mkdtemp(path.join(os.tmpdir(), "go-tidy-"));
          try {
            await fsp.copyFile(path.join(baseAbs, "go.mod"), path.join(tmpTidy, "go.mod"));
            await $({ cwd: tmpTidy, stdio: "inherit" })`go mod tidy`;
            const tmpSum = path.join(tmpTidy, "go.sum");
            const exists = await fsp
              .access(tmpSum)
              .then(() => true)
              .catch(() => false);
            if (exists) {
              await fsp.copyFile(tmpSum, path.join(baseAbs, "go.sum"));
            } else {
              await fsp.writeFile(path.join(baseAbs, "go.sum"), "", "utf8");
            }
          } finally {
            await fsp.rm(tmpTidy, { recursive: true, force: true }).catch(() => {});
          }
        }
      }
    }

    for (const d of entries) {
      const dir = path.join(baseAbs, d);
      try {
        const st = await fsp.stat(dir);
        if (!st.isDirectory()) continue;
      } catch {
        continue;
      }
      const hasMod = await fsp
        .access(path.join(dir, "go.mod"))
        .then(() => true)
        .catch(() => false);
      const hasSum = await fsp
        .access(path.join(dir, "go.sum"))
        .then(() => true)
        .catch(() => false);
      if (!hasMod || hasSum) continue;
      const rel = path.relative(root, dir) || ".";
      if (dryRun) {
        console.log(`[go] dry-run: (missing go.sum) in ${rel}: go mod tidy`);
      } else {
        if (verbose) console.log(`[go] go mod tidy in ${rel}`);
        await $({ cwd: dir, stdio: "inherit" })`go mod tidy`;
      }
    }
  }
}
