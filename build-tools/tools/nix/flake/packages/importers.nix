{ lib, filterRepo, repoSnapshot, repoRoot }:
let
  wr = builtins.getEnv "WORKSPACE_ROOT";
  wrPath = if wr != "" then (builtins.toPath wr) else null;
  srcRoot =
    if wr != "" then (builtins.path { path = builtins.toPath wr; name = "repo"; filter = filterRepo (builtins.toPath wr); }) else repoSnapshot;

  appsListing =
    if (wrPath != null && builtins.pathExists (wrPath + "/projects/apps")) then (builtins.readDir (wrPath + "/projects/apps"))
    else if builtins.pathExists (repoRoot + "/projects/apps") then (builtins.readDir (repoRoot + "/projects/apps"))
    else if builtins.pathExists (srcRoot + "/projects/apps") then (builtins.readDir (srcRoot + "/projects/apps"))
    else { };

  libsListing =
    if (wrPath != null && builtins.pathExists (wrPath + "/projects/libs")) then (builtins.readDir (wrPath + "/projects/libs"))
    else if builtins.pathExists (repoRoot + "/projects/libs") then (builtins.readDir (repoRoot + "/projects/libs"))
    else if builtins.pathExists (srcRoot + "/projects/libs") then (builtins.readDir (srcRoot + "/projects/libs"))
    else { };

  appsDirs = builtins.attrNames appsListing;
  libsDirs = builtins.attrNames libsListing;
  importerDirs = (map (d: "projects/apps/" + d) appsDirs) ++ (map (d: "projects/libs/" + d) libsDirs);

  haveRootLock =
    if wrPath != null then (builtins.pathExists (wrPath + "/pnpm-lock.yaml"))
    else (builtins.pathExists (repoRoot + "/pnpm-lock.yaml"));
in
{
  inherit srcRoot importerDirs haveRootLock;
}

