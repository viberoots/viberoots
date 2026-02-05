{ pkgs, repoRoot, uv2nixLib }:
let
  sanitize = (import ../../templates-common.nix { inherit pkgs; }).sanitizeName;
in
if uv2nixLib == null then
  let
    srcRoot =
      let
        wr = builtins.getEnv "WORKSPACE_ROOT";
      in
      if wr != "" then (builtins.toPath wr) else repoRoot;
    listDirs = base: if builtins.pathExists base then builtins.attrNames (builtins.readDir base) else [ ];
    appsDirs = listDirs (srcRoot + "/projects/apps");
    libsDirs = listDirs (srcRoot + "/projects/libs");
    allImporters = (map (d: "projects/apps/" + d) appsDirs) ++ (map (d: "projects/libs/" + d) libsDirs);
    mkWheelhouseStub =
      importer:
        let
          lockAbs = builtins.toPath (builtins.toString srcRoot + "/" + importer + "/uv.lock");
          lockIn = if builtins.pathExists lockAbs then (builtins.path { path = lockAbs; name = "uv.lock"; }) else null;
        in
        pkgs.stdenvNoCC.mkDerivation {
          pname = "py-wheelhouse";
          version = sanitize importer;
          src = repoRoot;
          dontUnpack = true;
          buildPhase = ''
            set -euo pipefail
            mkdir -p out
            ${if lockIn != null then "cp ${lockIn} out/uv.lock" else ": > out/uv.lock"}
          '';
          installPhase = ''
            set -euo pipefail
            mkdir -p "$out/site"
            cp -R out/. "$out/site/" || true
          '';
        };
  in
  builtins.listToAttrs (map (imp: {
    name = "py-wheelhouse-" + (sanitize imp);
    value = mkWheelhouseStub imp;
  }) (builtins.filter (imp: builtins.pathExists (builtins.toPath (builtins.toString srcRoot + "/" + imp + "/uv.lock"))) allImporters))
else
  let
    T = import ../../lang-templates.nix { inherit pkgs uv2nixLib; };
    srcRoot = repoRoot;
    wrEnv = builtins.getEnv "WORKSPACE_ROOT";
    srcRootEnv = if wrEnv != "" then (builtins.toPath wrEnv) else null;
    listDirs = base: if builtins.pathExists base then builtins.attrNames (builtins.readDir base) else [ ];
    srcRootStr = builtins.toString srcRoot;
    pwdEnv = builtins.getEnv "PWD";
    srcRootPwd = if pwdEnv != "" then (builtins.toPath pwdEnv) else null;
    srcRootPwdStr = if srcRootPwd == null then "" else (builtins.toString srcRootPwd);
    appsPath = builtins.toPath (srcRootStr + "/projects/apps");
    libsPath = builtins.toPath (srcRootStr + "/projects/libs");
    appsEnvPath = if srcRootEnv != null then builtins.toPath ((builtins.toString srcRootEnv) + "/projects/apps") else null;
    libsEnvPath = if srcRootEnv != null then builtins.toPath ((builtins.toString srcRootEnv) + "/projects/libs") else null;
    appsPwdPath = if srcRootPwd != null then builtins.toPath (srcRootPwdStr + "/projects/apps") else null;
    libsPwdPath = if srcRootPwd != null then builtins.toPath (srcRootPwdStr + "/projects/libs") else null;
    appsDirsBase = if builtins.pathExists appsPath then (listDirs appsPath) else [ ];
    libsDirsBase = if builtins.pathExists libsPath then (listDirs libsPath) else [ ];
    appsDirsEnv = if (appsEnvPath != null && builtins.pathExists appsEnvPath) then (listDirs appsEnvPath) else [ ];
    libsDirsEnv = if (libsEnvPath != null && builtins.pathExists libsEnvPath) then (listDirs libsEnvPath) else [ ];
    appsDirsPwd = if (appsPwdPath != null && builtins.pathExists appsPwdPath) then (listDirs appsPwdPath) else [ ];
    libsDirsPwd = if (libsPwdPath != null && builtins.pathExists libsPwdPath) then (listDirs libsPwdPath) else [ ];
    appsDirs = pkgs.lib.unique (appsDirsBase ++ appsDirsEnv ++ appsDirsPwd);
    libsDirs = pkgs.lib.unique (libsDirsBase ++ libsDirsEnv ++ libsDirsPwd);
    allImporters = (map (d: "projects/apps/" + d) appsDirs) ++ (map (d: "projects/libs/" + d) libsDirs);
    hasUvLock =
      imp:
        let
          pSrc = builtins.toPath (srcRootStr + ("/" + imp + "/uv.lock"));
          pEnv = if srcRootEnv == null then null else builtins.toPath ((builtins.toString srcRootEnv) + ("/" + imp + "/uv.lock"));
          pPwd = if srcRootPwd == null then null else builtins.toPath (srcRootPwdStr + ("/" + imp + "/uv.lock"));
        in
        (builtins.pathExists pSrc) || (pEnv != null && builtins.pathExists pEnv) || (pPwd != null && builtins.pathExists pPwd);
    pyImporters = builtins.filter hasUvLock allImporters;
    makePy = importer: groups: T.pyApp {
      name = importer;
      lockfile = importer + "/uv.lock";
      subdir = importer;
      srcRoot = srcRoot;
      groups = groups;
    };
    pyBase = builtins.listToAttrs (map (imp: { name = "py-" + (sanitize imp); value = makePy imp [ ]; }) pyImporters);
    pyDev = builtins.listToAttrs (map (imp: { name = "py-" + (sanitize imp) + "-dev"; value = makePy imp [ "dev" ]; }) pyImporters);
    pyTest = builtins.listToAttrs (map (imp: { name = "py-" + (sanitize imp) + "-test"; value = makePy imp [ "test" ]; }) pyImporters);
    makeWheelhouse = importer: T.pyWheelhouse {
      name = importer;
      lockfile = importer + "/uv.lock";
      subdir = importer;
      srcRoot = srcRoot;
    };
    pyWheelhouse = builtins.listToAttrs (map (imp: { name = "py-wheelhouse-" + (sanitize imp); value = makeWheelhouse imp; }) pyImporters);
    stubWheelhouse =
      let
        importerLocks =
          builtins.filter
            (imp:
              (builtins.pathExists (builtins.toPath (srcRootStr + ("/" + imp + "/uv.lock"))))
              || (srcRootEnv != null && builtins.pathExists (builtins.toPath ((builtins.toString srcRootEnv) + ("/" + imp + "/uv.lock"))))
              || (srcRootPwd != null && builtins.pathExists (builtins.toPath (srcRootPwdStr + ("/" + imp + "/uv.lock")))))
            allImporters;
        mkWheelhouseStub =
          importer:
            let
              lockAbs =
                if srcRootPwd != null && builtins.pathExists (builtins.toPath (srcRootPwdStr + ("/" + importer + "/uv.lock")))
                then (builtins.toPath (srcRootPwdStr + ("/" + importer + "/uv.lock")))
                else if srcRootEnv != null && builtins.pathExists (builtins.toPath ((builtins.toString srcRootEnv) + ("/" + importer + "/uv.lock")))
                then (builtins.toPath ((builtins.toString srcRootEnv) + ("/" + importer + "/uv.lock")))
                else (builtins.toPath (srcRootStr + ("/" + importer + "/uv.lock")));
              lockIn = if builtins.pathExists lockAbs then (builtins.path { path = lockAbs; name = "uv.lock"; }) else null;
            in
            pkgs.stdenvNoCC.mkDerivation {
              pname = "py-wheelhouse";
              version = sanitize importer;
              src = repoRoot;
              dontUnpack = true;
              buildPhase = ''
                set -euo pipefail
                mkdir -p out
                ${if lockIn != null then "cp ${lockIn} out/uv.lock" else ": > out/uv.lock"}
              '';
              installPhase = ''
                set -euo pipefail
                mkdir -p "$out/site"
                cp -R out/. "$out/site/" || true
              '';
            };
      in
      if (builtins.length pyImporters) > 0 then { }
      else builtins.listToAttrs (map (imp: { name = "py-wheelhouse-" + (sanitize imp); value = mkWheelhouseStub imp; }) importerLocks);
  in
  pyBase // pyDev // pyTest // pyWheelhouse // stubWheelhouse


