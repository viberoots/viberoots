{ pkgs
, lib
, repoRootStr
, devOverrideJSON
, devOverrideCppJSON
, devOverridePyJSON
, isCI
, suppressDevOverrideLog
, overridePresentList ? []
, goOutPaths
, cppOutPaths
, nodeOutPaths
, nodeDevImporters ? {}
, nodeRunnableMeta ? {}
, modulesTomlFor
, pkgPathOf
, targetNameOf
, sanitize
}:
let
  # Build a short token string like: "go cpp py" in preferred order
  presentShort =
    let
      # Stable, human-friendly order
      order = [ "go" "cpp" "python" ];
      presentOrdered = builtins.filter (l: builtins.elem l overridePresentList) order;
      toShort = l: if l == "python" then "py" else l;
    in lib.concatStringsSep " " (map toShort presentOrdered);
  allDeps = (lib.attrValues goOutPaths) ++ (lib.attrValues cppOutPaths) ++ (lib.attrValues nodeOutPaths);
  all = pkgs.runCommand "graph-outputs" { inherit allDeps; } ''
      set -eu
      mkdir -p $out
      mkdir -p $out/bin
      : > $out/manifest.json
      : > $out/build.log
      echo "repoRootStr=${repoRootStr}" >> $out/build.log
      echo "appsDir=${builtins.toString (builtins.toPath (repoRootStr + "/projects/apps"))}" >> $out/build.log
      echo "libsDir=${builtins.toString (builtins.toPath (repoRootStr + "/projects/libs"))}" >> $out/build.log
      echo "devOverrideJSON=${builtins.toJSON devOverrideJSON}" >> $out/build.log
      ${if (!isCI && !suppressDevOverrideLog && ((builtins.length overridePresentList) > 0)) then ''
        echo "[planner] dev overrides present: ${presentShort}" >> $out/build.log
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
          echo "modulesToml: ${builtins.toString (modulesTomlFor n)}" >> $out/build.log
          echo "pkgPath: ${pkgPathOf n}" >> $out/build.log
          echo "targetName: ${targetNameOf n}" >> $out/build.log
          echo "expected subdir(bin): ${pkgPathOf n}/cmd/${targetNameOf n}" >> $out/build.log
          echo "expected srcRoot: (repo root with projects/apps and projects/libs)" >> $out/build.log
          bins=""
          first_bin=""
          if [ -d "${p}/bin" ]; then
            for f in "${p}/bin"/*; do
              if [ -f "$f" ] && [ -x "$f" ]; then
                if [ -z "$bins" ]; then bins="\"$f\""; else bins="$bins, \"$f\""; fi
                if [ -z "$first_bin" ]; then first_bin="$f"; fi
                ln -s "$f" "$out/bin/$(basename "$f")" || true
                ln -s "$f" "$out/bin/${sanitize n}" || true
                ln -s "$f" "$out/bin/go-${sanitize n}" || true
              fi
            done
          fi
          if [ -n "$bins" ]; then
            echo "label=${n} bins=[ $bins ]" >> $out/build.log
            if [ "$first" -eq 0 ]; then echo "," >> $out/manifest.json; fi
            echo "{ \"label\": \"${n}\", \"kind\": \"bin\", \"bins\": [ $bins ], \"aux\": [], \"runnable\": { \"kind\": \"native-bin\", \"run\": { \"prod\": { \"argv\": [ \"$first_bin\" ] } }, \"artifacts\": { \"bins\": [ $bins ] } } }" >> $out/manifest.json
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
          bins=""
          first_bin=""
          if [ -d "${p}/bin" ]; then
            for f in "${p}/bin"/*; do
              if [ -f "$f" ] && [ -x "$f" ]; then
                if [ -z "$bins" ]; then bins="\"$f\""; else bins="$bins, \"$f\""; fi
                if [ -z "$first_bin" ]; then first_bin="$f"; fi
                ln -s "$f" "$out/bin/$(basename "$f")" || true
                ln -s "$f" "$out/bin/${sanitize n}" || true
                ln -s "$f" "$out/bin/cpp-${sanitize n}" || true
              fi
            done
          fi
          if [ -n "$bins" ]; then
            if [ "$first" -eq 0 ]; then echo "," >> $out/manifest.json; fi
            echo "{ \"label\": \"${n}\", \"kind\": \"bin\", \"bins\": [ $bins ], \"aux\": [], \"runnable\": { \"kind\": \"native-bin\", \"run\": { \"prod\": { \"argv\": [ \"$first_bin\" ] } }, \"artifacts\": { \"bins\": [ $bins ] } } }" >> $out/manifest.json
            first=0
          fi
        ''
      ) cppOutPaths)}
      ${lib.concatStringsSep "\n" (lib.mapAttrsToList (n: p:
        ''
          ln -s "${p}" "$out/" || true
          echo "== node target: ${n} ==" >> $out/build.log
          bins=""
          first_bin=""
          if [ -d "${p}/bin" ]; then
            for f in "${p}/bin"/*; do
              if [ -f "$f" ] && [ -x "$f" ]; then
                if [ -z "$bins" ]; then bins="\"$f\""; else bins="$bins, \"$f\""; fi
                if [ -z "$first_bin" ]; then first_bin="$f"; fi
                ln -s "$f" "$out/bin/$(basename "$f")" || true
                ln -s "$f" "$out/bin/${sanitize n}" || true
                ln -s "$f" "$out/bin/node-${sanitize n}" || true
              fi
            done
          fi
          dist="${p}/dist"
          importer="${nodeDevImporters.${n} or ""}"
          webappMode="${(nodeRunnableMeta.${n}.webappMode or "static")}"
          framework="${(nodeRunnableMeta.${n}.framework or "")}"
          serverEntry="$dist/server/index.js"
          clientDir="$dist/client"
          if [ -n "$bins" ]; then
            if [ "$first" -eq 0 ]; then echo "," >> $out/manifest.json; fi
            echo "{ \"label\": \"${n}\", \"kind\": \"bin\", \"bins\": [ $bins ], \"aux\": [], \"runnable\": { \"kind\": \"script\", \"run\": { \"prod\": { \"argv\": [ \"$first_bin\" ] } }, \"artifacts\": { \"bins\": [ $bins ] } } }" >> $out/manifest.json
            first=0
          elif [ "$webappMode" = "ssr" ]; then
            if [ "$first" -eq 0 ]; then echo "," >> $out/manifest.json; fi
            if [ -n "$importer" ]; then
              echo "{ \"label\": \"${n}\", \"kind\": \"app\", \"bins\": [], \"aux\": [], \"runnable\": { \"kind\": \"webapp-ssr\", \"framework\": \"$framework\", \"run\": { \"prod\": { \"argv\": [ \"node\", \"$serverEntry\" ] }, \"dev\": { \"argv\": [ \"pnpm\", \"--dir\", \"$importer\", \"dev:ssr\" ] } }, \"artifacts\": { \"serverEntry\": \"$serverEntry\", \"clientDir\": \"$clientDir\" } } }" >> $out/manifest.json
            else
              echo "{ \"label\": \"${n}\", \"kind\": \"app\", \"bins\": [], \"aux\": [], \"runnable\": { \"kind\": \"webapp-ssr\", \"framework\": \"$framework\", \"run\": { \"prod\": { \"argv\": [ \"node\", \"$serverEntry\" ] } }, \"artifacts\": { \"serverEntry\": \"$serverEntry\", \"clientDir\": \"$clientDir\" } } }" >> $out/manifest.json
            fi
            first=0
          elif [ -d "$dist" ]; then
            if [ "$first" -eq 0 ]; then echo "," >> $out/manifest.json; fi
            if [ -n "$importer" ]; then
              echo "{ \"label\": \"${n}\", \"kind\": \"app\", \"bins\": [], \"aux\": [], \"runnable\": { \"kind\": \"webapp\", \"run\": { \"prod\": { \"argv\": [ \"python3\", \"-m\", \"http.server\", \"--directory\", \"$dist\" ] }, \"dev\": { \"argv\": [ \"pnpm\", \"--dir\", \"$importer\", \"dev\" ] } }, \"artifacts\": { \"dist\": \"$dist\" } } }" >> $out/manifest.json
            else
              echo "{ \"label\": \"${n}\", \"kind\": \"app\", \"bins\": [], \"aux\": [], \"runnable\": { \"kind\": \"webapp\", \"run\": { \"prod\": { \"argv\": [ \"python3\", \"-m\", \"http.server\", \"--directory\", \"$dist\" ] } }, \"artifacts\": { \"dist\": \"$dist\" } } }" >> $out/manifest.json
            fi
            first=0
          fi
        ''
      ) nodeOutPaths)}
      echo ']' >> $out/manifest.json
    '';
in {
  inherit all;
}


