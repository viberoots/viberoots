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
  wasm ? {},
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
'' else if builtins.elem kind [ "wasm" "wasm_browser" "wasm_component" ] then ''
  runHook preInstall
  install -Dm644 "${targetDir}/${lib.replaceStrings ["-"] ["_"] crate}.wasm" "$out/lib/${crate}.wasm"
  runHook postInstall
'' else if builtins.elem kind [ "wasm_static" "wasi_static" ] then ''
  runHook preInstall
  candidate="${targetDir}/lib${lib.replaceStrings ["-"] ["_"] crate}.a"
  test -f "$candidate" || { echo "rust WASM staticlib ${crate}: expected $candidate" >&2; exit 2; }
  normalized="$TMPDIR/lib${publicCrate}.a"
  members="$TMPDIR/viberoots-rust-wasm-members"
  mkdir -p "$members"
  ${pkgs.python3}/bin/python - "$candidate" "$members" <<'PY'
  import pathlib, sys
  source, destination = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
  data = source.read_bytes()
  if not data.startswith(b"!<arch>\n"):
      raise SystemExit("Rust WASM static archive has an unsupported container")
  def trim_bsd_padding(payload):
      cursor = 8
      while cursor < len(payload):
          if all(byte == 10 for byte in payload[cursor:]):
              return payload[:cursor]
          cursor += 1
          size = 0
          shift = 0
          while cursor < len(payload):
              byte = payload[cursor]
              cursor += 1
              size |= (byte & 127) << shift
              if byte & 128 == 0:
                  break
              shift += 7
          else:
              raise SystemExit("Rust WASM static archive contains a truncated section size")
          cursor += size
          if cursor > len(payload):
              raise SystemExit("Rust WASM static archive contains a truncated object member")
      return payload
  offset = 8
  index = 0
  while offset < len(data):
      header = data[offset:offset + 60]
      if len(header) != 60 or header[58:60] != b"`\n":
          raise SystemExit("Rust WASM static archive has a malformed member header")
      size = int(header[48:58].decode().strip())
      name = header[:16].decode(errors="replace").strip()
      payload = data[offset + 60:offset + 60 + size]
      if name.startswith("#1/"):
          name_size = int(name[3:])
          name = payload[:name_size].rstrip(b"\0").decode(errors="replace")
          payload = payload[name_size:]
      if name.rstrip("/") not in {"", "__.SYMDEF", "__.SYMDEF SORTED"} and payload.startswith(b"\0asm"):
          (destination / f"{index:06d}.o").write_bytes(trim_bsd_padding(payload))
          index += 1
      offset += 60 + size + (size % 2)
  if index == 0:
      raise SystemExit("Rust WASM static archive contains no WebAssembly object members")
  PY
  ${pkgs.llvmPackages.llvm}/bin/llvm-ar --format=gnu rcsD "$normalized" "$members"/*.o
  install -Dm644 "$normalized" "$out/lib/lib${publicCrate}.a"
  install -Dm644 ${wasm.header} "$out/include/$(basename ${wasm.header})"
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
  ${lib.optionalString (crateType == "cdylib") ''
    install -Dm755 "$candidate" "$out/lib/lib${publicCrate}${dynamicExtension}"
    ${lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''
      ${pkgs.darwin.cctools}/bin/install_name_tool \
        -id "$out/lib/lib${publicCrate}${dynamicExtension}" \
        "$out/lib/lib${publicCrate}${dynamicExtension}"
      ${pkgs.darwin.cctools}/bin/install_name_tool \
        -id "$out/lib/lib${publicCrate}.cdylib" \
        "$out/lib/lib${publicCrate}.cdylib"
    ''}
  ''}
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
