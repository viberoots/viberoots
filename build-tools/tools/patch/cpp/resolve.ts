export async function nixEvalRaw(expr: string): Promise<string> {
  const { stdout } = await $`nix eval --raw --accept-flake-config ${expr}`;
  return String(stdout || "").trim();
}

export async function resolveNixpkg(
  attrNorm: string,
): Promise<{ pname: string; version: string; srcPath: string }> {
  console.error("[patch-cpp] resolve: begin", attrNorm);
  // Test-only fast path: allow explicit mapping via NIX_CPP_TEST_RESOLVE_JSON
  const testJson = process.env.NIX_CPP_TEST_RESOLVE_JSON || "";
  if (testJson.trim()) {
    try {
      const map = JSON.parse(testJson) as Record<
        string,
        { version: string; srcPath: string; pname?: string }
      >;
      // Accept keys with or without pkgs. prefix
      const keys = [
        attrNorm,
        attrNorm.replace(/^pkgs\./, ""),
        `pkgs.${attrNorm.replace(/^pkgs\./, "")}`,
      ];
      for (const k of keys) {
        const ent = map[k];
        if (ent?.version && ent?.srcPath) {
          const tail = attrNorm.replace(/^pkgs\./, "");
          return { pname: ent.pname || tail, version: ent.version, srcPath: ent.srcPath };
        }
      }
    } catch {}
  }
  // Support flake-style "nixpkgs#<name>" queries by stripping pkgs.
  const name = attrNorm.replace(/^pkgs\./, "");
  const base = `nixpkgs#${name}`;
  console.error("[patch-cpp] resolve: eval version", base);
  const version = await nixEvalRaw(`${base}.version`);
  // Materialize and capture the src path in a single step to avoid a second eval
  console.error("[patch-cpp] resolve: build src", base);
  const built = await $`nix build --no-link --accept-flake-config ${base}.src --print-out-paths`;
  const srcPath =
    String(built.stdout || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop() || "";
  if (!srcPath) throw new Error(`failed to resolve src path for ${base}`);
  console.error("[patch-cpp] resolve: eval src", base);
  console.error("[patch-cpp] resolve: done", { pname: name, version, srcPath });
  return { pname: name, version, srcPath };
}
