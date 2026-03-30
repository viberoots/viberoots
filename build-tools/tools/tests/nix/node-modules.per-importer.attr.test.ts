#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

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
      | Record<string, { env?: Record<string, string>; inputDrvs?: Record<string, unknown> }>
      | {
          derivations?: Record<
            string,
            { env?: Record<string, string>; inputDrvs?: Record<string, unknown> }
          >;
        };
    const derivations =
      "derivations" in parsed && parsed.derivations && typeof parsed.derivations === "object"
        ? parsed.derivations
        : (parsed as Record<
            string,
            { env?: Record<string, string>; inputDrvs?: Record<string, unknown> }
          >);
    const allDrvs = Object.entries(derivations || {});
    const requestedDrv =
      derivations[drvPath] ||
      allDrvs.find(([key]) => key === drvPath || key.endsWith(path.basename(drvPath)))?.[1];
    const firstDrv =
      requestedDrv ||
      allDrvs.find(([, value]) => {
        const src = String(value?.env?.src || "").trim();
        return (
          src.startsWith("/nix/store/") &&
          Object.keys(value?.inputDrvs || {}).some((d) => d.includes("-importer-src-"))
        );
      })?.[1] ||
      allDrvs.find(([, value]) =>
        Object.keys(value?.inputDrvs || {}).some((d) => d.includes("-importer-src-")),
      )?.[1] ||
      allDrvs.find(([, value]) =>
        String(value?.env?.src || "")
          .trim()
          .startsWith("/nix/store/"),
      )?.[1] ||
      allDrvs[0]?.[1];
    const importerSrcOut = String(firstDrv?.env?.src || "").trim();
    assert.ok(importerSrcOut.startsWith("/nix/store/"), `unexpected src path: ${importerSrcOut}`);

    const snappedPackage = path.join(importerSrcOut, importer, "package.json");
    const snappedLock = path.join(importerSrcOut, importer, "pnpm-lock.yaml");
    await fsp.access(snappedPackage);
    await fsp.access(snappedLock);

    const pkgTxt = await fsp.readFile(snappedPackage, "utf8");
    assert.match(pkgTxt, /demo-untracked-snapshot/);
  });
});
