{ pkgs }:
let
  lib = pkgs.lib;
  # Require gomod2nix overlay builder; fail fast if missing
  buildGoFn = if pkgs ? buildGoApplication then pkgs.buildGoApplication
              else builtins.throw "gomod2nix overlay (buildGoApplication) is required; no vendoring fallback";
  takesOverrides = (builtins.hasAttr "overrides" (builtins.functionArgs (pkgs.buildGoApplication)));

  patchesMapFromDir = patchDir:
    let
      names = if builtins.pathExists patchDir then builtins.attrNames (builtins.readDir patchDir) else [];
      isPatch = name: lib.hasSuffix ".patch" name;
      decode = name:
        let base = lib.removeSuffix ".patch" name;
            at = lib.strLastIndexOf base "@";
            enc = lib.substring 0 at base;
            ver = lib.substring (at + 1) (lib.stringLength base - at - 1) base;
            importPath = lib.replaceStrings ["__"] ["/"] enc;
        in { path = lib.toLower importPath; ver = lib.toLower ver; };
      step = acc: name:
        let d = decode name;
            keyWithVer = "${d.path}@${d.ver}";
            keyNoVer = d.path;
            valWith = (acc.${keyWithVer} or []) ++ [ "${patchDir}/${name}" ];
            valNo = (acc.${keyNoVer} or []) ++ [ "${patchDir}/${name}" ];
        in acc // { "${keyWithVer}" = valWith; "${keyNoVer}" = valNo; };
    in builtins.foldl' step {} (lib.filter isPatch names);

  # Emit a concise warning locally when dev overrides are set; in CI we still hard-fail below.
  readDevOverrides = envName: let
    v = builtins.getEnv envName;
    dev = if v == "" then {} else builtins.fromJSON v;
  in if (builtins.getEnv "CI") != "true" && dev != {}
     then builtins.trace "[NIX_GO_DEV_OVERRIDE_JSON active] Local derivation hashes will differ; unset before sharing cache artifacts." dev
     else dev;
in
{
  goApp = { name, modulesToml, devOverrideEnv ? "NIX_GO_DEV_OVERRIDE_JSON", devOverridesMap ? {}, subdir ? ".", srcRoot ? ../.., patchDir ? ../../patches/go }:
    let
      patchesMap = patchesMapFromDir patchDir;
      devOverridesEnv = readDevOverrides devOverrideEnv;
      _ = if (builtins.getEnv "CI") == "true" && (builtins.getEnv devOverrideEnv) != "" then
            builtins.throw "Dev overrides are forbidden in CI" else null;
      devOverrides = (devOverridesMap // devOverridesEnv);
      targetName = let parts = lib.splitString ":" name; in if (builtins.length parts) > 1 then lib.elemAt parts 1 else (let left = lib.elemAt parts 0; segs = lib.splitString "/" left; in if (builtins.length segs) > 0 then lib.elemAt segs ((builtins.length segs) - 1) else left);
      srcAbs = lib.cleanSource srcRoot;
      baseArgs = {
        pname = "go-${lib.replaceStrings ["//" ":" "/"] ["" "-" "-"] name}";
        version = "0.1.0";
        src = srcAbs;
        modules = modulesToml;
        # Build entrypoint within module root; include "." to ensure module is realized even if no cmd/*
        subPackages = [ "." "cmd/${targetName}" ];
        # Allow reference to go toolchain when GOFLAGS may be in env for tests
        disallowedReferences = [];
        # Avoid vendor mode; gomod2nix provides modules (exported in configurePhase)
        nativeBuildInputs = [ pkgs.unzip ];
        configurePhase = ''
          runHook preConfigure

          export GOCACHE=$TMPDIR/go-cache
          export GOPATH="$TMPDIR/go"
          export GOSUMDB=off
          cd "''${modRoot:-.}"

          runHook postConfigure
        '';
      };
      args = baseArgs // ({
        # Module root is subdir with /cmd/${targetName} stripped
        pwd = builtins.toPath ("${srcAbs}/" + (lib.removeSuffix "/cmd/${targetName}" subdir));
        modRoot = (lib.removeSuffix "/cmd/${targetName}" subdir);
      } // (if takesOverrides then {
        overrides = module: old:
          let
            mType = builtins.typeOf module;
            pkg = if mType == "string" then module else (module.goPackagePath or (old.goPackagePath or ""));
            ver = if mType == "string" then (old.version or "") else (module.version or (old.version or ""));
            keyWithVer = if pkg != "" && ver != "" then "${pkg}@${ver}" else pkg;
            patchList = (patchesMap.${keyWithVer} or []) ++ (patchesMap.${pkg} or []);
            srcOverride = if devOverrides ? ${keyWithVer}
                          then devOverrides.${keyWithVer}
                          else (devOverrides.${pkg} or old.src);
          in old // {
            patches = (old.patches or []) ++ patchList;
            src = srcOverride;
          };
      } else {}));
    in buildGoFn args;

  goLib = { name, modulesToml, devOverrideEnv ? "NIX_GO_DEV_OVERRIDE_JSON", subdir ? ".", srcRoot ? ../.., patchDir ? ../../patches/go }:
    let
      patchesMap = patchesMapFromDir patchDir;
      devOverridesEnv = readDevOverrides devOverrideEnv;
      _ = if (builtins.getEnv "CI") == "true" && (builtins.getEnv devOverrideEnv) != "" then
            builtins.throw "Dev overrides are forbidden in CI" else null;
      srcAbs = lib.cleanSource srcRoot;
      baseArgs = {
        pname = "golib-${lib.replaceStrings ["//" ":" "/"] ["" "-" "-"] name}";
        version = "0.1.0";
        src = srcAbs;
        modules = modulesToml;
        # Build the module root
        # For libraries, build subPackages '.' plus any cmd/<name> bins if present
        subPackages = [ "." ];
        # Avoid vendor mode; gomod2nix provides modules (exported in configurePhase)
        disallowedReferences = [];
        configurePhase = ''
          runHook preConfigure

          export GOCACHE=$TMPDIR/go-cache
          export GOPATH="$TMPDIR/go"
          export GOSUMDB=off
          export GOFLAGS="-mod=mod"
          cd "''${modRoot:-.}"

          runHook postConfigure
        '';
      };
      args = baseArgs // ({
        # Change to the library module root
        pwd = builtins.toPath ("${srcAbs}/" + subdir);
        modRoot = subdir;
      } // (if takesOverrides then {
        overrides = module: old:
          let
            mType = builtins.typeOf module;
            pkg = if mType == "string" then module else (module.goPackagePath or (old.goPackagePath or ""));
            ver = if mType == "string" then (old.version or "") else (module.version or (old.version or ""));
            keyWithVer = if pkg != "" && ver != "" then "${pkg}@${ver}" else pkg;
            patchList = (patchesMap.${keyWithVer} or []) ++ (patchesMap.${pkg} or []);
            srcOverride = if devOverridesEnv ? ${keyWithVer}
                          then devOverridesEnv.${keyWithVer}
                          else (devOverridesEnv.${pkg} or old.src);
          in old // {
            patches = (old.patches or []) ++ patchList;
            src = srcOverride;
          };
      } else {}));
    in buildGoFn args;
}


