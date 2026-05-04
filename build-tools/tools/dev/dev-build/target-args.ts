import { resolveSelectedTargetLabel } from "../target-label-resolver";
import * as fsp from "node:fs/promises";
import path from "node:path";

const SUBCMDS_WITH_TARGETS = new Set(["build", "test", "run"]);

// Keep this set tight and explicit so we do not rewrite option payloads.
const FLAGS_WITH_VALUES = new Set([
  "--target-platforms",
  "--user-platform",
  "--config",
  "-c",
  "--out",
  "--output",
  "--build-report",
]);

function shouldNormalizeToken(tok: string): boolean {
  const t = String(tok || "").trim();
  if (!t) return false;
  if (t === "//..." || t === "...") return false;
  if (t.startsWith("-")) return false;
  if (t.includes("(") || t.includes(")")) return false;
  // Keep explicit target labels (with :) and query fragments untouched.
  if (t.includes(":")) return false;
  if (t.startsWith("//") || t.startsWith("root//")) return true;
  if (t === "." || t === ".." || t.startsWith("./") || t.startsWith("../")) return true;
  if (t.startsWith("/")) return true;
  if (t.includes("/")) return true;
  return false;
}

export async function normalizeDevBuildTargetArgs(opts: {
  workspaceRoot: string;
  baseDir: string;
  subcmd: string;
  args: string[];
}): Promise<string[]> {
  if (!SUBCMDS_WITH_TARGETS.has(String(opts.subcmd || ""))) return opts.args;
  const out: string[] = [];
  let passthrough = false;
  for (let i = 0; i < opts.args.length; i++) {
    const tok = String(opts.args[i] || "");
    if (passthrough) {
      out.push(tok);
      continue;
    }
    if (tok === "--") {
      passthrough = true;
      out.push(tok);
      continue;
    }
    if (tok.startsWith("-")) {
      out.push(tok);
      if (FLAGS_WITH_VALUES.has(tok) && i + 1 < opts.args.length) {
        out.push(String(opts.args[i + 1] || ""));
        i++;
      }
      continue;
    }
    if (!shouldNormalizeToken(tok)) {
      out.push(tok);
      continue;
    }
    out.push(
      await resolveSelectedTargetLabel(opts.workspaceRoot, tok, {
        baseDir: opts.baseDir,
      }),
    );
  }
  let passthroughSeen = false;
  let skipNextValue = false;
  let keptTargetTokens = 0;
  const filtered: string[] = [];
  for (let i = 0; i < out.length; i++) {
    const tok = String(out[i] || "");
    if (passthroughSeen) {
      filtered.push(tok);
      continue;
    }
    if (tok === "--") {
      passthroughSeen = true;
      filtered.push(tok);
      continue;
    }
    if (skipNextValue) {
      skipNextValue = false;
      filtered.push(tok);
      continue;
    }
    if (tok.startsWith("-")) {
      filtered.push(tok);
      if (FLAGS_WITH_VALUES.has(tok) && i + 1 < out.length) {
        skipNextValue = true;
      }
      continue;
    }

    const rec = tok.match(/^(?:root\/\/|\/\/)([^:]+)\/\.\.\.$/);
    if (rec) {
      const rel = String(rec[1] || "").replace(/^\/+/, "");
      if (rel === "patches" || rel.startsWith("patches/")) {
        const abs = path.join(opts.workspaceRoot, rel);
        const exists = await fsp
          .stat(abs)
          .then((s) => s.isDirectory())
          .catch(() => false);
        if (!exists) {
          console.warn(
            `[dev-build] skipping missing optional patch scope target: ${tok} (directory '${rel}' not found)`,
          );
          continue;
        }
      }
    }
    keptTargetTokens++;
    filtered.push(tok);
  }

  if (opts.subcmd === "build" && keptTargetTokens === 0) {
    return ["//..."];
  }
  return filtered;
}
