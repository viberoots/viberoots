{ P, ctx, normalizeList }:
{
  name,
  node,
  sourcePlan,
}:
let
  buildPyDeps = normalizeList "build_py_deps" (ctx.get node "build_py_deps");
  locks = P.extractLockfileLabels (P.labelsOf node);
  lock =
    if buildPyDeps == [] then null
    else if builtins.length locks != 1 then builtins.throw
      "Rust Python extension ${name} build_py_deps require exactly one importer-scoped uv.lock label"
    else P.parseImporterScopedLockfileLabel (builtins.head locks);
  pythonTemplate = ctx.T.pythonForPkgs sourcePlan.base_pkgs;
  pythonWheelhouse =
    if lock == null then null
    else if pythonTemplate == null then builtins.throw
      "Rust Python extension ${name} build_py_deps require the pinned uv2nix authority"
    else pythonTemplate.pyWheelhouse {
      inherit name;
      lockfile = lock.lockfilePath;
      subdir = lock.importer;
      srcRoot = ctx.repoRoot;
    };
in {
  inherit buildPyDeps pythonWheelhouse;
}
