#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

function selectDerivationMap(
  parsed:
    | Record<string, { env?: Record<string, string>; inputs?: { drvs?: Record<string, unknown> } }>
    | {
        derivations?: Record<
          string,
          { env?: Record<string, string>; inputs?: { drvs?: Record<string, unknown> } }
        >;
      },
): Record<string, { env?: Record<string, string>; inputs?: { drvs?: Record<string, unknown> } }> {
  return "derivations" in parsed && parsed.derivations && typeof parsed.derivations === "object"
    ? parsed.derivations
    : (parsed as Record<
        string,
        { env?: Record<string, string>; inputs?: { drvs?: Record<string, unknown> } }
      >);
}

async function existingPath(candidates: string[]): Promise<string> {
  for (const candidate of candidates) {
    try {
      await fsp.access(candidate);
      return candidate;
    } catch {}
  }
  return "";
}

async function ensureRealizedStorePath(storePath: string, $: any): Promise<void> {
  if (!storePath.startsWith("/nix/store/")) return;
  try {
    await fsp.access(storePath);
    return;
  } catch {}
  const deriver = await $({
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`nix-store -q --deriver ${storePath}`;
  const deriverPath = String(deriver.stdout || "").trim();
  if (deriver.exitCode === 0 && deriverPath && deriverPath !== "unknown-deriver") {
    await $`nix-store -r ${deriverPath}`;
    return;
  }
}

function derivationOutputPaths(
  drv: { outputs?: Record<string, { path?: string }> } | undefined,
): string[] {
  return Object.values(drv?.outputs || {})
    .map((output) => String(output?.path || "").trim())
    .filter(Boolean)
    .map((outputPath) =>
      outputPath.startsWith("/nix/store/") ? outputPath : path.join("/nix/store", outputPath),
    );
}

async function realizedDerivationOutputPaths(drvPath: string, $: any): Promise<string[]> {
  const out = await $({
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`nix-store -q --outputs ${drvPath}`;
  if (out.exitCode !== 0) return [];
  return String(out.stdout || "")
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function derivationReferences(drvPath: string, $: any): Promise<string[]> {
  const out = await $({
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`nix-store -q --references ${drvPath}`;
  if (out.exitCode !== 0) return [];
  return String(out.stdout || "")
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function nixStoreNameStem(storePath: string): string {
  const base = path.basename(storePath.trim());
  return base.replace(/^[^-]+-/, "");
}

function findDerivationByKey<T extends object>(
  derivations: Record<string, T>,
  drvPath: string,
): T | undefined {
  return (
    derivations[drvPath] ||
    derivations[path.basename(drvPath)] ||
    Object.entries(derivations).find(
      ([key]) => key === drvPath || key.endsWith(path.basename(drvPath)),
    )?.[1]
  );
}

async function recursiveImporterFileCandidates(
  root: string,
  importer: string,
  fileName: string,
): Promise<string[]> {
  const importerBase = path.basename(importer);
  const matches: string[] = [];
  const queue = [{ dir: root, depth: 0 }];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (seen.has(current.dir)) continue;
    seen.add(current.dir);
    let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
    try {
      entries = await fsp.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < 5) queue.push({ dir: full, depth: current.depth + 1 });
        continue;
      }
      if (entry.name !== fileName) continue;
      if (
        full.endsWith(path.join(importer, fileName)) ||
        full.endsWith(path.join(importerBase, fileName))
      ) {
        matches.push(full);
      }
    }
  }
  return matches;
}

test("nix packages expose per-importer node-modules attr for untracked importer under WORKSPACE_ROOT", async () => {
  await runInTemp("node-modules-per-importer-attr", async (tmp, _$) => {
    const importer = "projects/apps/demo-untracked";
    const attr = "projects-apps-demo-untracked";
    const importerAbs = path.join(tmp, "projects", "apps", "demo-untracked");

    await fsp.mkdir(importerAbs, { recursive: true });
    await fsp.writeFile(
      path.join(importerAbs, "package.json"),
      JSON.stringify(
        {
          name: "demo-untracked",
          private: true,
          version: "0.0.0",
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(importerAbs, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
      "utf8",
    );

    const $ = _$({ cwd: tmp, stdio: "pipe" });
    const flakeRef = `path:${tmp}`;
    const cmd = `nix eval --raw "${flakeRef}#node-modules.${attr}.outPath" --accept-flake-config`;
    const out = await $`bash --noprofile --norc -c ${cmd}`;
    const outPath = String(out.stdout || "").trim();

    assert.ok(outPath.length > 0, `expected non-empty outPath for importer ${importer}`);
  });
});

test("node-modules derivation snapshots untracked importer files", async () => {
  await runInTemp("node-modules-importer-snapshot", async (tmp, _$) => {
    const importer = "projects/apps/demo-untracked-snapshot";
    const attr = "projects-apps-demo-untracked-snapshot";
    const importerAbs = path.join(tmp, "projects", "apps", "demo-untracked-snapshot");

    await fsp.mkdir(importerAbs, { recursive: true });
    await fsp.writeFile(
      path.join(importerAbs, "package.json"),
      JSON.stringify(
        {
          name: "demo-untracked-snapshot",
          private: true,
          version: "0.0.0",
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(importerAbs, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
      "utf8",
    );

    const $ = _$({ cwd: tmp, stdio: "pipe" });
    const flakeRef = `path:${tmp}`;
    const drvCmd = `nix eval --raw "${flakeRef}#node-modules.${attr}.drvPath" --accept-flake-config`;
    const drvRes = await $`bash --noprofile --norc -c ${drvCmd}`;
    const drvPath = String(drvRes.stdout || "").trim();
    assert.ok(drvPath.endsWith(".drv"), `expected drvPath, got: ${drvPath}`);

    const show = await $`nix derivation show ${drvPath}`;
    const parsed = JSON.parse(String(show.stdout || "")) as
      | Record<
          string,
          { env?: Record<string, string>; inputs?: { drvs?: Record<string, unknown> } }
        >
      | {
          derivations?: Record<
            string,
            { env?: Record<string, string>; inputs?: { drvs?: Record<string, unknown> } }
          >;
        };
    const derivations = selectDerivationMap(parsed);
    const requestedDrv = findDerivationByKey(derivations, drvPath);
    assert.ok(
      requestedDrv,
      `unable to find requested derivation in nix derivation show: ${drvPath}`,
    );

    const importerSrcDrvName = Object.keys(requestedDrv?.inputs?.drvs || {}).find((d) =>
      d.includes("-importer-src-"),
    );
    const importerSrcEnv = String(requestedDrv?.env?.src || "").trim();
    const inputDrvPaths = Object.keys(requestedDrv?.inputs?.drvs || {}).map((drv) =>
      drv.startsWith("/nix/store/") ? drv : path.join("/nix/store", drv),
    );
    const referencedDrvPaths = (await derivationReferences(drvPath, $)).filter((ref) =>
      ref.endsWith(".drv"),
    );
    const candidateImporterSrcDrvPaths = Array.from(
      new Set(
        [...inputDrvPaths, ...referencedDrvPaths].filter((candidate) =>
          candidate.includes("-importer-src-"),
        ),
      ),
    );
    let importerSrcOut = "";
    const snapshotRoots = new Set<string>();

    if (importerSrcDrvName || candidateImporterSrcDrvPaths.length > 0) {
      const importerSrcDrvPath =
        candidateImporterSrcDrvPaths[0] ||
        (importerSrcDrvName!.startsWith("/nix/store/")
          ? importerSrcDrvName!
          : path.join("/nix/store", importerSrcDrvName!));
      const importerDrvShow = await $`nix derivation show ${importerSrcDrvPath}`;
      const importerDrvParsed = JSON.parse(String(importerDrvShow.stdout || "")) as
        | Record<string, { outputs?: { out?: { path?: string } } }>
        | { derivations?: Record<string, { outputs?: { out?: { path?: string } } }> };
      const importerDerivations = selectDerivationMap(importerDrvParsed as any);
      const importerDrv = findDerivationByKey(importerDerivations, importerSrcDrvPath);
      await $`nix-store -r ${importerSrcDrvPath}`;
      const realizedOutputs = await realizedDerivationOutputPaths(importerSrcDrvPath, $);
      realizedOutputs.forEach((output) => snapshotRoots.add(output));
      importerSrcOut = realizedOutputs[0] || derivationOutputPaths(importerDrv)[0] || "";
    } else if (importerSrcEnv) {
      importerSrcOut = importerSrcEnv.startsWith("/nix/store/")
        ? importerSrcEnv
        : path.join("/nix/store", importerSrcEnv);
      for (const inputDrvPath of inputDrvPaths) {
        const inputDrvShow = await $({
          stdio: "pipe",
          reject: false,
          nothrow: true,
        })`nix derivation show ${inputDrvPath}`;
        if (inputDrvShow.exitCode !== 0) continue;
        const inputDrvParsed = JSON.parse(String(inputDrvShow.stdout || "")) as
          | Record<string, { outputs?: { out?: { path?: string } } }>
          | { derivations?: Record<string, { outputs?: { out?: { path?: string } } }> };
        const inputDerivations = selectDerivationMap(inputDrvParsed as any);
        const inputDrv = findDerivationByKey(inputDerivations, inputDrvPath);
        const inputOuts = derivationOutputPaths(inputDrv);
        const envStem = nixStoreNameStem(importerSrcOut);
        const matchedIndex = inputOuts.findIndex(
          (outputPath) => outputPath === importerSrcOut || nixStoreNameStem(outputPath) === envStem,
        );
        const isImporterSrcInput =
          inputDrvPath.includes("-importer-src-") ||
          inputOuts.some((outputPath) => nixStoreNameStem(outputPath).includes("importer-src-"));
        if (matchedIndex === -1 && !isImporterSrcInput) continue;
        await $`nix-store -r ${inputDrvPath}`;
        const realizedOutputs = await realizedDerivationOutputPaths(inputDrvPath, $);
        realizedOutputs.forEach((output) => snapshotRoots.add(output));
        if (matchedIndex !== -1) {
          importerSrcOut = realizedOutputs[matchedIndex] || realizedOutputs[0] || importerSrcOut;
        } else if (!importerSrcOut || !importerSrcOut.startsWith("/nix/store/")) {
          importerSrcOut = realizedOutputs[0] || importerSrcOut;
        }
      }
    }

    await ensureRealizedStorePath(importerSrcOut, $);
    if (importerSrcOut.startsWith("/nix/store/")) {
      try {
        await fsp.access(importerSrcOut);
        snapshotRoots.add(importerSrcOut);
      } catch {}
    }

    assert.ok(
      importerSrcOut.startsWith("/nix/store/"),
      `expected importer-src input or env.src store path, got: ${importerSrcOut || "<empty>"}`,
    );

    const snappedPackageCandidates = (
      await Promise.all(
        Array.from(snapshotRoots).map(async (root) => [
          path.join(root, importer, "package.json"),
          path.join(root, "package.json"),
          ...(await recursiveImporterFileCandidates(root, importer, "package.json")),
        ]),
      )
    ).flat();
    const snappedLockCandidates = (
      await Promise.all(
        Array.from(snapshotRoots).map(async (root) => [
          path.join(root, importer, "pnpm-lock.yaml"),
          path.join(root, "pnpm-lock.yaml"),
          ...(await recursiveImporterFileCandidates(root, importer, "pnpm-lock.yaml")),
        ]),
      )
    ).flat();
    const resolvedPackage = await existingPath(snappedPackageCandidates);
    const resolvedLock = await existingPath(snappedLockCandidates);
    assert.ok(
      resolvedPackage,
      `expected package.json in importer-src output under one of: ${snappedPackageCandidates.join(", ")}`,
    );
    assert.ok(
      resolvedLock,
      `expected pnpm-lock.yaml in importer-src output under one of: ${snappedLockCandidates.join(", ")}`,
    );
    const pkgTxt = await fsp.readFile(resolvedPackage, "utf8");
    assert.match(pkgTxt, /demo-untracked-snapshot/);
  });
});
