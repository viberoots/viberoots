import * as fsp from "node:fs/promises";
import path from "node:path";
import { glueFingerprintFresh } from "./glue-freshness";

export type InstallMetadataMode = "read-only" | "reconcile";

export function installMetadataMode(): InstallMetadataMode {
  return String(process.env.VBR_INSTALL_REFRESH_PNPM_HASHES || "").trim() === "1" ||
    String(process.env.VBR_BOOTSTRAP_PNPM_GENERATE || "").trim() === "1"
    ? "reconcile"
    : "read-only";
}

export function staleMetadataError(file: string, detail: string): Error {
  return new Error(
    [
      `tracked metadata is stale: ${file}`,
      detail,
      "no tracked files were modified",
      "repair: run u",
    ].join("\n"),
  );
}

export async function assertCppTrackedMetadataReady(
  root: string,
  enabledOverride?: boolean,
): Promise<void> {
  const config = JSON.parse(
    await fsp
      .readFile(path.join(root, "build-tools/tools/nix/langs.json"), "utf8")
      .catch(() => "{}"),
  ) as { enabled?: string[] };
  if (!(enabledOverride ?? config.enabled?.includes("cpp"))) return;
  const tracked = [
    "build-tools/lang/auto_map.bzl",
    "build-tools/lang/nix_attr_aliases.bzl",
    "build-tools/tools/nix/langs.nix",
  ];
  for (const file of tracked) {
    try {
      await fsp.access(path.join(root, file));
    } catch {
      throw staleMetadataError(file, "C++ provider/source-selection metadata is missing");
    }
  }
  const freshness = await glueFingerprintFresh(root);
  if (!freshness.fresh && freshness.reason !== "missing-output") {
    throw staleMetadataError(
      "build-tools/tools/nix/langs.json",
      `C++ provider/source-selection inputs changed (${freshness.reason})`,
    );
  }
}
