import * as fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RunnableExec } from "../lib/runnables";
import { withoutArtifactEnvironmentInfluence } from "../lib/artifact-environment";
import { externalNodeToolEnv } from "../lib/external-node-env";

export function directRustDevEnvironment(
  inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = externalNodeToolEnv(withoutArtifactEnvironmentInfluence(inherited));
  delete env.VBR_CANONICAL_ARTIFACT_ENTRYPOINT;
  return env;
}

export async function directImporterDevSpec(
  workspaceRoot: string,
  importer: string,
  mode: "static" | "ssr",
  framework: string,
): Promise<RunnableExec | null> {
  if (!importer || path.isAbsolute(importer) || importer.startsWith("../")) return null;
  const importerRoot = path.join(workspaceRoot, importer);
  const watchScript = path.join(importerRoot, "scripts", "dev-wasm-watch.mjs");
  try {
    const st = await fsp.stat(watchScript);
    if (!st.isFile()) return null;
  } catch {
    return null;
  }
  const viberootsRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
  );
  const devTool = path.join(viberootsRoot, "build-tools", "tools", "dev", "dev-with-wasm-watch.ts");
  const viteCmd =
    mode === "ssr"
      ? framework === "next"
        ? "node_modules/.bin/next dev -H 127.0.0.1 -p ${PORT:-4173}"
        : "node server/dev.mjs"
      : "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${PORT:-5187} --strictPort --clearScreen false --logLevel info";
  return {
    argv: [
      "zx-wrapper",
      devTool,
      "--vite-cmd",
      viteCmd,
      "--watch-cmd",
      "node scripts/dev-wasm-watch.mjs",
    ],
    cwd: importerRoot,
  };
}

export async function directStaticWebappDevSpec(
  workspaceRoot: string,
  importer: string,
): Promise<RunnableExec | null> {
  if (!importer || path.isAbsolute(importer) || importer.startsWith("../")) return null;
  const importerRoot = path.join(workspaceRoot, importer);
  const devScript = path.join(importerRoot, "scripts", "dev.ts");
  try {
    const st = await fsp.stat(devScript);
    if (st.isFile()) return { argv: ["zx-wrapper", "scripts/dev.ts"], cwd: importerRoot };
  } catch {}
  return {
    argv: [
      "node",
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "${PORT:-5187}",
      "--strictPort",
      "--clearScreen",
      "false",
      "--logLevel",
      "info",
    ],
    cwd: importerRoot,
  };
}

export function directRustDevSpec(
  workspaceRoot: string,
  target: string,
  artifactToolsRoot: string,
  canonicalDevOverrideArg = "",
): RunnableExec {
  const viberootsRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
  );
  return {
    argv: [
      path.join(artifactToolsRoot, "bin", "zx-wrapper"),
      path.join(viberootsRoot, "build-tools", "tools", "dev", "rust-dev-watch.ts"),
      "--target",
      target,
      "--workspace-root",
      workspaceRoot,
      "--artifact-tools-root",
      artifactToolsRoot,
      ...(canonicalDevOverrideArg ? [canonicalDevOverrideArg] : []),
    ],
    cwd: workspaceRoot,
  };
}

export function directTauriDevSpec(
  workspaceRoot: string,
  target: string,
  artifactToolsRoot: string,
  canonicalDevOverrideArg = "",
): RunnableExec {
  const viberootsRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
  );
  return {
    argv: [
      path.join(artifactToolsRoot, "bin", "zx-wrapper"),
      path.join(viberootsRoot, "build-tools", "tools", "dev", "tauri-dev.ts"),
      "--target",
      target,
      "--workspace-root",
      workspaceRoot,
      "--artifact-tools-root",
      artifactToolsRoot,
      ...(canonicalDevOverrideArg ? [canonicalDevOverrideArg] : []),
    ],
    cwd: workspaceRoot,
  };
}
