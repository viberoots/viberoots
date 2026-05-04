#!/usr/bin/env zx-wrapper
import { findRepoRoot } from "../lib/repo";
import { getArgvTokens } from "../lib/cli";
import { buildSelectedOutPath } from "./run-runnable-graph";
import { resolveSelectedTargetLabel } from "./target-label-resolver";

async function main() {
  const args = getArgvTokens();
  let sourceMode: "auto" | "git" | "path" = "auto";
  let sourceError = "";
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const tok = String(args[i] || "").trim();
    if (tok === "--source" && i + 1 < args.length) {
      const s = String(args[i + 1] || "").trim();
      if (s === "auto" || s === "git" || s === "path") sourceMode = s;
      else sourceError = `invalid --source value '${s}' (expected auto|git|path)`;
      i++;
      continue;
    }
    if (tok.startsWith("--source=")) {
      const s = tok.slice("--source=".length).trim();
      if (s === "auto" || s === "git" || s === "path") sourceMode = s;
      else sourceError = `invalid --source value '${s}' (expected auto|git|path)`;
      continue;
    }
    rest.push(tok);
  }
  if (sourceError) {
    console.error(`[probe-graph-generator-selected] ${sourceError}`);
    process.exit(2);
  }
  const targetInput = String(rest[0] || "").trim();
  if (!targetInput || targetInput.startsWith("-")) {
    console.error("usage: probe-graph-generator-selected <target> [--source=auto|git|path]");
    process.exit(2);
  }
  const cwd = process.cwd();
  const root = await findRepoRoot(cwd);
  const target = await resolveSelectedTargetLabel(root, targetInput, { baseDir: cwd });
  if (!String(process.env.BNX_RUNNABLE_BUILD_TIMEOUT_SEC || "").trim()) {
    process.env.BNX_RUNNABLE_BUILD_TIMEOUT_SEC = "25";
  }
  const outPath = await buildSelectedOutPath(
    root,
    target,
    sourceMode,
    `probe selected target ${target}`,
  );
  console.log(outPath);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
