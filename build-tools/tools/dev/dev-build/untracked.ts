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

export async function maybeAutoImpureFromUntrackedFiles(opts: {
  isCI: boolean;
  root: string;
  impure: boolean;
  subcmd: string;
  restArgs: string[];
}): Promise<{ impure: boolean }> {
  if (opts.isCI || opts.impure) return { impure: opts.impure };
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
          console.warn(
            `[dev-build] keeping pure mode for explicit targets; ignoring ${decision.ignored.length} unrelated untracked file(s)`,
          );
        }
        return { impure: false };
      }
      console.warn("[dev-build] Falling back to --impure due to relevant untracked files:");
      for (const f of decision.relevant.slice(0, 50)) console.warn(` - ${f}`);
      if (decision.relevant.length > 50) {
        console.warn(` ... and ${decision.relevant.length - 50} more`);
      }
      return { impure: true };
    }

    console.warn("[dev-build] Falling back to --impure due to untracked files:");
    for (const f of untracked.slice(0, 50)) console.warn(` - ${f}`);
    if (untracked.length > 50) console.warn(` ... and ${untracked.length - 50} more`);
    return { impure: true };
  } catch {}
  return { impure: false };
}
