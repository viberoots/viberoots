import { createCommandUi, isVbrVerbose } from "../../lib/command-ui";
import type { ArtifactBuildClassification } from "../../lib/artifact-build-policy";
import { targetPackageFromLabel } from "../../lib/artifact-source-inventory";
import { inspectWorkspaceArtifactSource } from "../artifact-policy-inspection";
export { untrackedRequiresImpureForTargets } from "../../lib/artifact-source-inventory";

export function explicitTargetPackages(subcmd: string, restArgs: string[]): string[] {
  if (subcmd !== "build" && subcmd !== "test" && subcmd !== "run") return [];
  const pkgs = new Set<string>();
  for (const t of restArgs) {
    const tok = String(t || "").trim();
    if (!tok || tok.includes("...")) continue;
    if (tok.startsWith("//")) {
      const pkg = targetPackageFromLabel(tok);
      if (pkg) pkgs.add(pkg);
      continue;
    }
    if (tok.startsWith(":")) {
      pkgs.add("");
    }
  }
  return Array.from(pkgs).filter(Boolean);
}

function isGeneratedWorkspaceUntrackedPath(p: string): boolean {
  const x = String(p || "").replace(/\\/g, "/");
  if (x === ".direnv" || x.startsWith(".direnv/")) return true;
  if (x === ".nix-zsh" || x.startsWith(".nix-zsh/")) return true;
  if (x === ".viberoots" || x.startsWith(".viberoots/")) return true;
  return false;
}

function isBootstrapScaffoldUntrackedPath(p: string): boolean {
  const x = String(p || "").replace(/\\/g, "/");
  if (
    x === ".buckconfig" ||
    x === ".buckroot" ||
    x === ".envrc" ||
    x === "flake.nix" ||
    x === "flake.lock" ||
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
  return false;
}

function writeDevelopmentBundleWarning(opts: {
  ui: ReturnType<typeof createCommandUi>;
  untracked: string[];
  relevantLabel?: string;
}): void {
  const visible = opts.untracked.filter(
    (p) => !isGeneratedWorkspaceUntrackedPath(p) && !isBootstrapScaffoldUntrackedPath(p),
  );
  const hiddenGenerated = opts.untracked.filter(isGeneratedWorkspaceUntrackedPath).length;
  const scaffold = opts.untracked.filter(isBootstrapScaffoldUntrackedPath).length;
  const relevant = opts.relevantLabel ? ` ${opts.relevantLabel}` : "";
  if (visible.length === 0 && scaffold > 0) {
    opts.ui.warn(`development bundle includes ${scaffold} uncommitted scaffold file(s)`);
    if (hiddenGenerated > 0) {
      opts.ui.list([`... ${hiddenGenerated} generated workspace file(s) hidden`], {
        stream: "stderr",
        limit: 1,
      });
    }
    return;
  }
  if (visible.length === 0 && hiddenGenerated > 0) {
    opts.ui.warn(
      `development bundle includes ${hiddenGenerated} generated workspace untracked file(s)`,
    );
    return;
  }
  opts.ui.warn(`development bundle includes ${opts.untracked.length}${relevant} untracked file(s)`);
  opts.ui.list(visible, { stream: "stderr" });
  if (hiddenGenerated > 0) {
    opts.ui.list([`... ${hiddenGenerated} generated workspace file(s) hidden`], {
      stream: "stderr",
      limit: 1,
    });
  }
  if (scaffold > 0) {
    opts.ui.list([`... ${scaffold} uncommitted scaffold file(s) hidden`], {
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
}): Promise<{ impure: boolean; classification: ArtifactBuildClassification }> {
  const verbose = isVbrVerbose();
  const ui = createCommandUi({ verbose });
  const targetPkgs = explicitTargetPackages(opts.subcmd, opts.restArgs);
  const inventory = await inspectWorkspaceArtifactSource({
    workspaceRoot: opts.root,
    targetPackages: targetPkgs,
  });
  if (opts.impure) return { impure: true, classification: "diagnostic-impure" };
  if (!inventory.localDevelopment) {
    if (inventory.ignored.length > 0) {
      if (verbose) {
        console.warn(
          `[dev-build] keeping pure mode for explicit targets; ignoring ${inventory.ignored.length} unrelated untracked file(s)`,
        );
      } else {
        ui.ok("purity", `ignored ${inventory.ignored.length} unrelated untracked file(s)`);
      }
    }
    return { impure: false, classification: "hermetic" };
  }

  if (verbose) {
    console.warn("[dev-build] creating non-release development bundle for untracked files:");
    for (const f of inventory.relevant.slice(0, 50)) console.warn(` - ${f}`);
    if (inventory.relevant.length > 50) {
      console.warn(` ... and ${inventory.relevant.length - 50} more`);
    }
  } else {
    writeDevelopmentBundleWarning({
      ui,
      untracked: inventory.relevant,
      relevantLabel: targetPkgs.length > 0 ? "relevant" : undefined,
    });
  }
  return { impure: false, classification: "local-development" };
}
