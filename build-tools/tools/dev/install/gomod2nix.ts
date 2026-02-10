#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(file: string): Promise<string> {
  const crypto = await import("node:crypto");
  const h = crypto.createHash("sha256");
  try {
    const buf = await fsp.readFile(file);
    h.update(buf);
    return h.digest("hex");
  } catch {
    return "";
  }
}

async function fileMtimeMs(p: string): Promise<number> {
  try {
    const st = await fsp.stat(p);
    return Number(st.mtimeMs || 0);
  } catch {
    return 0;
  }
}

async function needsGomod2nixRefresh(dir: string): Promise<boolean> {
  const mod = path.join(dir, "go.mod");
  const sum = path.join(dir, "go.sum");
  const out = path.join(dir, "gomod2nix.toml");
  const modM = await fileMtimeMs(mod);
  const sumM = await fileMtimeMs(sum);
  const outM = await fileMtimeMs(out);
  if (!outM) return true;
  const srcM = Math.max(modM, sumM);
  return srcM > outM;
}

export async function runGomod2nixGenerate(dryRun: boolean, verbose: boolean) {
  await runGomod2nixGenerateIn(process.cwd(), dryRun, verbose);
}

export async function runGomod2nixGenerateIn(dir: string, dryRun: boolean, verbose: boolean) {
  const hasGoMod = await exists(path.join(dir, "go.mod"));
  const hasGoSum = await exists(path.join(dir, "go.sum"));
  if (!hasGoMod && !hasGoSum) {
    // Always emit a clear skip message (tests depend on exact phrasing)
    console.log(`[gomod2nix] skip: no go.mod or go.sum present`);
    return;
  }

  // Respect dry-run before enforcing go.sum presence
  const binOverride =
    process.env.INSTALL_DEPS_GOMOD2NIX_BIN ||
    path.join(process.cwd(), "build-tools", "tools", "bin", "gomod2nix");
  const cmd = `${binOverride} --dir .`;
  const timeoutSec = Math.max(
    1,
    Number.parseInt(String(process.env.INSTALL_DEPS_GOMOD_TIMEOUT || "600"), 10) || 600,
  );
  if (dryRun) {
    // Always emit a concise dry-run command line (tests depend on exact prefix)
    console.log(`[gomod2nix] dry-run: ${cmd}`);
    return;
  }

  // If go.mod exists but go.sum is missing, avoid attempting generation which may hang
  // on network resolution; prefer pre-existing gomod2nix.toml or skip.
  if (hasGoMod && !hasGoSum) {
    console.error(
      `[gomod2nix] error: go.sum missing in ${path.relative(process.cwd(), dir) || "."}; run 'build-tools/tools/dev/install-deps.ts' (or pass --skip-go-tidy to skip)`,
    );
    process.exit(2);
  }

  let goModTxt = "";
  try {
    goModTxt = await fsp.readFile(path.join(dir, "go.mod"), "utf8");
  } catch {}
  const strippedGoMod = String(goModTxt || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s*\/\/.*$/, ""))
    .join("\n");
  const hasDeps = /^\s*(require|replace)\s*(\(|\S)/m.test(strippedGoMod);
  if (!hasDeps) {
    const dst = path.join(dir, "gomod2nix.toml");
    const minimal = "schema = 3\n\n[mod]\n";
    const cur = (await exists(dst)) ? await fsp.readFile(dst, "utf8") : "";
    if (cur !== minimal) {
      await fsp.writeFile(dst, minimal, "utf8");
      console.log(`[gomod2nix] updated ${path.relative(process.cwd(), dst)}`);
    } else if (verbose) {
      console.log(`[gomod2nix] no changes: ${path.relative(process.cwd(), dst)}`);
    }
    return;
  }

  const beforeHash = await sha256File(path.join(dir, "gomod2nix.toml"));
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "gomod2nix-"));
  try {
    if (hasGoMod) await fsp.copyFile(path.join(dir, "go.mod"), path.join(tmp, "go.mod"));
    if (hasGoSum) await fsp.copyFile(path.join(dir, "go.sum"), path.join(tmp, "go.sum"));
    console.log(`[gomod2nix] running in ${tmp} for ${path.relative(process.cwd(), dir) || "."}`);
    // Log effective env relevant to network behavior
    try {
      const gp = process.env.GOPROXY || "";
      const gs = process.env.GOSUMDB || "";
      const gc = process.env.GOMODCACHE || "";
      if (verbose)
        console.log(
          `[gomod2nix] env GOPROXY=${gp || "(default)"} GOSUMDB=${
            gs || "(default)"
          } GOMODCACHE=${gc || "(default)"}`,
        );
    } catch {}
    // Optional quick preflight: detect obvious connectivity issues without failing the run
    try {
      await $({
        cwd: tmp,
        stdio: "pipe",
      })`bash --noprofile --norc -lc ${`if command -v curl >/dev/null 2>&1; then timeout 3 curl -sSfI https://proxy.golang.org/ >/dev/null && echo "[gomod2nix] preflight: proxy.golang.org OK" || echo "[gomod2nix] preflight: proxy.golang.org unreachable"; else echo "[gomod2nix] preflight: curl not found"; fi`}`;
    } catch {}
    // Use timeout if present; otherwise run directly to support minimal shells
    let ran = false;
    let tmpOut = path.join(tmp, "gomod2nix.toml");
    try {
      await $({
        cwd: tmp,
        stdio: "inherit",
      })`bash --noprofile --norc -lc ${`if command -v timeout >/dev/null 2>&1; then timeout ${timeoutSec} ${cmd}; else ${cmd}; fi`}`;
      ran = true;
    } catch {
      ran = false;
    }
    tmpOut = path.join(tmp, "gomod2nix.toml");
    const tmpExists = await exists(tmpOut);
    const dst = path.join(dir, "gomod2nix.toml");
    if (!tmpExists) {
      console.error("[gomod2nix] error: primary path did not produce gomod2nix.toml");
      process.exit(3);
    }
    const next = await fsp.readFile(tmpOut, "utf8");
    const cur = (await exists(dst)) ? await fsp.readFile(dst, "utf8") : "";
    if (cur !== next) {
      await fsp.writeFile(dst, next, "utf8");
      console.log(`[gomod2nix] updated ${path.relative(process.cwd(), dst)}`);
    } else if (verbose) {
      console.log(`[gomod2nix] no changes: ${path.relative(process.cwd(), dst)}`);
    }
  } finally {
    try {
      await fsp.rm(tmp, { recursive: true, force: true });
    } catch {}
  }
  const afterHash = await sha256File(path.join(dir, "gomod2nix.toml"));
  if (verbose)
    console.log(
      `[gomod2nix] hash (${path.relative(process.cwd(), dir)}): ${afterHash || "(none)"}`,
    );
}

export async function runGomod2nixScanAll(dryRun: boolean, verbose: boolean) {
  // Scan for go.mod+go.sum under projects/apps/* and projects/libs/* and generate per-module gomod2nix.toml
  const roots = [
    path.join(process.cwd(), "projects", "apps"),
    path.join(process.cwd(), "projects", "libs"),
  ];
  const dirs: string[] = [];
  for (const r of roots) {
    try {
      const entries = await fsp.readdir(r, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) {
          const d = path.join(r, e.name);
          const hasMod = await exists(path.join(d, "go.mod"));
          const hasSum = await exists(path.join(d, "go.sum"));
          if (hasMod && hasSum) dirs.push(d);
        }
      }
    } catch {}
  }
  for (const d of dirs) {
    const refresh = await needsGomod2nixRefresh(d);
    if (!refresh) {
      if (verbose) console.log(`[gomod2nix] up-to-date: ${path.relative(process.cwd(), d) || "."}`);
      continue;
    }
    await runGomod2nixGenerateIn(d, dryRun, verbose);
  }
}
