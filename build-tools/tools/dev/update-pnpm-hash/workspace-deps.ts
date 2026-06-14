export function packageJsonWorkspaceDeps(pkg: any): string[] {
  const out = new Set<string>();
  for (const section of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const deps = pkg?.[section];
    if (!deps || typeof deps !== "object") continue;
    for (const [name, version] of Object.entries(deps)) {
      if (String(version).startsWith("workspace:")) out.add(name);
    }
  }
  return Array.from(out).sort();
}
