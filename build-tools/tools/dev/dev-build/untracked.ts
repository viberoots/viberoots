import { createCommandUi, isVbrVerbose } from "../../lib/command-ui";

function explicitTargetPackages(subcmd: string, restArgs: string[]): string[] {
  if (subcmd !== "build" && subcmd !== "test" && subcmd !== "run") return [];
  const pkgs = new Set<string>();
  for (const t of restArgs) {
    const tok = String(t || "").trim();
    if (!tok || tok.includes("...")) continue;
    if (tok.startsWith("//")) {
      const body = tok.slice(2);
      const idx = body.indexOf(":");
      if (idx >= 0) pkgs.add(body.slice(0, idx));
      else if (body) pkgs.add(body);
      continue;
    }
    if (tok.startsWith(":")) {
      pkgs.add("");
    }
  }
  return Array.from(pkgs).filter(Boolean);
}

function isAlwaysRelevantUntrackedPath(p: string): boolean {
  const x = String(p || "").replace(/\\/g, "/");
  if (!x) return false;
  if (
    x === "flake.nix" ||
    x === "flake.lock" ||
    x === ".buckconfig" ||
    x === "BUCK" ||
    x === "TARGETS"
  ) {
    return true;
  }
  if (/\/TARGETS$/.test(x) || x.endsWith(".bzl")) return true;
  const criticalPrefixes = [
    "build-tools/lang/",
    "build-tools/node/",
    "build-tools/tools/buck/",
    "build-tools/tools/nix/",
    "build-tools/tools/dev/",
    "viberoots/build-tools/lang/",
    "viberoots/build-tools/node/",
    "viberoots/build-tools/tools/buck/",
    "viberoots/build-tools/tools/nix/",
    "viberoots/build-tools/tools/dev/",
    "third_party/",
    "toolchains/",
    "viberoots/third_party/",
    "viberoots/toolchains/",
  ];
  return criticalPrefixes.some((pre) => x.startsWith(pre));
}

function isIgnorableForExplicitTargetBuild(p: string): boolean {
  const x = String(p || "").replace(/\\/g, "/");
  const ignorablePrefixes = [
    "docs/",
    "build-tools/docs/",
    "build-tools/tools/tests/",
    "viberoots/build-tools/docs/",
    "viberoots/build-tools/tools/tests/",
    ".cursor/",
  ];
  return ignorablePrefixes.some((pre) => x.startsWith(pre));
}

function isGeneratedWorkspaceUntrackedPath(p: string): boolean {
  const x = String(p || "").replace(/\\/g, "/");
  if (
    x === ".buckconfig" ||
    x === ".buckroot" ||
    x === ".envrc" ||
    x === ".gitignore" ||
    x === ".metadata_never_index" ||
    x === "README.md" ||
    x === "projects" ||
    x === "projects/" ||
    x === "projects/.metadata_never_index" ||
    x === "projects/AGENTS.md" ||
    x === "projects/README.md" ||
    x === "projects/config/README.md" ||
    x === "projects/config/shared.json"
  ) {
    return true;
  }
  if (x === ".direnv" || x.startsWith(".direnv/")) return true;
  if (x === ".nix-zsh" || x.startsWith(".nix-zsh/")) return true;
  if (x === ".viberoots" || x.startsWith(".viberoots/")) return true;
  return false;
}

function isTargetScopedRelevant(p: string, targetPkgs: string[]): boolean {
  const x = String(p || "").replace(/\\/g, "/");
  return targetPkgs.some((pkg) => x === pkg || x.startsWith(`${pkg}/`));
}

export function untrackedRequiresImpureForTargets(opts: {
  untracked: string[];
  targetPackages: string[];
}): { requiresImpure: boolean; relevant: string[]; ignored: string[] } {
  const relevant: string[] = [];
  const ignored: string[] = [];
  for (const raw of opts.untracked) {
    const p = String(raw || "").trim();
    if (!p) continue;
    if (isAlwaysRelevantUntrackedPath(p) || isTargetScopedRelevant(p, opts.targetPackages)) {
      relevant.push(p);
      continue;
    }
    if (isIgnorableForExplicitTargetBuild(p)) {
      ignored.push(p);
      continue;
    }
    // Safety-first: unknown locations are treated as relevant.
    relevant.push(p);
  }
  return { requiresImpure: relevant.length > 0, relevant, ignored };
}

function writeUntrackedImpureWarning(opts: {
  ui: ReturnType<typeof createCommandUi>;
  untracked: string[];
  relevantLabel?: string;
}): void {
  const visible = opts.untracked.filter((p) => !isGeneratedWorkspaceUntrackedPath(p));
  const hiddenGenerated = opts.untracked.length - visible.length;
  const relevant = opts.relevantLabel ? ` ${opts.relevantLabel}` : "";
  if (visible.length === 0 && hiddenGenerated > 0) {
    opts.ui.warn(`impure build due to ${hiddenGenerated} generated workspace untracked file(s)`);
    return;
  }
  opts.ui.warn(`impure build due to ${opts.untracked.length}${relevant} untracked file(s)`);
  opts.ui.list(visible, { stream: "stderr" });
  if (hiddenGenerated > 0) {
    opts.ui.list([`... ${hiddenGenerated} generated workspace file(s) hidden`], {
      stream: "stderr",
      limit: 1,
    });
  }
}

export async function maybeAutoImpureFromUntrackedFiles(opts: {
  isCI: boolean;
  root: string;
  impure: boolean;
  subcmd: string;
  restArgs: string[];
}): Promise<{ impure: boolean }> {
  if (opts.isCI || opts.impure) return { impure: opts.impure };
  const verbose = isVbrVerbose();
  const ui = createCommandUi({ verbose });
  try {
    const { stdout } = await $({
      stdio: "pipe",
      cwd: opts.root,
    })`git ls-files --others --exclude-standard`
      .nothrow()
      .quiet();
    const untracked = String(stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean);
    if (untracked.length === 0) return { impure: false };

    const targetPkgs = explicitTargetPackages(opts.subcmd, opts.restArgs);
    if (targetPkgs.length > 0) {
      const decision = untrackedRequiresImpureForTargets({ untracked, targetPackages: targetPkgs });
      if (!decision.requiresImpure) {
        if (decision.ignored.length > 0) {
          if (verbose) {
            console.warn(
              `[dev-build] keeping pure mode for explicit targets; ignoring ${decision.ignored.length} unrelated untracked file(s)`,
            );
          } else {
            ui.ok("purity", `ignored ${decision.ignored.length} unrelated untracked file(s)`);
          }
        }
        return { impure: false };
      }
      if (verbose) {
        console.warn("[dev-build] Falling back to --impure due to relevant untracked files:");
        for (const f of decision.relevant.slice(0, 50)) console.warn(` - ${f}`);
        if (decision.relevant.length > 50) {
          console.warn(` ... and ${decision.relevant.length - 50} more`);
        }
      } else {
        writeUntrackedImpureWarning({
          ui,
          untracked: decision.relevant,
          relevantLabel: "relevant",
        });
      }
      return { impure: true };
    }

    if (verbose) {
      console.warn("[dev-build] Falling back to --impure due to untracked files:");
      for (const f of untracked.slice(0, 50)) console.warn(` - ${f}`);
      if (untracked.length > 50) console.warn(` ... and ${untracked.length - 50} more`);
    } else {
      writeUntrackedImpureWarning({ ui, untracked });
    }
    return { impure: true };
  } catch {}
  return { impure: false };
}
