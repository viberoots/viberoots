# flake.nix — PR 1 devshell and zx-wrapper
{
  description = "bucknix-fresh devshell and scaffolding";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # Pin buck2 to match the upstream binary version on PATH (201beb86106f...)
    buck2.url = "github:facebook/buck2/201beb86106fecdc84e30260b0f1abb5bf576988";
    gomod2nix.url = "github:nix-community/gomod2nix";
    gomod2nix.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { self, nixpkgs, buck2, gomod2nix }:
  let
    systems = [ "aarch64-darwin" "aarch64-linux" "x86_64-linux" ];
    forAllSystems = f: nixpkgs.lib.genAttrs systems (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ gomod2nix.overlays.default ];
        };
        zx-wrapper = pkgs.writeShellScriptBin "zx-wrapper" ''
          set -euo pipefail
          exec ${pkgs.nodejs_22}/bin/node \
            --experimental-strip-types \
            --experimental-top-level-await \
            --disable-warning=ExperimentalWarning \
            --import="${pkgs.nodePackages.zx}/lib/node_modules/zx/build/globals.js" \
            "$@"
        '';


        node = pkgs.nodejs_22;
        pnpm = pkgs.pnpm;

        # Inputs for pnpm fetch (FOD): include resolution inputs to avoid missing tarballs
        storeSrc = pkgs.lib.cleanSourceWith {
          src = ./.;
          filter = path: type:
            (builtins.match ".*/pnpm-lock\\.yaml" path != null)
            || (builtins.match ".*/package\\.json" path != null)
            || (builtins.match ".*/pnpm-workspace\\.yaml" path != null)
            || (builtins.match ".*/\\.npmrc" path != null)
            || (builtins.match ".*/patches/pnpm(/.*)?" path != null);
        };

        pnpm-store = pkgs.stdenvNoCC.mkDerivation (let certs = pkgs.cacert; in {
          pname = "pnpm-store";
          version = "lock-${builtins.hashFile "sha256" ./pnpm-lock.yaml}";
          src = storeSrc;
          nativeBuildInputs = [ pkgs.nodejs_22 pkgs.pnpm ];
          outputHashMode = "recursive";
          # Temporary placeholder; updated by tools/dev/update-pnpm-hash.ts after first build attempt
          outputHash     = "sha256-nSySfpEzhcuYkYb9q2wFWFWbU1Zvr0yuGgg4OpEu6cc=";
          dontPatchShebangs = true;
          unpackPhase = ''
            runHook preUnpack
            cp -r $src source
            chmod -R u+rwX source
            cd source
            runHook postUnpack
          '';
          buildPhase = ''
            runHook preBuild
            export SSL_CERT_FILE=${certs}/etc/ssl/certs/ca-bundle.crt
            export NIX_SSL_CERT_FILE=${certs}/etc/ssl/certs/ca-bundle.crt
            export NODE_EXTRA_CA_CERTS=${certs}/etc/ssl/certs/ca-bundle.crt
            export HOME=$(pwd)/.home
            mkdir -p "$HOME"
            # Write store only under $out to keep FOD pure and content-addressed
            pnpm config set store-dir "$out/store"
            pnpm fetch --frozen-lockfile
            runHook postBuild
          '';
          # No installPhase needed; store already at $out/store
          passthru.lockHash = builtins.hashFile "sha256" ./pnpm-lock.yaml;
        });

        # Limit inputs so node-modules changes only when dependency metadata changes
        minimalSrc = pkgs.lib.cleanSourceWith {
          src = ./.;
          filter = path: type:
            (builtins.match ".*/pnpm-lock\\.yaml" path != null)
            || (builtins.match ".*/package\\.json" path != null)
            || (builtins.match ".*/pnpm-workspace\\.yaml" path != null)
            || (builtins.match ".*/\\.npmrc" path != null)
            || (builtins.match ".*/patches/pnpm(/.*)?" path != null);
        };

        node-modules = pkgs.stdenvNoCC.mkDerivation (let certs = pkgs.cacert; in {
          pname = "node-modules";
          version = "lock-${builtins.hashFile "sha256" ./pnpm-lock.yaml}";
          src = minimalSrc;
          nativeBuildInputs = [ node pnpm ];
          unpackPhase = ''
            runHook preUnpack
            cp -r $src source
            chmod -R u+rwX source
            cd source
            runHook postUnpack
          '';
          buildPhase = ''
            runHook preBuild
            export SSL_CERT_FILE=${certs}/etc/ssl/certs/ca-bundle.crt
            export NIX_SSL_CERT_FILE=${certs}/etc/ssl/certs/ca-bundle.crt
            export NODE_EXTRA_CA_CERTS=${certs}/etc/ssl/certs/ca-bundle.crt
            export HOME=$(pwd)/.home
            mkdir -p "$HOME"
            # Read from the fixed-output store; PNPM writes only to working dirs
            pnpm config set store-dir "${pnpm-store}/store"
            pnpm install --offline --frozen-lockfile
            runHook postBuild
          '';
          installPhase = ''
            runHook preInstall
            mkdir -p $out
            if [ -d node_modules ]; then
              cp -R node_modules $out/
            fi
            if [ -d .pnpm ]; then
              cp -R .pnpm $out/
            fi
            runHook postInstall
          '';
          passthru.lockHash = builtins.hashFile "sha256" ./pnpm-lock.yaml;
        });
      in f { inherit pkgs zx-wrapper node pnpm pnpm-store node-modules system; buck2Input = buck2; }
    );
  in {
    devShells = forAllSystems ({ pkgs, zx-wrapper, node-modules, buck2Input, system, ... }:
      {
        default = pkgs.mkShell {
          shellHook = ''
            # link Nix-built node_modules for IDEs/CLIs (read-only)
            if [ -e node_modules ] && [ ! -L node_modules ]; then
              echo "(devShell) existing non-symlink node_modules detected; not overwriting" >&2 || true
            else
              out_path=$(nix build .#node-modules --no-link --accept-flake-config --print-out-paths 2>/dev/null || true)
              if [ -n "$out_path" ]; then
                ln -sfn "$out_path/node_modules" node_modules || true
                if [ -d "$out_path/node_modules/.bin" ]; then
                  export PATH="$out_path/node_modules/.bin:$PATH"
                fi
              fi
            fi

            export PATH="$PWD/tools/bin:$PATH"
            # Prefer upstream buck2 binary on PATH (fallback to flake buck2)
            buck_out=$(nix build github:facebook/buck2#buck2 --no-link --print-out-paths 2>/dev/null || true)
            if [ -n "$buck_out" ] && [ -x "$buck_out/bin/buck2" ]; then
              export PATH="$buck_out/bin:$PATH"
            else
              buck_out_local=$(nix build .#buck2 --no-link --accept-flake-config --print-out-paths 2>/dev/null || true)
              if [ -n "$buck_out_local" ] && [ -x "$buck_out_local/bin/buck2" ]; then
                export PATH="$buck_out_local/bin:$PATH"
              fi
            fi

            # Always prepare zsh completions for any zsh spawned later (guarded until node_modules exists)
            mkdir -p .nix-zsh
            cat > .nix-zsh/.zshenv <<'EOF'
if [[ -o interactive ]]; then
  # Prompt for zsh
  PROMPT='%F{green}[nix-shell]%f %m:%~$ '
  autoload -Uz compinit
  compinit -i
  if [ -d "node_modules/zx" ]; then
    eval "$(scaf completions zsh)"
  fi
fi
EOF
            export ZDOTDIR="$PWD/.nix-zsh"
            # Also create a .zshrc for shells that ignore .zshenv for completions
            cat > .nix-zsh/.zshrc <<'EOF'
PROMPT='%F{green}[nix-shell]%f %m:%~$ '
autoload -Uz compinit
compinit -i
# Aliases for convenience
alias b=build
alias v=verify
alias t=verify
if [ -d "node_modules/zx" ]; then
  eval "$(scaf completions zsh)"
fi
EOF

            if [ -n "$BASH_VERSION" ]; then
              # Prompt for bash
              export PS1="\n\033[32m[nix-shell]\033[0m \h:\w$ "
              if [ -d "node_modules/zx" ]; then
                eval "$(scaf completions bash)"
              fi
              alias b=build
              alias v=verify
              alias t=verify
            fi

            # Also add aliases for zsh sessions
            if [ -n "$ZSH_VERSION" ]; then
              alias b=build
              alias v=verify
              alias t=verify
            fi

            # Ensure Buck2 config uses a prelude that matches upstream buck2, unless locked
            if [ "''${BUCK_CONFIG_LOCK:-0}" = "1" ]; then
              : # Skip buck config mutation; locked by caller
            else
              pre_out=$(nix build .#buck2-prelude --no-link --accept-flake-config --print-out-paths 2>/dev/null || true)
              if [ -n "$pre_out" ]; then
                PRELUDE_PATH="$pre_out/prelude"
              else
                PRELUDE_PATH="$(${pkgs.nix}/bin/nix eval --raw .#inputs.buck2.outPath 2>/dev/null)/prelude"
              fi
              # Guarantee buck root marker
              : > .buckroot
            # Ensure a buildfile section exists
            if ! grep -q "^\[buildfile\]" .buckconfig 2>/dev/null; then
              printf "[buildfile]\nname = TARGETS\n\n" >> .buckconfig
            elif ! grep -q "^name\s*=\s*TARGETS" .buckconfig; then
              # Replace or append name in [buildfile]
              if command -v gsed >/dev/null 2>&1; then SED=gsed; else SED=sed; fi
              "$SED" -i.bak -e '/^\[buildfile\]/{:a;n;/^\[/q; s/^name\s*=.*/name = TARGETS/; ta}' .buckconfig || true
              rm -f .buckconfig.bak
            fi

            # Ensure [repositories] with prelude alias exists and points to PRELUDE_PATH
            if ! grep -q "^\[repositories\]" .buckconfig 2>/dev/null; then
              printf "[repositories]\nroot = .\nprelude = %s\ntoolchains = %s/toolchains\nfbsource = %s/third-party/fbsource_stub\nfbcode = %s/third-party/fbcode_stub\n\n" "$PRELUDE_PATH" "$PRELUDE_PATH" "$PRELUDE_PATH" "$PRELUDE_PATH" >> .buckconfig
            else
              if command -v gsed >/dev/null 2>&1; then SED=gsed; else SED=sed; fi
              if grep -q "^prelude\s*=\s*" .buckconfig; then
                "$SED" -i.bak -E "s|^prelude\s*=.*$|prelude = ''${PRELUDE_PATH}|" .buckconfig || true
              else
                # Append into the repositories section
                awk -v repl="prelude = ''${PRELUDE_PATH}" '
                  BEGIN{printed=0}
                  {print}
                  /^\[repositories\]$/ {section=1; next}
                  section && /^(\[|$)/ {
                    if (!printed) {print repl"\n"; printed=1}
                    section=0
                  }
                  END{if (section && !printed) print repl}
                ' .buckconfig > .buckconfig.tmp && mv .buckconfig.tmp .buckconfig || true
              fi
              # Ensure toolchains mapping
              if grep -q "^toolchains\s*=\s*" .buckconfig; then
                "$SED" -i.bak -E "s|^toolchains\s*=.*$|toolchains = ''${PRELUDE_PATH}/toolchains|" .buckconfig || true
              else
                awk -v repl="toolchains = ''${PRELUDE_PATH}/toolchains" '
                  BEGIN{printed=0}
                  {print}
                  /^\[repositories\]$/ {section=1; next}
                  section && /^(\[|$)/ {
                    if (!printed) {print repl"\n"; printed=1}
                    section=0
                  }
                  END{if (section && !printed) print repl}
                ' .buckconfig > .buckconfig.tmp && mv .buckconfig.tmp .buckconfig || true
              fi
              # Ensure fbsource mapping
              if grep -q "^fbsource\s*=\s*" .buckconfig; then
                "$SED" -i.bak -E "s|^fbsource\s*=.*$|fbsource = ''${PRELUDE_PATH}/third-party/fbsource_stub|" .buckconfig || true
              else
                awk -v repl="fbsource = ''${PRELUDE_PATH}/third-party/fbsource_stub" '
                  BEGIN{printed=0}
                  {print}
                  /^\[repositories\]$/ {section=1; next}
                  section && /^(\[|$)/ {
                    if (!printed) {print repl"\n"; printed=1}
                    section=0
                  }
                  END{if (section && !printed) print repl}
                ' .buckconfig > .buckconfig.tmp && mv .buckconfig.tmp .buckconfig || true
              fi
              # Ensure fbcode mapping
              if grep -q "^fbcode\s*=\s*" .buckconfig; then
                "$SED" -i.bak -E "s|^fbcode\s*=.*$|fbcode = ''${PRELUDE_PATH}/third-party/fbcode_stub|" .buckconfig || true
              else
                awk -v repl="fbcode = ''${PRELUDE_PATH}/third-party/fbcode_stub" '
                  BEGIN{printed=0}
                  {print}
                  /^\[repositories\]$/ {section=1; next}
                  section && /^(\[|$)/ {
                    if (!printed) {print repl"\n"; printed=1}
                    section=0
                  }
                  END{if (section && !printed) print repl}
                ' .buckconfig > .buckconfig.tmp && mv .buckconfig.tmp .buckconfig || true
              fi
              # Ensure root = . exists in [repositories]
              if ! grep -q "^root\s*=\s*\.\s*$" .buckconfig; then
                awk -v repl="root = ." '
                  BEGIN{printed=0}
                  {print}
                  /^\[repositories\]$/ {section=1; next}
                  section && /^(\[|$)/ {
                    if (!printed) {print repl"\n"; printed=1}
                    section=0
                  }
                  END{if (section && !printed) print repl}
                ' .buckconfig > .buckconfig.tmp && mv .buckconfig.tmp .buckconfig || true
              fi
              rm -f .buckconfig.bak
            fi

            # Ensure [cells] maps prelude
            if ! grep -q "^\[cells\]" .buckconfig 2>/dev/null; then
              printf "[cells]\nroot = .\nprelude = %s\ntoolchains = %s/toolchains\nfbsource = %s/third-party/fbsource_stub\nfbcode = %s/third-party/fbcode_stub\n\n" "$PRELUDE_PATH" "$PRELUDE_PATH" "$PRELUDE_PATH" "$PRELUDE_PATH" >> .buckconfig
            else
              if command -v gsed >/dev/null 2>&1; then SED=gsed; else SED=sed; fi
              if grep -q "^prelude\s*=\s*" .buckconfig; then
                "$SED" -i.bak -E "0,/^\[cells\]$/{0,/^prelude\s*=.*/s||prelude = ''${PRELUDE_PATH}|}" .buckconfig || true
              else
                awk -v repl="prelude = ''${PRELUDE_PATH}" '
                  BEGIN{printed=0}
                  {print}
                  /^\[cells\]$/ {section=1; next}
                  section && /^(\[|$)/ {
                    if (!printed) {print repl"\n"; printed=1}
                    section=0
                  }
                  END{if (section && !printed) print repl}
                ' .buckconfig > .buckconfig.tmp && mv .buckconfig.tmp .buckconfig || true
              fi
              # Ensure toolchains cell mapping
              if grep -q "^toolchains\s*=\s*" .buckconfig; then
                "$SED" -i.bak -E "0,/^\[cells\]$/{0,/^toolchains\s*=.*/s||toolchains = ''${PRELUDE_PATH}/toolchains|}" .buckconfig || true
              else
                awk -v repl="toolchains = ''${PRELUDE_PATH}/toolchains" '
                  BEGIN{printed=0}
                  {print}
                  /^\[cells\]$/ {section=1; next}
                  section && /^(\[|$)/ {
                    if (!printed) {print repl"\n"; printed=1}
                    section=0
                  }
                  END{if (section && !printed) print repl}
                ' .buckconfig > .buckconfig.tmp && mv .buckconfig.tmp .buckconfig || true
              fi
              # Ensure fbsource cell mapping
              if grep -q "^fbsource\s*=\s*" .buckconfig; then
                "$SED" -i.bak -E "0,/^\[cells\]$/{0,/^fbsource\s*=.*/s||fbsource = ''${PRELUDE_PATH}/third-party/fbsource_stub|}" .buckconfig || true
              else
                awk -v repl="fbsource = ''${PRELUDE_PATH}/third-party/fbsource_stub" '
                  BEGIN{printed=0}
                  {print}
                  /^\[cells\]$/ {section=1; next}
                  section && /^(\[|$)/ {
                    if (!printed) {print repl"\n"; printed=1}
                    section=0
                  }
                  END{if (section && !printed) print repl}
                ' .buckconfig > .buckconfig.tmp && mv .buckconfig.tmp .buckconfig || true
              fi
              # Ensure fbcode cell mapping
              if grep -q "^fbcode\s*=\s*" .buckconfig; then
                "$SED" -i.bak -E "0,/^\[cells\]$/{0,/^fbcode\s*=.*/s||fbcode = ''${PRELUDE_PATH}/third-party/fbcode_stub|}" .buckconfig || true
              else
                awk -v repl="fbcode = ''${PRELUDE_PATH}/third-party/fbcode_stub" '
                  BEGIN{printed=0}
                  {print}
                  /^\[cells\]$/ {section=1; next}
                  section && /^(\[|$)/ {
                    if (!printed) {print repl"\n"; printed=1}
                    section=0
                  }
                  END{if (section && !printed) print repl}
                ' .buckconfig > .buckconfig.tmp && mv .buckconfig.tmp .buckconfig || true
              fi
              # Ensure root = . exists within the [cells] section specifically
              awk '
                BEGIN { insec=0; have_root=0 }
                /^\[cells\]$/ { insec=1; print; next }
                insec && /^root\s*=\s*\.$/ { have_root=1 }
                { print }
                insec && /^\[/ { if (!have_root) print "root = ."; insec=0 }
                END { if (insec && !have_root) print "root = ." }
              ' .buckconfig > .buckconfig.tmp && mv .buckconfig.tmp .buckconfig || true
              rm -f .buckconfig.bak
            fi

            # Ensure [build] prelude refers to the prelude cell alias (not a path)
            if ! grep -q "^\[build\]" .buckconfig 2>/dev/null; then
              printf "[build]\nprelude = prelude\n\n" >> .buckconfig
            else
              if command -v gsed >/dev/null 2>&1; then SED=gsed; else SED=sed; fi
              if grep -q "^prelude\s*=\s*" .buckconfig; then
                "$SED" -i.bak -E "0,/^\[build\]$/{0,/^prelude\s*=.*/s||prelude = prelude|}" .buckconfig || true
              else
                awk -v repl="prelude = prelude" '
                  BEGIN{printed=0}
                  {print}
                  /^\[build\]$/ {section=1; next}
                  section && /^(\[|$)/ {
                    if (!printed) {print repl"\n"; printed=1}
                    section=0
                  }
                  END{if (section && !printed) print repl}
                ' .buckconfig > .buckconfig.tmp && mv .buckconfig.tmp .buckconfig || true
              fi
              rm -f .buckconfig.bak
            fi
            fi
          '';
          buildInputs = [
            pkgs.git pkgs.buck2 pkgs.go pkgs.pnpm pkgs.nodejs_22 zx-wrapper pkgs.jq pkgs.rsync pkgs.copier pkgs.yq
            pkgs.secretspec pkgs.jc pkgs.coreutils
          ] ++ (if pkgs.stdenv.isLinux then [ pkgs.fuse-overlayfs pkgs.xdg-utils ] else []);
        };
      }
    );

    packages = forAllSystems ({ zx-wrapper, pkgs, pnpm-store, node-modules, buck2Input, system, ... }: {
      # Expose only a prelude package derived from the upstream buck2 input
      buck2-prelude = pkgs.stdenvNoCC.mkDerivation {
        pname = "buck2-prelude";
        version = (pkgs.buck2.version or "unstable");
        src = buck2Input;
        dontUnpack = true;
        installPhase = ''
          runHook preInstall
          mkdir -p "$out"
          cp -r "$src/prelude" "$out/prelude"
          runHook postInstall
        '';
      };
      zx-wrapper = zx-wrapper;
      pnpm-store = pnpm-store;
      node-modules = node-modules;
      default = node-modules;
      graph-generator = (
        let wr = builtins.getEnv "WORKSPACE_ROOT"; in
        pkgs.callPackage ./tools/nix/graph-generator.nix {
          inherit pkgs;
          src = if (wr != "") then builtins.toPath wr else ./.;
        }
      ).all;
    });

    checks = forAllSystems ({ node-modules, ... }: {
      default = node-modules;
    });
  };
}
