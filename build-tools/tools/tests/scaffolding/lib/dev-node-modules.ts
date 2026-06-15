#!/usr/bin/env zx-wrapper
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
    env: { ...process.env, WORKSPACE_ROOT: tmp, CI: "1" },
  })`pnpm --dir ${tmp} install --filter ./${appRel}... --lockfile-only --no-frozen-lockfile --prefer-offline --ignore-scripts --reporter=append-only`;
  await _$({
    cwd: tmp,
    stdio: "inherit",
    env: { ...process.env, WORKSPACE_ROOT: tmp, CI: "1" },
  })`pnpm --dir ${tmp} install --filter ./${appRel}... --no-frozen-lockfile --prefer-offline --ignore-scripts --reporter=append-only`;
  await _$({ cwd: tmp, stdio: "pipe" })`git add ${lockfile}`;
  await stageTempRepoPaths({
    tmp,
    _$,
    explicitPaths: [lockfile, ...DEFAULT_TEMP_REPO_GLUE_STAGE_PATHS],
  });

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
