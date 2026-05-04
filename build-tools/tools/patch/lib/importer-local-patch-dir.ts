#!/usr/bin/env zx-wrapper
import path from "node:path";
import { defaultImporterPatchDir } from "../../lib/importers";
import { toPosixPath } from "../../lib/posix-path";

type Lang = "node" | "python";

function importerLabelFromDir(repoRootAbs: string, importerDirAbs: string): string {
  const rel = path.relative(repoRootAbs, importerDirAbs);
  const p = toPosixPath(rel);
  return p === "." ? "." : p;
}

export function resolveImporterLocalPatchDir(opts: {
  repoRootAbs: string;
  importerDirAbs: string;
  lang: Lang;
  overridePatchDir: string;
}): string {
  const override = String(opts.overridePatchDir || "").trim();
  if (override) {
    return path.isAbsolute(override) ? override : path.resolve(opts.repoRootAbs, override);
  }

  const importer = importerLabelFromDir(opts.repoRootAbs, opts.importerDirAbs);
  const dirPosix = defaultImporterPatchDir(importer, opts.lang);
  return path.resolve(opts.repoRootAbs, dirPosix);
}
