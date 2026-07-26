{
  pkgs,
  lib,
  kind,
  crateType,
  crate,
  publicCrate,
  targetDir,
  targetName,
  artifactDir,
  dynamicExtension,
}:
if kind == "bin" then ''
  runHook preInstall
  install -Dm755 "${targetDir}/${targetName}" "$out/bin/${targetName}"
  runHook postInstall
'' else if kind == "wasi" then ''
  runHook preInstall
  install -Dm644 "${targetDir}/${targetName}.wasm" "$out/lib/${crate}.wasm"
  install -Dm644 ${../../wasm/wasi-runner.mjs} "$out/libexec/viberoots/wasi-runner.mjs"
  mkdir -p "$out/bin"
  cat > "$out/bin/${targetName}" <<EOF
  #!${pkgs.runtimeShell}
  exec ${pkgs.nodejs}/bin/node "$out/libexec/viberoots/wasi-runner.mjs" "$out/lib/${crate}.wasm" "\$@"
  EOF
  chmod +x "$out/bin/${targetName}"
  runHook postInstall
'' else if kind == "wasm" then ''
  runHook preInstall
  install -Dm644 "${targetDir}/${lib.replaceStrings ["-"] ["_"] crate}.wasm" "$out/lib/${crate}.wasm"
  runHook postInstall
'' else if kind == "test" then ''
  runHook preInstall
  mkdir -p "$out/bin" "$out/libexec/rust-tests"
  package_id="$(${pkgs.jq}/bin/jq -er --arg crate ${lib.escapeShellArg crate} '
    [.packages[] | select(.name == $crate) | .id]
    | if length == 1 then .[0] else error("expected exactly one requested Cargo package") end
  ' .viberoots-cargo-metadata.json)"
  ${pkgs.jq}/bin/jq -r --arg package_id "$package_id" '
    select(
      .reason == "compiler-artifact"
      and .package_id == $package_id
      and .profile.test == true
      and .executable != null
    )
    | .executable
  ' .viberoots-cargo-artifacts.jsonl > .viberoots-test-harnesses
  if [ ! -s .viberoots-test-harnesses ]; then
    echo "rust test ${crate}: Cargo produced no executable test harness" >&2
    exit 2
  fi
  while IFS= read -r candidate; do
    if [ ! -f "$candidate" ] || [ ! -x "$candidate" ]; then
      echo "rust test ${crate}: Cargo reported an unavailable test harness: $candidate" >&2
      exit 2
    fi
    destination="$out/libexec/rust-tests/$(basename "$candidate")"
    if [ -e "$destination" ]; then
      echo "rust test ${crate}: Cargo reported colliding test harness names: $(basename "$candidate")" >&2
      exit 2
    fi
    install -Dm755 "$candidate" "$destination"
  done < .viberoots-test-harnesses
  cat > "$out/bin/${targetName}" <<'EOF'
  #!${pkgs.runtimeShell}
  set -eu
  for test_binary in "$(dirname "$0")/../libexec/rust-tests/"*; do
    "$test_binary" "$@"
  done
  EOF
  chmod +x "$out/bin/${targetName}"
  runHook postInstall
'' else if crateType == "staticlib" then ''
  runHook preInstall
  candidate="${targetDir}/lib${lib.replaceStrings ["-"] ["_"] crate}.a"
  test -f "$candidate" || { echo "rust staticlib ${crate}: expected $candidate" >&2; exit 2; }
  install -Dm644 "$candidate" "$out/lib/lib${publicCrate}.a"
  runHook postInstall
'' else if crateType == "cdylib" || crateType == "proc-macro" then ''
  runHook preInstall
  shopt -s nullglob
  primary="${artifactDir}/lib${lib.replaceStrings ["-"] ["_"] crate}${dynamicExtension}"
  if [ -f "$primary" ]; then
    candidate="$primary"
  else
    hashed=("${artifactDir}/deps/lib${lib.replaceStrings ["-"] ["_"] crate}-"*${dynamicExtension})
    if [ "''${#hashed[@]}" -ne 1 ]; then
      echo "rust ${crateType} ${crate}: expected one primary or hashed ${dynamicExtension} library, found hashed=''${#hashed[@]}" >&2
      exit 2
    fi
    candidate="''${hashed[0]}"
  fi
  extension=${if crateType == "proc-macro" then "proc-macro" else "cdylib"}
  install -Dm755 "$candidate" "$out/lib/lib${publicCrate}.$extension"
  runHook postInstall
'' else ''
  runHook preInstall
  shopt -s nullglob
  primary="${targetDir}/lib${lib.replaceStrings ["-"] ["_"] crate}.rlib"
  if [ -f "$primary" ]; then
    candidate="$primary"
  else
    candidates=("${targetDir}/deps/lib${lib.replaceStrings ["-"] ["_"] crate}-"*.rlib)
    if [ "''${#candidates[@]}" -ne 1 ]; then
      echo "rust library ${crate}: expected one primary or hashed rlib, found hashed=''${#candidates[@]}" >&2
      exit 2
    fi
    candidate="''${candidates[0]}"
  fi
  install -Dm644 "$candidate" "$out/lib/lib${publicCrate}.rlib"
  runHook postInstall
''
