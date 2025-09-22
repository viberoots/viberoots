{ pkgs, src ? ../../. }:
let
  lib = pkgs.lib;
  # Prefer a live workspace path when WORKSPACE_ROOT is provided (requires --impure)
  # Falls back to the flake src snapshot when not set.
  repoRootStr = let wr = builtins.getEnv "WORKSPACE_ROOT"; in if (wr != "") then wr else builtins.toString src;
  repoRoot = builtins.toPath repoRootStr;
  # Filtered source that includes both apps/* and libs/* so local replaces resolve
  appsLibsSrc = lib.cleanSourceWith {
    src = repoRoot;
    filter = path: type:
      let p = builtins.toString path;
          rootP = builtins.toString repoRoot;
          rel = lib.removePrefix (rootP + "/") p;
      in
      # keep the root and anything under apps/ or libs/
      p == rootP || lib.hasPrefix "apps/" rel || lib.hasPrefix "libs/" rel;
  };

  # Helper to read module path from a go.mod file under the live repo root (impure)
  readModulePathLive = rel:
    let p = builtins.toPath (repoRootStr + "/" + rel); in
      if builtins.pathExists p then (
        let txt = builtins.readFile p;
            parts = lib.filter (s: lib.hasPrefix "module " s) (lib.splitString "\n" txt);
        in if parts == [] then "" else lib.removePrefix "module " (lib.head parts)
      ) else "";

  # Vendor staging removed — rely on gomod2nix and overrides only
  graphPath = builtins.toPath (repoRootStr + "/tools/buck/graph.json");
  nodes = if builtins.pathExists graphPath then builtins.fromJSON (builtins.readFile graphPath) else [];
  T = import ./lang-templates.nix { inherit pkgs; };
  M = if builtins.pathExists ./mapping.nix then import ./mapping.nix else {};
  D = M.dispatch or {};

  get = attrs: k: attrs.${k} or null;

  pick = n:
    let rt = get n "rule_type"; in
      if builtins.hasAttr rt D then D.${rt}
      else if lib.hasPrefix "go_" rt then {
        template = "go";
        kind = if lib.hasSuffix "_binary" rt then "bin" else "lib";
      } else null;

  modulesTomlDefault = builtins.toPath (repoRootStr + "/gomod2nix.toml");
  haveModulesDefault = builtins.pathExists modulesTomlDefault;
  # repoRoot provided via 'src'

  modulesTomlFor = name: modulesTomlDefault;

  # Build a map of module import path -> live source for local libs (for replaces)
  localModuleOverrides =
    let
      modForLib = nm: readModulePathLive ("libs/" + nm + "/go.mod");
      entries = lib.filter (kv: (lib.elemAt kv 1) != "") (map (nm: [ nm (modForLib nm) ]) libNames);
      mk = acc: kv:
        let nm = lib.elemAt kv 0; m = lib.elemAt kv 1; p = builtins.toPath (repoRootStr + "/libs/" + nm);
        in acc // { "${m}" = p; "${m}@v0.0.0" = p; };
    in builtins.foldl' mk {} entries;

  sanitize = s: lib.replaceStrings ["//" ":" "/" " "] ["" "-" "-" "-"] s;

  pkgPathOf = name:
    let left = lib.elemAt (lib.splitString ":" name) 0;
        rel = lib.removePrefix "//" left;
    in if rel == "" then "." else rel;

  targetNameOf = name: lib.elemAt (lib.splitString ":" name) 1;

  mkGo = name: kind:
    if haveModulesDefault then (
      if kind == "bin" then T.goApp {
        inherit name; modulesToml = modulesTomlFor name;
        # Build from repo root; module root subdir is apps/<name>
        srcRoot = repoRoot;
        devOverridesMap = localModuleOverrides;
        # Pass module root for pwd/modRoot
        subdir = (pkgPathOf name);
      } else T.goLib {
        inherit name; modulesToml = modulesTomlFor name;
        # Build from repo root; package dir is libs/<name>
        srcRoot = repoRoot;
        subdir = (pkgPathOf name);
      }
    ) else pkgs.runCommand "stub-${lib.replaceStrings ["//" ":" "/"] ["" "-" "-"] name}" {} ''
      mkdir -p $out
      echo stub > $out/.stub
    '';

  goTargetsFromGraph = lib.listToAttrs (map (n:
    let name = get n "name"; k = pick n; in {
      inherit name;
      value = if k == null then pkgs.runCommand "noop-${lib.replaceStrings ["//" ":" "/"] ["" "-" "-"] name}" {} "mkdir -p $out; touch $out/.noop"
              else mkGo name k.kind;
    }
  ) (builtins.filter (n:
        let nm = get n "name"; rt = get n "rule_type"; in
        nm != null && rt != null && lib.hasPrefix "go_" rt
     ) nodes));

  # Fallback discovery when Buck graph is unavailable: scan apps/* and libs/*
  safeReadDir = p: if builtins.pathExists p then builtins.readDir p else {};
  appsDir = builtins.toPath (repoRootStr + "/apps");
  libsDir = builtins.toPath (repoRootStr + "/libs");
  appNames = builtins.attrNames (safeReadDir appsDir);
  libNames = builtins.attrNames (safeReadDir libsDir);

  discoveredApps = lib.listToAttrs (map (nm: let
      label = "//apps/" + nm + ":" + nm;
      appDir = builtins.toPath (repoRootStr + "/apps/" + nm);
      cmdDir = builtins.toPath (repoRootStr + "/apps/" + nm + "/cmd/" + nm);
    in {
      name = label;
      value = if builtins.pathExists cmdDir then T.goApp {
        name = label; modulesToml = modulesTomlFor label;
        srcRoot = repoRoot; devOverridesMap = localModuleOverrides; subdir = "apps/" + nm;
      } else pkgs.runCommand "noop-${lib.replaceStrings ["//" ":" "/"] ["" "-" "-"] label}" {} "mkdir -p $out; touch $out/.noop";
    }) appNames);

  discoveredLibs = lib.listToAttrs (map (nm: let
      label = "//libs/" + nm + ":" + nm;
      modRoot = builtins.toPath (repoRootStr + "/libs/" + nm);
      goMod = builtins.toPath (repoRootStr + "/libs/" + nm + "/go.mod");
    in {
      name = label;
      value = if builtins.pathExists goMod then T.goLib {
        name = label; modulesToml = modulesTomlFor label;
        srcRoot = repoRoot; subdir = "libs/" + nm;
      } else pkgs.runCommand "noop-${lib.replaceStrings ["//" ":" "/"] ["" "-" "-"] label}" {} "mkdir -p $out; touch $out/.noop";
    }) libNames);

  goTargets = goTargetsFromGraph // discoveredApps // discoveredLibs;
  goOutPaths = lib.mapAttrs (n: p: builtins.toString p) goTargets;

  all = pkgs.stdenv.mkDerivation {
    name = "graph-outputs";
    outputs = [ "out" ];
    phases = [ "installPhase" ];
    installPhase = ''
      set -eu
      mkdir -p $out
      mkdir -p $out/bin
      : > $out/manifest.json
      : > $out/build.log
      echo "WORKSPACE_ROOT=${builtins.getEnv "WORKSPACE_ROOT"}" >> $out/build.log
      echo "repoRootStr=${repoRootStr}" >> $out/build.log
      echo "appsDir=${builtins.toString (builtins.toPath (repoRootStr + "/apps"))}" >> $out/build.log
      echo "libsDir=${builtins.toString (builtins.toPath (repoRootStr + "/libs"))}" >> $out/build.log
      echo "goTargets keys: ${lib.concatStringsSep "," (builtins.attrNames goOutPaths)}" >> $out/build.log
      echo "apps discovered: ${lib.concatStringsSep "," appNames}" >> $out/build.log
      echo "libs discovered: ${lib.concatStringsSep "," libNames}" >> $out/build.log
      echo '[' > $out/manifest.json
      first=1
      ${lib.concatStringsSep "\n" (lib.mapAttrsToList (n: p:
        ''
          ln -s "${p}" "$out/" || true
          echo "== target: ${n} ==" >> $out/build.log
          echo "path: ${p}" >> $out/build.log
          echo "pkgPath: ${pkgPathOf n}" >> $out/build.log
          echo "targetName: ${targetNameOf n}" >> $out/build.log
          echo "expected subdir(bin): ${pkgPathOf n}/cmd/${targetNameOf n}" >> $out/build.log
          echo "expected srcRoot: (repo root with apps/libs)" >> $out/build.log
          echo "tree (depth 2) of out path:" >> $out/build.log
          (cd "${p}" && { ls -la || true; echo "-- bin --"; ls -la bin 2>/dev/null || true; }) >> $out/build.log || true
          bins=""
          if [ -d "${p}/bin" ]; then
            for f in "${p}/bin"/*; do
              if [ -f "$f" ] && [ -x "$f" ]; then
                if [ -z "$bins" ]; then bins="\"$f\""; else bins="$bins, \"$f\""; fi
                ln -s "$f" "$out/bin/$(basename "$f")" || true
                ln -s "$f" "$out/bin/${sanitize n}" || true
                ln -s "$f" "$out/bin/go-${sanitize n}" || true
              fi
            done
          fi
          if [ -n "$bins" ]; then
            echo "label=${n} bins=[ $bins ]" >> $out/build.log
            if [ "$first" -eq 0 ]; then echo "," >> $out/manifest.json; fi
            echo "{ \"label\": \"${n}\", \"kind\": \"bin\", \"bins\": [ $bins ], \"aux\": [] }" >> $out/manifest.json
            first=0
          else
            echo "label=${n} bins=[]" >> $out/build.log
          fi
        ''
      ) goOutPaths)}
      echo ']' >> $out/manifest.json
    '';
  };
in
{ inherit goTargets all; }


