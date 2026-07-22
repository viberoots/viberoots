export function normalizeRepoPath(relPath: string): string {
  return String(relPath || "")
    .replace(/\\/g, "/")
    .trim();
}

export function shouldIgnoreLintPath(relPath: string): boolean {
  if (!relPath) return true;
  if (relPath === "viberoots" || relPath === ".viberoots/current") return true;
  if (
    relPath === ".buckconfig" ||
    relPath === ".buckroot" ||
    relPath === ".envrc" ||
    relPath === ".gitignore" ||
    relPath === "projects" ||
    relPath === "projects/" ||
    relPath === "README.md" ||
    relPath === "projects/.metadata_never_index" ||
    relPath === "projects/AGENTS.md" ||
    relPath === "projects/README.md" ||
    relPath === "projects/config/README.md" ||
    relPath === "projects/config/shared.json"
  ) {
    return true;
  }
  if (relPath.includes("/node_modules/") || relPath.startsWith("node_modules/")) return true;
  if (relPath.includes("/buck-out/") || relPath.startsWith("buck-out/")) return true;
  if (relPath.includes("/coverage/") || relPath.startsWith("coverage/")) return true;
  if (relPath.includes("/dist/") || relPath.startsWith("dist/")) return true;
  if (relPath.includes("/.clinic/") || relPath.startsWith(".clinic/")) return true;
  if (relPath.includes("/.vite-cache/") || relPath.startsWith(".vite-cache/")) return true;
  if (relPath === ".direnv" || relPath.startsWith(".direnv/")) return true;
  if (relPath === ".nix-zsh" || relPath.startsWith(".nix-zsh/")) return true;
  return false;
}

export function isEslintPath(relPath: string): boolean {
  return relPath.endsWith(".ts") || relPath.endsWith(".tsx");
}

export function isPrettierPath(relPath: string): boolean {
  return [".ts", ".tsx", ".js", ".mjs", ".cjs", ".md", ".json", ".yml", ".yaml"].some((extension) =>
    relPath.endsWith(extension),
  );
}
