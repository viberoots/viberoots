#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_TEMP_REPO_GLUE_STAGE_PATHS,
  stageTempRepoPaths,
} from "../../lib/test-helpers/git-stage";
import { esbuildPackageName } from "./wasm-watch";

export async function ensureNodeModulesForDevApp(opts: {
  tmp: string;
  appAbs: string;
  appRel: string;
  $: any;
  _$: any;
}): Promise<{ esbuildBin: string }> {
  const { tmp, appAbs, appRel, $, _$ } = opts;
  const lockfile = `${appRel}/pnpm-lock.yaml`;
  await stageTempRepoPaths({
    tmp,
    _$,
    recursiveRoots: [appRel],
  });
  await _$({
    cwd: tmp,
    stdio: "inherit",
    env: { ...process.env, CI: "1" },
  })`pnpm --dir ${tmp} install --filter ./${appRel}... --lockfile-only --no-frozen-lockfile --prefer-offline --ignore-scripts --reporter=append-only`;
  await _$({ cwd: tmp, stdio: "pipe" })`git add ${lockfile}`;
  await _$({
    cwd: tmp,
    stdio: "inherit",
    env: { ...process.env, NIX_PNPM_ALLOW_GENERATE: "1" },
  })`zx-wrapper build-tools/tools/dev/update-pnpm-hash.ts --lockfile ${lockfile}`;
  await stageTempRepoPaths({
    tmp,
    _$,
    explicitPaths: [lockfile, ...DEFAULT_TEMP_REPO_GLUE_STAGE_PATHS],
  });

  try {
    const nmPath = path.join(appAbs, "node_modules");
    const st = await fsp.lstat(nmPath);
    if (st.isSymbolicLink()) {
      await fsp.unlink(nmPath);
    } else {
      await fsp.rm(nmPath, { recursive: true, force: true });
    }
  } catch {}

  const outPathRaw = await $({
    cwd: appAbs,
    stdio: "pipe",
  })`zx-wrapper ../../../build-tools/tools/dev/node-modules-build.ts`;

  const outPath = String(outPathRaw.stdout || "").trim();
  if (!outPath) throw new Error("failed to resolve node_modules derivation path");
  await $({
    cwd: appAbs,
    stdio: "inherit",
  })`rm -rf node_modules && ln -s ${outPath}/node_modules node_modules`;

  const esbuildPkg = esbuildPackageName();
  const esbuildBin = esbuildPkg
    ? path.join(
        appAbs,
        "node_modules",
        esbuildPkg,
        "bin",
        process.platform === "win32" ? "esbuild.exe" : "esbuild",
      )
    : "";
  return { esbuildBin };
}
