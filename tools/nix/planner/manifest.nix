{ pkgs
, lib
, repoRootStr
, devOverrideJSON
, devOverrideCppJSON
, isCI
, suppressDevOverrideLog
, goOutPaths
, cppOutPaths
, nodeOutPaths
, modulesTomlFor
, pkgPathOf
, targetNameOf
, sanitize
}:
let
  allDeps = (lib.attrValues goOutPaths) ++ (lib.attrValues cppOutPaths) ++ (lib.attrValues nodeOutPaths);
  all = pkgs.runCommand "graph-outputs" { inherit allDeps; } ''
      set -eu
      mkdir -p $out
      mkdir -p $out/bin
      : > $out/manifest.json
      : > $out/build.log
      echo "repoRootStr=${repoRootStr}" >> $out/build.log
      echo "appsDir=${builtins.toString (builtins.toPath (repoRootStr + "/apps"))}" >> $out/build.log
      echo "libsDir=${builtins.toString (builtins.toPath (repoRootStr + "/libs"))}" >> $out/build.log
      echo "devOverrideJSON=${builtins.toJSON devOverrideJSON}" >> $out/build.log
      ${if (!isCI && !suppressDevOverrideLog && ((devOverrideJSON != "") || (devOverrideCppJSON != ""))) then ''
        echo "[planner] dev overrides present:${if devOverrideJSON != "" then " go" else ""}${if devOverrideCppJSON != "" then " cpp" else ""}" >> $out/build.log
      '' else ""}
      echo "goTargets keys: ${lib.concatStringsSep "," (builtins.attrNames goOutPaths)}" >> $out/build.log
      echo "cppTargets bin keys: ${lib.concatStringsSep "," (builtins.attrNames cppOutPaths)}" >> $out/build.log
      echo '[' > $out/manifest.json
      first=1
      ${lib.concatStringsSep "\n" (lib.mapAttrsToList (n: p:
        ''
          ln -s "${p}" "$out/" || true
          echo "== target: ${n} ==" >> $out/build.log
          echo "path: ${p}" >> $out/build.log
          echo "deriver: $(nix-store -q --deriver "${p}" 2>/dev/null || true)" >> $out/build.log
          echo "modulesToml: ${builtins.toString (modulesTomlFor n)}" >> $out/build.log
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
      ${lib.concatStringsSep "\n" (lib.mapAttrsToList (n: p:
        ''
          ln -s "${p}" "$out/" || true
          echo "== cpp target: ${n} ==" >> $out/build.log
          echo "path: ${p}" >> $out/build.log
          (cd "${p}" && { ls -la || true; echo "-- bin --"; ls -la bin 2>/dev/null || true; }) >> $out/build.log || true
          bins=""
          if [ -d "${p}/bin" ]; then
            for f in "${p}/bin"/*; do
              if [ -f "$f" ] && [ -x "$f" ]; then
                if [ -z "$bins" ]; then bins="\"$f\""; else bins="$bins, \"$f\""; fi
                ln -s "$f" "$out/bin/$(basename "$f")" || true
                ln -s "$f" "$out/bin/${sanitize n}" || true
                ln -s "$f" "$out/bin/cpp-${sanitize n}" || true
              fi
            done
          fi
          if [ -n "$bins" ]; then
            if [ "$first" -eq 0 ]; then echo "," >> $out/manifest.json; fi
            echo "{ \"label\": \"${n}\", \"kind\": \"bin\", \"bins\": [ $bins ], \"aux\": [] }" >> $out/manifest.json
            first=0
          fi
        ''
      ) cppOutPaths)}
      ${lib.concatStringsSep "\n" (lib.mapAttrsToList (n: p:
        ''
          ln -s "${p}" "$out/" || true
          echo "== node target: ${n} ==" >> $out/build.log
          (cd "${p}" && { ls -la || true; echo "-- bin --"; ls -la bin 2>/dev/null || true; }) >> $out/build.log || true
          bins=""
          if [ -d "${p}/bin" ]; then
            for f in "${p}/bin"/*; do
              if [ -f "$f" ] && [ -x "$f" ]; then
                if [ -z "$bins" ]; then bins="\"$f\""; else bins="$bins, \"$f\""; fi
                ln -s "$f" "$out/bin/$(basename "$f")" || true
                ln -s "$f" "$out/bin/${sanitize n}" || true
                ln -s "$f" "$out/bin/node-${sanitize n}" || true
              fi
            done
          fi
          if [ -n "$bins" ]; then
            if [ "$first" -eq 0 ]; then echo "," >> $out/manifest.json; fi
            echo "{ \"label\": \"${n}\", \"kind\": \"bin\", \"bins\": [ $bins ], \"aux\": [] }" >> $out/manifest.json
            first=0
          fi
        ''
      ) nodeOutPaths)}
      echo ']' >> $out/manifest.json
    '';
in {
  inherit all;
}


