import * as fsp from "node:fs/promises";
import path from "node:path";
import type { RunnableContract } from "./runnables";

export async function inferTauriRunnable(
  outPath: string,
  label: string,
  bins: string[],
): Promise<RunnableContract | null> {
  const manifest = path.join(outPath, "share", "viberoots-tauri", "artifact-manifest.json");
  const isTauri = await fsp.stat(manifest).then(
    (stat) => stat.isFile(),
    () => false,
  );
  if (!isTauri) return null;
  const parsed = JSON.parse(await fsp.readFile(manifest, "utf8")) as {
    schema?: unknown;
    appExecutable?: unknown;
    signature?: Record<string, unknown>;
  };
  const signature = parsed.signature;
  if (
    parsed.schema !== "viberoots.tauri-artifact.v1" ||
    signature?.mode !== "adhoc-platform" ||
    signature.credentialed !== false ||
    signature.teamIdentifier !== null ||
    signature.signingIdentity !== null ||
    signature.releaseSigned !== false ||
    signature.releaseAdmitted !== false
  ) {
    throw new Error(`invalid local Tauri signature contract for ${label}`);
  }
  const appExecutable = String(parsed.appExecutable || "");
  const appRoot = path.resolve(outPath, "app");
  const executablePath = path.resolve(appExecutable);
  if (
    !appExecutable ||
    !executablePath.startsWith(`${appRoot}${path.sep}`) ||
    !executablePath.includes(`${path.sep}Contents${path.sep}MacOS${path.sep}`)
  ) {
    throw new Error(`Tauri artifact executable escapes its application bundle for ${label}`);
  }
  const executable = await fsp.stat(executablePath).catch(() => null);
  if (!executable?.isFile() || (executable.mode & 0o111) === 0) {
    throw new Error(`Tauri application executable is missing or not executable for ${label}`);
  }
  return {
    kind: "desktop-app",
    run: {
      prod: { argv: [executablePath] },
      dev: { argv: ["viberoots-tauri-dev", label] },
    },
    artifacts: {
      bins,
      applicationBundle: path.join(outPath, "app"),
      appExecutable: executablePath,
      artifactManifest: manifest,
    },
  };
}
