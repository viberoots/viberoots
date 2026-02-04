#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { defaultImporterPatchDir } from "../../../build-tools/tools/lib/importers.ts";
import { getSession, setSession } from "../../../patch/state";

export async function badExample(importerDirAbs: string) {
  const dirPosix = defaultImporterPatchDir("apps/web", "node");
  const patchDir = path.resolve(importerDirAbs, dirPosix);
  await fsp.mkdir(path.join(importerDirAbs, "patches", "node"), { recursive: true });
  await setSession("node", "apps/web#lodash", {
    importPath: "lodash",
    version: "",
    originPath: importerDirAbs,
    workspacePath: "/tmp/ws",
    createdAt: "",
    updatedAt: "",
  });
  return { patchDir, sess: await getSession("node", "apps/web#lodash") };
}
