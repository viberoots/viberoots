{ pkgs, lib, kind, nodeApiVersion, targetDir, crate, dynamicExtension }:
let
  version = builtins.toString nodeApiVersion;
  requiredSymbol = {
    "8" = "napi_type_tag_object";
    "9" = "node_api_symbol_for";
    "10" = "node_api_create_buffer_from_arraybuffer";
  }.${version} or "";
  version10Symbols = [
    "node_api_create_external_string_latin1"
    "node_api_create_external_string_utf16"
    "node_api_create_property_key_latin1"
    "node_api_create_property_key_utf8"
    "node_api_create_property_key_utf16"
    "node_api_create_buffer_from_arraybuffer"
  ];
  higherSymbols =
    if nodeApiVersion == 8 then [
      "node_api_symbol_for"
      "node_api_create_syntax_error"
      "node_api_throw_syntax_error"
      "node_api_get_module_file_name"
    ] ++ version10Symbols
    else if nodeApiVersion == 9 then version10Symbols
    else [];
  getterLinkArgs =
    if pkgs.stdenv.hostPlatform.isDarwin then
      "-C link-arg=-Wl,-u,_node_api_module_get_api_version_v1 -C link-arg=-Wl,-exported_symbol,_node_api_module_get_api_version_v1"
    else
      "-C link-arg=-Wl,--undefined=node_api_module_get_api_version_v1 -C link-arg=-Wl,--export-dynamic-symbol=node_api_module_get_api_version_v1";
in {
  bindgenArgs =
    if kind == "addon" then "-DNAPI_VERSION=${version} -I${pkgs.nodejs_22}/include/node"
    else "";
  includePaths = lib.optionals (kind == "addon") [ "${pkgs.nodejs_22}/include/node" ];
  preBuild = lib.optionalString (kind == "addon") ''
    selected_napi="$(${pkgs.nodejs_22}/bin/node -p 'process.versions.napi || ""')"
    if [ -z "$selected_napi" ] || [ "$selected_napi" -lt ${version} ]; then
      echo "Rust Node-API addon requires N-API ${version}, selected Node provides ''${selected_napi:-none}" >&2
      exit 2
    fi
    cat > "$TMPDIR/viberoots-node-api-version.c" <<'VIBEROOTS_NODE_API_VERSION'
    #include <stdint.h>
    __attribute__((weak, visibility("default"), used))
    int32_t node_api_module_get_api_version_v1(void) { return NAPI_VERSION; }
    VIBEROOTS_NODE_API_VERSION
    ${pkgs.llvmPackages.clang}/bin/clang -DNAPI_VERSION=${version} \
      -c "$TMPDIR/viberoots-node-api-version.c" -o "$TMPDIR/viberoots-node-api-version.o"
    export RUSTFLAGS="$RUSTFLAGS -C link-arg=$TMPDIR/viberoots-node-api-version.o ${getterLinkArgs}"
  '';
  postBuild = lib.optionalString (kind == "addon") ''
    addon_candidate="${targetDir}/lib${lib.replaceStrings [ "-" ] [ "_" ] crate}${dynamicExtension}"
    if [ ! -f "$addon_candidate" ]; then
      echo "Rust Node-API addon ABI audit: expected $addon_candidate" >&2
      exit 2
    fi
    ${pkgs.llvmPackages.llvm}/bin/llvm-nm --undefined-only "$addon_candidate" \
      > .viberoots-node-api-symbols
    grep -Eq '[_]?${requiredSymbol}$' .viberoots-node-api-symbols || {
      echo "Rust Node-API addon declares version ${version} but does not use its required version-specific API ${requiredSymbol}" >&2
      exit 2
    }
    ${lib.concatMapStringsSep "\n" (symbol: ''
      if grep -Eq '[_]?${symbol}$' .viberoots-node-api-symbols; then
        echo "Rust Node-API addon declares version ${version} but uses higher-version API ${symbol}" >&2
        exit 2
      fi
    '') higherSymbols}
    ${pkgs.llvmPackages.llvm}/bin/llvm-nm --defined-only "$addon_candidate" \
      > .viberoots-node-api-exports
    grep -Eq '[_]?node_api_module_get_api_version_v1$' .viberoots-node-api-exports || {
      echo "Rust Node-API addon must export node_api_module_get_api_version_v1 so Node can enforce the declared ABI version" >&2
      exit 2
    }
    cat > "$TMPDIR/viberoots-node-api-probe.c" <<'VIBEROOTS_NODE_API_PROBE'
    #include <dlfcn.h>
    #include <stdint.h>
    #include <stdio.h>
    #include <stdlib.h>
    int main(int argc, char **argv) {
      void *handle = dlopen(argv[1], RTLD_LAZY | RTLD_LOCAL);
      if (handle == NULL) { fprintf(stderr, "Node-API probe dlopen failed: %s\n", dlerror()); return 2; }
      int32_t (*getter)(void) = (int32_t (*)(void))dlsym(handle, "node_api_module_get_api_version_v1");
      if (getter == NULL) { fprintf(stderr, "Node-API probe getter is missing\n"); return 2; }
      int32_t actual = getter();
      int32_t expected = (int32_t)strtol(argv[2], NULL, 10);
      if (actual != expected) {
        fprintf(stderr, "Rust Node-API addon declares Node-API %d but binary getter returned %d\n", expected, actual);
        return 2;
      }
      return 0;
    }
    VIBEROOTS_NODE_API_PROBE
    ${pkgs.llvmPackages.clang}/bin/clang "$TMPDIR/viberoots-node-api-probe.c" \
      ${lib.optionalString (!pkgs.stdenv.hostPlatform.isDarwin) "-ldl"} -o "$TMPDIR/viberoots-node-api-probe"
    "$TMPDIR/viberoots-node-api-probe" "$addon_candidate" ${version}
  '';
}
