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
, rustOutPaths
, nodeDevImporters ? {}
, nodeRunnableMeta ? {}
, rustRunnableMeta ? {}
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
  allDeps = (lib.attrValues goOutPaths) ++ (lib.attrValues cppOutPaths) ++ (lib.attrValues nodeOutPaths) ++ (lib.attrValues rustOutPaths);
  all = pkgs.runCommand "graph-outputs" { inherit allDeps; } ''
      set -eu
      mkdir -p $out
      mkdir -p $out/bin
      : > $out/manifest.json
      : > $out/build.log
      echo "repoRootStr=." >> $out/build.log
      echo "appsDir=projects/apps" >> $out/build.log
      echo "libsDir=projects/libs" >> $out/build.log
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
          echo "== rust target: ${n} ==" >> $out/build.log
          bins=""
          first_bin=""
          rust_kind="${rustRunnableMeta.${n}.kind or ""}"
          if [ -d "${p}/bin" ]; then
            for f in "${p}/bin"/*; do
              if [ -f "$f" ] && [ -x "$f" ]; then
                if [ -z "$bins" ]; then bins="\"$f\""; else bins="$bins, \"$f\""; fi
                if [ -z "$first_bin" ]; then first_bin="$f"; fi
                ln -s "$f" "$out/bin/$(basename "$f")" || true
                ln -s "$f" "$out/bin/rust-${sanitize n}" || true
              fi
            done
          fi
          if [ -n "$bins" ]; then
            if [ "$first" -eq 0 ]; then echo "," >> $out/manifest.json; fi
            if [ "$rust_kind" = "tauri" ]; then
              tauri_platform="${rustRunnableMeta.${n}.tauriTarget.platform or ""}"
              tauri_artifact_kind="${rustRunnableMeta.${n}.tauriTarget.artifactKind or ""}"
              tauri_bundle_identifier="${rustRunnableMeta.${n}.tauriTarget.bundleIdentifier or ""}"
              tauri_package_name="${rustRunnableMeta.${n}.tauriTarget.packageName or ""}"
              tauri_signing_mode="${rustRunnableMeta.${n}.tauriTarget.signingMode or ""}"
              tauri_deployment_eligibility="${rustRunnableMeta.${n}.tauriTarget.deploymentEligibility or ""}"
              test "$tauri_platform" = "desktop-darwin" || { echo "rust planner: Tauri target ${n} has unsupported runnable platform $tauri_platform" >&2; exit 1; }
              test "$tauri_artifact_kind" = "macos-app" || { echo "rust planner: Tauri target ${n} has unsupported runnable artifact kind $tauri_artifact_kind" >&2; exit 1; }
              test "$tauri_signing_mode" = "adhoc-platform" || { echo "rust planner: Tauri target ${n} has unsupported runnable signing mode $tauri_signing_mode" >&2; exit 1; }
              test "$tauri_deployment_eligibility" = "not-eligible" || { echo "rust planner: Tauri target ${n} must not be deployment eligible" >&2; exit 1; }
              app_dir="${p}/app"
              artifact_manifest="${p}/share/viberoots-tauri/artifact-manifest.json"
              test -d "$app_dir" || { echo "rust planner: Tauri target ${n} missing app bundle directory $app_dir" >&2; exit 1; }
              test -f "$artifact_manifest" || { echo "rust planner: Tauri target ${n} missing artifact manifest $artifact_manifest" >&2; exit 1; }
              app_executable="$(${pkgs.jq}/bin/jq -er '.appExecutable | strings | select(length > 0)' "$artifact_manifest")"
              case "$app_executable" in
                "${p}/app/"*.app/Contents/MacOS/*) ;;
                *) echo "rust planner: Tauri target ${n} declared an executable outside its application bundle" >&2; exit 1 ;;
              esac
              test -x "$app_executable" || { echo "rust planner: Tauri target ${n} application executable is not executable" >&2; exit 1; }
              echo "{ \"label\": \"${n}\", \"kind\": \"app\", \"bins\": [ $bins ], \"aux\": [], \"tauriTarget\": { \"family\": \"tauri\", \"platform\": \"$tauri_platform\", \"artifactKind\": \"$tauri_artifact_kind\", \"bundleIdentifier\": \"$tauri_bundle_identifier\", \"packageName\": \"$tauri_package_name\", \"signingMode\": \"$tauri_signing_mode\", \"deploymentEligibility\": \"$tauri_deployment_eligibility\" }, \"runnable\": { \"kind\": \"desktop-app\", \"run\": { \"prod\": { \"argv\": [ \"$app_executable\" ] }, \"dev\": { \"argv\": [ \"viberoots-tauri-dev\", \"${n}\" ] } }, \"artifacts\": { \"bins\": [ $bins ], \"applicationBundle\": \"$app_dir\", \"appExecutable\": \"$app_executable\", \"artifactManifest\": \"$artifact_manifest\" } } }" >> $out/manifest.json
            else
              echo "{ \"label\": \"${n}\", \"kind\": \"bin\", \"bins\": [ $bins ], \"aux\": [], \"runnable\": { \"kind\": \"native-bin\", \"run\": { \"prod\": { \"argv\": [ \"$first_bin\" ] } }, \"artifacts\": { \"bins\": [ $bins ] } } }" >> $out/manifest.json
            fi
            first=0
          fi
        ''
      ) rustOutPaths)}
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
          serverWasmContract=""
          serverWasmArtifactField=""
          serverWasmManifest="$dist/server/wasm-modules.manifest.json"
          if [ -f "$serverWasmManifest" ]; then
            defaultWasmModuleKey="$(${pkgs.jq}/bin/jq -r '.defaultModuleKey // ""' "$serverWasmManifest")"
            if [ -n "$defaultWasmModuleKey" ]; then
              serverRuntimeDest="$(${pkgs.jq}/bin/jq -r --arg key "$defaultWasmModuleKey" '.modules[]? | select(.moduleKey == $key) | .runtimeDestinations.server // empty' "$serverWasmManifest" | sed -n '1p')"
              if [ -z "$serverRuntimeDest" ]; then
                echo "node planner: webapp target ${n} missing runtimeDestinations.server for default module '$defaultWasmModuleKey' in $serverWasmManifest" >&2
                exit 1
              fi
              serverWasmContract="$dist/$serverRuntimeDest"
              if [ ! -f "$serverWasmContract" ]; then
                echo "node planner: webapp target ${n} missing canonical server wasm artifact $serverWasmContract" >&2
                exit 1
              fi
              serverWasmArtifactField=", \"serverWasmContract\": \"$serverWasmContract\""
            fi
          fi
          if [ -n "$bins" ]; then
            if [ "$first" -eq 0 ]; then echo "," >> $out/manifest.json; fi
            echo "{ \"label\": \"${n}\", \"kind\": \"bin\", \"bins\": [ $bins ], \"aux\": [], \"runnable\": { \"kind\": \"script\", \"run\": { \"prod\": { \"argv\": [ \"$first_bin\" ] } }, \"artifacts\": { \"bins\": [ $bins ] } } }" >> $out/manifest.json
            first=0
          elif [ "$webappMode" = "ssr" ]; then
            if [ "$first" -eq 0 ]; then echo "," >> $out/manifest.json; fi
            if [ -n "$importer" ]; then
              echo "{ \"label\": \"${n}\", \"kind\": \"app\", \"bins\": [], \"aux\": [], \"runnable\": { \"kind\": \"webapp-ssr\", \"framework\": \"$framework\", \"run\": { \"prod\": { \"argv\": [ \"node\", \"$serverEntry\" ] }, \"dev\": { \"argv\": [ \"pnpm\", \"--dir\", \"$importer\", \"dev:ssr\" ] } }, \"artifacts\": { \"serverEntry\": \"$serverEntry\", \"clientDir\": \"$clientDir\"$serverWasmArtifactField } } }" >> $out/manifest.json
            else
              echo "{ \"label\": \"${n}\", \"kind\": \"app\", \"bins\": [], \"aux\": [], \"runnable\": { \"kind\": \"webapp-ssr\", \"framework\": \"$framework\", \"run\": { \"prod\": { \"argv\": [ \"node\", \"$serverEntry\" ] } }, \"artifacts\": { \"serverEntry\": \"$serverEntry\", \"clientDir\": \"$clientDir\"$serverWasmArtifactField } } }" >> $out/manifest.json
            fi
            first=0
          elif [ -d "$dist" ]; then
            if [ "$first" -eq 0 ]; then echo "," >> $out/manifest.json; fi
            if [ -n "$importer" ]; then
              echo "{ \"label\": \"${n}\", \"kind\": \"app\", \"bins\": [], \"aux\": [], \"runnable\": { \"kind\": \"webapp\", \"run\": { \"prod\": { \"argv\": [ \"${pkgs.python3}/bin/python3\", \"-m\", \"http.server\", \"--directory\", \"$dist\" ] }, \"dev\": { \"argv\": [ \"pnpm\", \"--dir\", \"$importer\", \"dev\" ] } }, \"artifacts\": { \"dist\": \"$dist\"$serverWasmArtifactField } } }" >> $out/manifest.json
            else
              echo "{ \"label\": \"${n}\", \"kind\": \"app\", \"bins\": [], \"aux\": [], \"runnable\": { \"kind\": \"webapp\", \"run\": { \"prod\": { \"argv\": [ \"${pkgs.python3}/bin/python3\", \"-m\", \"http.server\", \"--directory\", \"$dist\" ] } }, \"artifacts\": { \"dist\": \"$dist\"$serverWasmArtifactField } } }" >> $out/manifest.json
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
