import path from "node:path";
import { getArgvTokens } from "../../lib/cli.ts";
import { normalizeDevBuildTargetArgs } from "../dev-build/target-args.ts";

export type VerifyConsole = "auto" | "super" | "simple";

export type VerifyArgs = {
  coverage: boolean;
  console: VerifyConsole;
  targets: string[];
};

export function parseVerifyArgs(): VerifyArgs {
  const tokens = getArgvTokens();

  let coverage = false;
  let console: VerifyConsole = "auto";
  const passthrough: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] || "";
    if (t === "--") {
      passthrough.push(...tokens.slice(i + 1));
      break;
    }
    if (t === "--coverage") {
      coverage = true;
      continue;
    }
    if (t.startsWith("--console=")) {
      const v = t.slice("--console=".length).trim();
      if (v === "auto" || v === "super" || v === "simple") console = v;
      continue;
    }
    if (t === "--console") {
      const v = String(tokens[i + 1] || "").trim();
      if (v === "auto" || v === "super" || v === "simple") console = v;
      i++;
      continue;
    }
    // Treat all other flags as verify-internal; only targets should be passed through.
    if (t.startsWith("--")) continue;
    passthrough.push(t);
  }

  return { coverage, console, targets: passthrough.length > 0 ? passthrough : ["//..."] };
}

export async function normalizeVerifyTargets(opts: {
  workspaceRoot: string;
  baseDir: string;
  targets: string[];
}): Promise<string[]> {
  const normalized = await normalizeDevBuildTargetArgs({
    workspaceRoot: opts.workspaceRoot,
    baseDir: opts.baseDir,
    subcmd: "test",
    args: opts.targets,
  });
  return normalized.map((t, i) => {
    const original = String(opts.targets[i] || "").trim();
    const normalizedTarget = String(t || "").trim();
    const isExplicitBuckLabel =
      original.startsWith("//") || original.startsWith("root//") || original.startsWith(":");
    const looksPathLike =
      !isExplicitBuckLabel &&
      (original === "." ||
        original === ".." ||
        original.startsWith("./") ||
        original.startsWith("../") ||
        original.startsWith("/") ||
        original.includes("/"));
    if (!looksPathLike) return normalizedTarget;
    if (normalizedTarget === "." && (original === "." || original === "./")) {
      const baseAbs = path.resolve(opts.baseDir);
      const rootAbs = path.resolve(opts.workspaceRoot);
      if (baseAbs === rootAbs) return "//...";
    }
    if (!normalizedTarget.startsWith("//")) return normalizedTarget;
    if (normalizedTarget.includes("...")) return normalizedTarget;
    const pkg = normalizedTarget.split(":")[0];
    if (!pkg || !pkg.startsWith("//")) return normalizedTarget;
    return `${pkg}/...`;
  });
}
