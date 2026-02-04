#
# Node template shim (discoverability)
# ------------------------------------
# This file is intentionally minimal. It exists so that `build-tools/tools/nix/lang-templates.nix`
# can expose a Node symbol bag for discovery. The authoritative Node planner logic
# lives in `build-tools/tools/nix/planner/node.nix`, and Node builds are driven by Buck macros
# plus importer‑scoped providers (PNPM). Do not add build logic here; keep it empty
# and defer to the planner plugin and Starlark macros.
{ pkgs }:
{
}
