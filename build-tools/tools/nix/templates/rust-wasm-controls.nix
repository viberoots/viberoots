{ pkgs, lib, Tools, kind, wasm }:
let
  wasmTools = "${Tools.wasmTools}/bin/wasm-tools";
  wasmOpt = "${Tools.wasmOpt}/bin/wasm-opt";
  wasmMetadce = "${Tools.wasmOpt}/bin/wasm-metadce";
  optimizeFlag =
    if wasm.optimize == "speed" then "-O2"
    else if wasm.optimize == "size" then "-Oz"
    else "";
  requestedCases = lib.concatMapStringsSep "\n" (name:
    "      ${lib.escapeShellArg name}) keep=1 ;;"
  ) wasm.exported;
  reservedCases =
    if kind == "wasm_browser" then
      "      memory|__wbindgen_*) keep=1 ;;"
    else if wasm.abi == "wasi" then
      "      memory|_start|_initialize|cabi_realloc) keep=1 ;;"
    else "";
  classify = ''
    keep=0
    case "$export_name" in
${requestedCases}
${reservedCases}
    esac
  '';
in rec {
  optimize = path: lib.optionalString (optimizeFlag != "") ''
    ${wasmOpt} ${optimizeFlag} ${lib.optionalString wasm.debug "-g"} \
      "${path}" -o "${path}.optimized"
    mv "${path}.optimized" "${path}"
  '';
  strip = path: lib.optionalString (!wasm.debug) ''
    ${wasmTools} strip "${path}" -o "${path}.stripped"
    mv "${path}.stripped" "${path}"
  '';
  enforceExports = path: lib.optionalString (wasm.exported != []) ''
    wat="$TMPDIR/viberoots-rust-wasm.$$.wat"
    graph="$TMPDIR/viberoots-rust-wasm.$$.graph.json"
    ${wasmTools} print "${path}" > "$wat"
    ${lib.concatMapStringsSep "\n" (name: ''
      grep -F ${lib.escapeShellArg "(export \"${name}\""} "$wat" >/dev/null || {
        echo "Rust WASM export allowlist entry is absent: ${name}" >&2
        exit 2
      }
    '') wasm.exported}
    printf '[' > "$graph"
    separator=
    while IFS= read -r export_name; do
${classify}
      if [ "$keep" -eq 1 ]; then
        printf '%s{"name":"%s","export":"%s","root":true}' \
          "$separator" "$export_name" "$export_name" >> "$graph"
        separator=,
      fi
    done < <(sed -n 's/.*(export "\([^"]*\)".*/\1/p' "$wat")
    printf ']\n' >> "$graph"
    ${wasmMetadce} --all-features "${path}" --graph-file "$graph" -o "${path}.allowlisted"
    mv "${path}.allowlisted" "${path}"
    ${wasmTools} print "${path}" > "$wat"
    while IFS= read -r export_name; do
${classify}
      if [ "$keep" -ne 1 ]; then
        echo "Rust WASM export escaped allowlist: $export_name" >&2
        exit 2
      fi
    done < <(sed -n 's/.*(export "\([^"]*\)".*/\1/p' "$wat")
  '';
  enforceWitExports = path: emittedComponent: lib.optionalString (wasm.exported != []) ''
    actual="$TMPDIR/viberoots-rust-component-exports.$$"
    wit_json="$actual.json"
    ${wasmTools} component wit --json "${path}" > "$wit_json"
    ${pkgs.jq}/bin/jq -r \
      --arg world ${lib.escapeShellArg wasm.world} \
      --argjson emitted ${if emittedComponent then "true" else "false"} '
      . as $resolve
      | [.worlds[] | select(.name == $world)] as $selected
      | if ($selected | length) == 1 then $selected[0]
        elif $emitted and (.worlds | length) == 1 and .worlds[0].name == "root"
          then .worlds[0]
        else error("selected WIT world is absent or ambiguous: " + $world)
        end
      | [
          .exports
          | to_entries[]
          | if .value.function then .value.function.name
            elif .value.interface then
              .value.interface.id as $id
              | $resolve.interfaces[$id].functions
              | keys[]
            else empty
            end
        ]
      | sort
      | group_by(.) as $groups
      | if any($groups[]; length != 1)
        then error("selected WIT world has ambiguous duplicate exported function names")
        else $groups[][0]
        end
    ' "$wit_json" > "$actual.unsorted"
    LC_ALL=C sort -u "$actual.unsorted" > "$actual"
    printf '%s\n' ${lib.concatMapStringsSep " " lib.escapeShellArg wasm.exported} \
      | LC_ALL=C sort -u > "$actual.expected"
    if ! cmp -s "$actual.expected" "$actual"; then
      echo "Rust WASM component exports do not exactly match exported_functions for world ${wasm.world}" >&2
      diff -u "$actual.expected" "$actual" >&2 || true
      exit 2
    fi
  '';
  processCore = path: ''
    ${optimize path}
    ${strip path}
    ${enforceExports path}
  '';
  processComponentCore = path: ''
    ${optimize path}
    ${strip path}
  '';
  processBrowser = path: ''
    ${enforceExports path}
    ${lib.optionalString (optimizeFlag != "" || wasm.sourceMap) ''
      ${wasmOpt} ${optimizeFlag} ${lib.optionalString wasm.debug "-g"} \
        ${lib.optionalString wasm.sourceMap
          "--output-source-map \"${path}.map\" --output-source-map-url \"${builtins.baseNameOf path}.map\""} \
        "${path}" -o "${path}.optimized"
      mv "${path}.optimized" "${path}"
    ''}
    ${strip path}
  '';
}
