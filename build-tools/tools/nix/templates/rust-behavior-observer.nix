{
  pkgs,
  lib,
  rustToolchain,
  kind,
  crate,
  crateType,
  publicCrate,
  targetName,
  module ? "",
  tauri ? {},
}:
let
  symbol = "viberoots_observed_behavior";
  nativeProbe = ''
    cat > "$TMPDIR/viberoots-behavior.rs" <<'RS'
    unsafe extern "C" {
        fn ${symbol}() -> i32;
    }
    fn main() {
        println!("{}", unsafe { ${symbol}() });
    }
    RS
  '';
  observeRlib = nativeProbe + ''
    ${rustToolchain}/bin/rustc \
      "$TMPDIR/viberoots-behavior.rs" \
      -C "link-arg=$out/lib/lib${publicCrate}.rlib" \
      -o "$TMPDIR/viberoots-behavior"
    "$TMPDIR/viberoots-behavior"
  '';
  observeStatic = ''
    cat > "$TMPDIR/viberoots-behavior.c" <<'C'
    #include <stdio.h>
    extern int ${symbol}(void);
    int main(void) {
      printf("%d\n", ${symbol}());
      return 0;
    }
    C
    ${pkgs.stdenv.cc}/bin/cc "$TMPDIR/viberoots-behavior.c" \
      "$out/lib/lib${publicCrate}.a" \
      ${lib.optionalString pkgs.stdenv.hostPlatform.isLinux "-ldl -lpthread -lm"} \
      -o "$TMPDIR/viberoots-behavior"
    "$TMPDIR/viberoots-behavior"
  '';
  observeDynamic = ''
    cat > "$TMPDIR/viberoots-behavior.c" <<'C'
    #include <stdio.h>
    extern int ${symbol}(void);
    int main(void) {
      printf("%d\n", ${symbol}());
      return 0;
    }
    C
    ${pkgs.stdenv.cc}/bin/cc "$TMPDIR/viberoots-behavior.c" \
      -L"$out/lib" -l${publicCrate} -o "$TMPDIR/viberoots-behavior"
    ${lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''LD_LIBRARY_PATH="$out/lib"''} \
      ${lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''DYLD_LIBRARY_PATH="$out/lib"''} \
      "$TMPDIR/viberoots-behavior"
  '';
  observePythonExtension = ''
    extension="$(find "$out/site" -type f \( -name '*.so' -o -name '*.dylib' \) -print -quit)"
    test -n "$extension"
    PYTHONPATH="$out/site" ${pkgs.python3}/bin/python - "$extension" ${lib.escapeShellArg module} <<'PY'
    import ctypes
    import importlib
    import sys
    importlib.import_module(sys.argv[2])
    library = ctypes.CDLL(sys.argv[1])
    library.${symbol}.restype = ctypes.c_int
    print(library.${symbol}())
    PY
  '';
  observeNodeAddon = ''
    extension="$(find "$out/lib" -maxdepth 1 -type f -name '*.node' -print -quit)"
    test -n "$extension"
    ${pkgs.nodejs_22}/bin/node -e 'require(process.argv[1])' "$extension"
    cat > "$TMPDIR/viberoots-behavior.c" <<'C'
    #include <stdio.h>
    extern int ${symbol}(void);
    int main(void) {
      printf("%d\n", ${symbol}());
      return 0;
    }
    C
    ${pkgs.stdenv.cc}/bin/cc "$TMPDIR/viberoots-behavior.c" "$extension" \
      -o "$TMPDIR/viberoots-behavior"
    "$TMPDIR/viberoots-behavior"
  '';
  observeProcMacro = ''
    proc_macro="$TMPDIR/lib${publicCrate}${pkgs.stdenv.hostPlatform.extensions.sharedLibrary}"
    cp "$out/lib/lib${publicCrate}.proc-macro" "$proc_macro"
    cat > "$TMPDIR/viberoots-behavior.rs" <<'RS'
    extern crate ${lib.replaceStrings [ "-" ] [ "_" ] publicCrate};
    fn main() {
      println!("{}", ${lib.replaceStrings [ "-" ] [ "_" ] publicCrate}::viberoots_observed_behavior!());
    }
    RS
    ${rustToolchain}/bin/rustc \
      "$TMPDIR/viberoots-behavior.rs" \
      --extern ${lib.replaceStrings [ "-" ] [ "_" ] publicCrate}="$proc_macro" \
      -o "$TMPDIR/viberoots-behavior"
    "$TMPDIR/viberoots-behavior"
  '';
  observeWasm = module: ''
    mkdir -p "$TMPDIR/viberoots-home/cache"
    HOME="$TMPDIR/viberoots-home" XDG_CACHE_HOME="$TMPDIR/viberoots-home/cache" \
      ${pkgs.wasmtime}/bin/wasmtime run --invoke ${symbol} "${module}"
  '';
  observeBrowser = ''
    package="$out/pkg/package.json"
    test -f "$package"
    ${pkgs.nodejs_22}/bin/node --input-type=module - "$package" ${lib.escapeShellArg symbol} <<'JS'
    import fs from "node:fs/promises";
    import path from "node:path";
    import { pathToFileURL } from "node:url";

    const packagePath = process.argv[2];
    const symbol = process.argv[3];
    const root = path.dirname(packagePath);
    const manifest = JSON.parse(await fs.readFile(packagePath, "utf8"));
    if (manifest.type !== "module" || manifest.module !== `./${crate}.js`) {
      throw new Error("Rust browser behavior observer requires the final ESM package contract");
    }
    const wasmName = `${crate}_bg.wasm`;
    if (!Array.isArray(manifest.files) || !manifest.files.includes(`${crate}.js`) ||
        !manifest.files.includes(wasmName)) {
      throw new Error("Rust browser behavior observer requires declared JS and WASM package files");
    }
    const bindings = await import(pathToFileURL(path.join(root, `${crate}.js`)).href);
    if (typeof bindings.default !== "function") {
      throw new Error("Rust browser behavior observer requires the wasm-bindgen initializer");
    }
    const instance = await bindings.default(await fs.readFile(path.join(root, wasmName)));
    const callable = bindings[symbol] ?? instance?.[symbol];
    if (typeof callable !== "function") {
      throw new Error(`Rust browser behavior observer could not resolve ${symbol}`);
    }
    console.log(callable());
    JS
  '';
  observeComponent = ''
    mkdir -p "$TMPDIR/viberoots-home/cache"
    HOME="$TMPDIR/viberoots-home" XDG_CACHE_HOME="$TMPDIR/viberoots-home/cache" \
      ${pkgs.wasmtime}/bin/wasmtime run \
      --invoke 'viberoots-observed-behavior()' \
      "$out/lib/${crate}.component.wasm"
  '';
  observe =
    if kind == "bin" || kind == "wasi" then ''
      "$out/bin/${targetName}"
    '' else if kind == "test" then ''
      "$out/bin/${targetName}" --nocapture
    '' else if kind == "tauri" then ''
      manifest="$out/share/viberoots-tauri/artifact-manifest.json"
      packaged_wasm="$(${pkgs.jq}/bin/jq -er '.frontendWasm.path' "$manifest")"
      case "$packaged_wasm" in "$out"/app/*.app/Contents/Resources/viberoots-frontend/frontend.wasm) ;;
        *) echo "Tauri behavior observer rejected unpackaged frontend WASM: $packaged_wasm" >&2; exit 2 ;;
      esac
      test -f "$packaged_wasm"
      expected_digest="$(${pkgs.jq}/bin/jq -er '.frontendWasm.digest' "$manifest")"
      observed_digest="sha256:$(${pkgs.coreutils}/bin/sha256sum "$packaged_wasm" | cut -d' ' -f1)"
      test "$observed_digest" = "$expected_digest" ||
        { echo "Tauri packaged frontend WASM digest mismatch" >&2; exit 2; }
      ${observeWasm "$packaged_wasm"}
    ''
    else if kind == "wasm_browser" then observeBrowser
    else if kind == "wasm_component" then observeComponent
    else if kind == "wasm" then
      observeWasm "$out/lib/${crate}.wasm"
    else if builtins.elem kind [ "wasm_static" "wasi_static" ] then ''
      ${pkgs.llvmPackages.lld}/bin/wasm-ld --no-entry \
        --export=${symbol} --whole-archive "$out/lib/lib${publicCrate}.a" \
        --no-whole-archive -o "$TMPDIR/viberoots-behavior.wasm"
      ${observeWasm "$TMPDIR/viberoots-behavior.wasm"}
    '' else if crateType == "proc-macro" then observeProcMacro
    else if crateType == "staticlib" then observeStatic
    else if kind == "pyext" then observePythonExtension
    else if kind == "addon" then observeNodeAddon
    else if crateType == "cdylib" then observeDynamic
    else observeRlib;
in ''
  mkdir -p "$out/share/viberoots-rust"
  observed="$(${observe})"
  behavior="$(printf '%s\n' "$observed" |
    ${pkgs.gnugrep}/bin/grep -Eo 'VIBEROOTS_OBSERVED_BEHAVIOR=[0-9]+' |
    tail -1 | ${pkgs.gnugrep}/bin/grep -Eo '[0-9]+' || true)"
  if test -z "$behavior"; then
    behavior="$(printf '%s\n' "$observed" | ${pkgs.gnugrep}/bin/grep -Eo '[0-9]+' | tail -1)"
  fi
  case "$behavior" in 42|43) ;; *)
    echo "Rust behavior observer did not produce a protected value: $observed" >&2
    exit 2
  esac
  printf '%s' "$behavior" > "$out/share/viberoots-rust/observed-behavior"
''
