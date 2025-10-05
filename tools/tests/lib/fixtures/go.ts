#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

export type GoModuleSpec = {
  modulePath: string;
  versionLine?: string;
  extraRequires?: Array<{ module: string; version: string }>;
  files?: Record<string, string>;
};

export async function writeGoModule(baseDir: string, spec: GoModuleSpec): Promise<string> {
  const dir = path.join(baseDir, spec.modulePath);
  await fsp.mkdir(dir, { recursive: true });
  const requires = (spec.extraRequires || [])
    .map((r) => `require ${r.module} ${r.version}\n`)
    .join("");
  const goMod = [
    `module example.com/${path.basename(spec.modulePath)}\n`,
    spec.versionLine || "go 1.22\n",
    requires,
  ].join("");
  await fsp.writeFile(path.join(dir, "go.mod"), goMod, "utf8");
  const files = spec.files || {
    "main.go": 'package main\nimport "fmt"\nfunc main(){fmt.Println("ok")}\n',
    "main_test.go":
      'package main\nimport ("testing"; "github.com/stretchr/testify/require")\nfunc TestX(t *testing.T){ require.True(t,true) }\n',
  };
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(p, content, "utf8");
  }
  return dir;
}

export async function ensurePatch(
  baseDir: string,
  module: string,
  version: string,
): Promise<string> {
  // Preserve dots to match existing sync-providers filename convention
  const fname = `${module.replaceAll("/", "__")}@${version}.patch`;
  const pdir = path.join(baseDir, "patches", "go");
  await fsp.mkdir(pdir, { recursive: true });
  const p = path.join(pdir, fname);
  await fsp.writeFile(p, "--- a\n+++ b\n", "utf8");
  return p;
}

export async function ensureDirs(baseDir: string, rels: string[]): Promise<void> {
  for (const r of rels) await fsp.mkdir(path.join(baseDir, r), { recursive: true });
}
