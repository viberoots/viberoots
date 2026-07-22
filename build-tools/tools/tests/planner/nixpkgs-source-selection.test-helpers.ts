import path from "node:path";
import { fileURLToPath } from "node:url";
import { pinnedNixpkgsOutPathExpr } from "../../lib/pinned-nixpkgs";

export const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export async function pinnedNixpkgsPath($: any): Promise<string> {
  const expr = pinnedNixpkgsOutPathExpr(path.join(sourceRoot, "flake.lock"));
  const out = await $({
    stdio: "pipe",
  })`nix eval --impure --accept-flake-config --raw --expr ${expr}`;
  return String(out.stdout || "").trim();
}

export async function nixEvalJson($: any, cwd: string, expr: string): Promise<any> {
  const out = await $({ cwd, stdio: "pipe" })`nix eval --impure --json --expr ${expr}`;
  return JSON.parse(String(out.stdout || "null"));
}

export function plannerContext(repoRoot: string, nixpkgsPath: string, nodesExpr: string): string {
  return `
    let
      pkgs = import ${nixpkgsPath} {};
      lib = pkgs.lib;
      repoRoot = ${repoRoot};
      nodes = ${nodesExpr};
      get = attrs: k: attrs.\${k} or null;
      pkgPathOf = name: ".";
      resolveNixpkgAttrs = { target, attrs }:
        map (attr: {
          inherit attr;
          profile_name = target.nixpkgs_profile or "default";
          package = { marker = attr; profile = target.nixpkgs_profile or "default"; };
        }) attrs;
    in
  `;
}
