{ lib, filterRepo, repoSnapshot, repoRoot }:
let
  wr = builtins.getEnv "WORKSPACE_ROOT";
  srcRoot =
    if wr != "" then (builtins.path { path = filterRepo (builtins.toPath wr); name = "repo"; }) else repoSnapshot;
  allowGenerate = (builtins.getEnv "NIX_PNPM_ALLOW_GENERATE") == "1";

  appsListing =
    if builtins.pathExists (repoRoot + "/projects/apps") then (builtins.readDir (repoRoot + "/projects/apps"))
    else if (wr != "" && builtins.pathExists (builtins.toPath wr + "/projects/apps")) then (builtins.readDir (builtins.toPath wr + "/projects/apps"))
    else if builtins.pathExists (srcRoot + "/projects/apps") then (builtins.readDir (srcRoot + "/projects/apps"))
    else { };

  libsListing =
    if builtins.pathExists (repoRoot + "/projects/libs") then (builtins.readDir (repoRoot + "/projects/libs"))
    else if (wr != "" && builtins.pathExists (builtins.toPath wr + "/projects/libs")) then (builtins.readDir (builtins.toPath wr + "/projects/libs"))
    else if builtins.pathExists (srcRoot + "/projects/libs") then (builtins.readDir (srcRoot + "/projects/libs"))
    else { };

  appsDirs = builtins.attrNames appsListing;
  libsDirs = builtins.attrNames libsListing;
  importerDirs = (map (d: "projects/apps/" + d) appsDirs) ++ (map (d: "projects/libs/" + d) libsDirs);

  haveRootLock = builtins.pathExists (repoRoot + "/pnpm-lock.yaml");
in
{
  inherit srcRoot allowGenerate importerDirs haveRootLock;
}


