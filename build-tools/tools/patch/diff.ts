import fs from "node:fs";
import path from "node:path";

import { resolveToolPathSync } from "../lib/tool-paths";
import { MACOS_METADATA_NEVER_INDEX_FILE } from "../lib/macos-metadata";
import { runPatchCommand } from "./lib/command-runner";
import { createDbg } from "./lib/util";
const dbg = createDbg("patch-diff");

function executableEnvPath(value: string | undefined): string {
  const candidate = String(value || "").trim();
  if (!candidate || !path.isAbsolute(candidate)) return "";
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return candidate;
  } catch {
    return "";
  }
}

function resolveGitBin(): string {
  return executableEnvPath(process.env.GIT_BIN) || resolveToolPathSync("git");
}

function isToolMetadataDiffLine(line: string): boolean {
  return (
    line.includes(`/${MACOS_METADATA_NEVER_INDEX_FILE}`) ||
    line.endsWith(` ${MACOS_METADATA_NEVER_INDEX_FILE}`) ||
    line.endsWith(` a/${MACOS_METADATA_NEVER_INDEX_FILE}`) ||
    line.endsWith(` b/${MACOS_METADATA_NEVER_INDEX_FILE}`)
  );
}

export function stripToolMetadataDiffs(diff: string): string {
  const lines = diff.split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i] || "";
    if (line.startsWith("diff --git ")) {
      const block: string[] = [];
      while (i < lines.length) {
        const cur = lines[i] || "";
        if (block.length > 0 && cur.startsWith("diff --git ")) break;
        block.push(cur);
        i++;
      }
      if (!block.some(isToolMetadataDiffLine)) kept.push(...block);
      continue;
    }
    kept.push(line);
    i++;
  }
  return kept.join("\n").trim() ? kept.join("\n") : "";
}

export async function makeUnifiedDiff(srcDir: string, dstDir: string): Promise<string> {
  // Require git --no-index so we get canonical a/ and b/ prefixes; do not fallback.
  const res = await runPatchCommand(resolveGitBin(), [
    "-c",
    "core.filemode=false",
    "--no-pager",
    "diff",
    "--no-index",
    "-U3",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--",
    srcDir,
    dstDir,
  ]);
  let s = String(res.stdout || "");
  try {
    dbg("git-diff", { exitCode: res.code, stderrLen: String(res.stderr || "").length });
  } catch {}
  // If there are no changes, stdout will be empty. Treat that as a clean no-op diff
  // and return an empty string so callers can handle it without failing.
  if (!s) {
    dbg("git-diff-empty", { srcDir, dstDir });
    return "";
  }
  s = stripToolMetadataDiffs(s);
  if (!s) {
    dbg("git-diff-tool-metadata-only", { srcDir, dstDir });
    return "";
  }
  // Normalize absolute path bleed-through by simple prefix replacement on headers
  const src = srcDir.replace(/\/+$/, "");
  const dst = dstDir.replace(/\/+$/, "");
  s = s
    // diff header lines
    .replaceAll(` diff --git a${src}/`, " diff --git a/")
    .replaceAll(` diff --git b${dst}/`, " diff --git b/")
    .replaceAll(`diff --git a${src}/`, "diff --git a/")
    .replaceAll(`diff --git b${dst}/`, "diff --git b/")
    // file header lines
    .replaceAll(`--- a${src}/`, "--- a/")
    .replaceAll(`+++ b${dst}/`, "+++ b/")
    .replaceAll(`--- a${dst}/`, "--- a/")
    .replaceAll(`+++ b${src}/`, "+++ b/")
    // generic occurrences
    .replaceAll(`a${src}/`, "a/")
    .replaceAll(`b${dst}/`, "b/");
  return s;
}
