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
    const requestedDrv =
      derivations[drvPath] ||
      derivations[path.basename(drvPath)] ||
      Object.entries(derivations).find(
        ([key]) => key === drvPath || key.endsWith(path.basename(drvPath)),
      )?.[1];
    assert.ok(
      requestedDrv,
      `unable to find requested derivation in nix derivation show: ${drvPath}`,
    );

    const importerSrcDrvName = Object.keys(requestedDrv?.inputs?.drvs || {}).find((d) =>
      d.includes("-importer-src-"),
    );
    assert.ok(
      importerSrcDrvName,
      "expected node-modules derivation to depend on importer-src input",
    );

    const importerSrcDrvPath = importerSrcDrvName.startsWith("/nix/store/")
      ? importerSrcDrvName
      : path.join("/nix/store", importerSrcDrvName);
    const importerDrvShow = await $`nix derivation show ${importerSrcDrvPath}`;
    const importerDrvParsed = JSON.parse(String(importerDrvShow.stdout || "")) as
      | Record<string, { outputs?: { out?: { path?: string } } }>
      | { derivations?: Record<string, { outputs?: { out?: { path?: string } } }> };
    const importerDerivations = selectDerivationMap(importerDrvParsed as any);
    const importerDrv =
      importerDerivations[importerSrcDrvPath] ||
      importerDerivations[path.basename(importerSrcDrvPath)] ||
      Object.entries(importerDerivations).find(
        ([key]) => key === importerSrcDrvPath || key.endsWith(path.basename(importerSrcDrvPath)),
      )?.[1];
    const importerSrcOutRaw = String(importerDrv?.outputs?.out?.path || "").trim();
    const importerSrcOut = importerSrcOutRaw.startsWith("/nix/store/")
      ? importerSrcOutRaw
      : path.join("/nix/store", importerSrcOutRaw);
    assert.ok(
      importerSrcOut.startsWith("/nix/store/"),
      `unexpected importer-src output path: ${importerSrcOut}`,
    );

    await $`nix-store -r ${importerSrcDrvPath}`;

    const snappedPackageCandidates = [
      path.join(importerSrcOut, importer, "package.json"),
      path.join(importerSrcOut, "package.json"),
    ];
    const snappedLockCandidates = [
      path.join(importerSrcOut, importer, "pnpm-lock.yaml"),
      path.join(importerSrcOut, "pnpm-lock.yaml"),
    ];
    const resolvedPackage =
      (
        await Promise.all(
          snappedPackageCandidates.map(async (candidate) =>
            (await fsp
              .access(candidate)
              .then(() => true)
              .catch(() => false))
              ? candidate
              : "",
          ),
        )
      ).find(Boolean) || "";
    const resolvedLock =
      (
        await Promise.all(
          snappedLockCandidates.map(async (candidate) =>
            (await fsp
              .access(candidate)
              .then(() => true)
              .catch(() => false))
              ? candidate
              : "",
          ),
        )
      ).find(Boolean) || "";
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
