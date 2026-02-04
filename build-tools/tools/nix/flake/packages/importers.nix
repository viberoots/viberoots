{ lib, filterRepo, repoSnapshot, repoRoot }:
let
  wr = builtins.getEnv "WORKSPACE_ROOT";
  srcRoot =
    if wr != "" then (builtins.path { path = filterRepo (builtins.toPath wr); name = "repo"; }) else repoSnapshot;
  allowGenerate = (builtins.getEnv "NIX_PNPM_ALLOW_GENERATE") == "1";

  appsListing =
    if builtins.pathExists (repoRoot + "/apps") then (builtins.readDir (repoRoot + "/apps"))
    else if (wr != "" && builtins.pathExists (builtins.toPath wr + "/apps")) then (builtins.readDir (builtins.toPath wr + "/apps"))
    else if builtins.pathExists (srcRoot + "/apps") then (builtins.readDir (srcRoot + "/apps"))
    else { };

  libsListing =
    if builtins.pathExists (repoRoot + "/libs") then (builtins.readDir (repoRoot + "/libs"))
    else if (wr != "" && builtins.pathExists (builtins.toPath wr + "/libs")) then (builtins.readDir (builtins.toPath wr + "/libs"))
    else if builtins.pathExists (srcRoot + "/libs") then (builtins.readDir (srcRoot + "/libs"))
    else { };

  appsDirs = builtins.attrNames appsListing;
  libsDirs = builtins.attrNames libsListing;
  importerDirs = (map (d: "apps/" + d) appsDirs) ++ (map (d: "libs/" + d) libsDirs);

  haveRootLock = builtins.pathExists (repoRoot + "/pnpm-lock.yaml");
in
{
  inherit srcRoot allowGenerate importerDirs haveRootLock;
}


