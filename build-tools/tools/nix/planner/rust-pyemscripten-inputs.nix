{ lib, P, ctx, nodeFor, normalizeList, sanitizeNativeLinkName, LC, byName }:
name:
let
  clean = P.cleanLabel;
  node = nodeFor name;
  labelsOf = dep: P.labelsOf (nodeFor dep);
  hasLabel = dep: label: builtins.elem label (labelsOf dep);
  value = dep: field: default:
    let raw = ctx.get (nodeFor dep) field;
    in if raw == null then default else raw;
  linkDeps = normalizeList "link_deps" (ctx.get node "link_deps");
  headerDeps = normalizeList "header_deps" (ctx.get node "header_deps");
  consumerProfile = ctx.get node "nixpkgs_profile";
  consumerPins = ctx.get node "nixpkg_pins";
  closureRaw = ctx.get node "link_closure";
  closure = if closureRaw == null then "direct" else closureRaw;
  overridesRaw = ctx.get node "link_closure_overrides";
  overrides = if overridesRaw == null then {} else
    builtins.listToAttrs (map (key: { name = clean key; value = overridesRaw.${key}; })
      (builtins.attrNames overridesRaw));
  missingOverrides = builtins.filter (key: !(builtins.elem key linkDeps)) (builtins.attrNames overrides);
  _overrides = if missingOverrides == [] then true else builtins.throw
    "Rust Pyodide link_closure_overrides contains keys not present in link_deps: ${builtins.toString missingOverrides}";
  linkDepsOf = dep: normalizeList "link_deps for ${dep}" (ctx.get (nodeFor dep) "link_deps");
  resolved = LC.resolveLinkClosure {
    inherit byName overrides;
    roots = linkDeps;
    defaultClosure = closure;
    linkDepsOf = linkDepsOf;
  };
  validateLinkContract = dep:
    let
      producer = {
        abi = value dep "wasm_abi" "";
        target = value dep "wasm_target" "";
        libc = value dep "wasm_libc" "";
        exceptionPolicy = value dep "wasm_exception_policy" "";
        allocator = value dep "wasm_allocator" "";
        runtime = value dep "wasm_runtime" "";
        profile = value dep "nixpkgs_profile" "default";
        pins = value dep "nixpkg_pins" {};
      };
      expectedPins = if consumerPins == null then {} else consumerPins;
      expectedProfile = if consumerProfile == null || consumerProfile == "" then "default" else consumerProfile;
    in
      if producer.abi != "bare" then builtins.throw
        "Rust Pyodide extension ${name} link_dep ${dep} has incompatible wasm_abi ${producer.abi}; expected bare"
      else if producer.target != "wasm32-unknown-unknown" then builtins.throw
        "Rust Pyodide extension ${name} link_dep ${dep} has incompatible wasm_target ${producer.target}; expected wasm32-unknown-unknown"
      else if producer.libc != "none" then builtins.throw
        "Rust Pyodide extension ${name} link_dep ${dep} has incompatible wasm_libc ${producer.libc}; expected none"
      else if producer.exceptionPolicy != "trap" then builtins.throw
        "Rust Pyodide extension ${name} link_dep ${dep} has incompatible wasm_exception_policy ${producer.exceptionPolicy}; expected trap"
      else if producer.allocator != "none" then builtins.throw
        "Rust Pyodide extension ${name} link_dep ${dep} has incompatible wasm_allocator ${producer.allocator}; expected none"
      else if producer.runtime != "link-only" then builtins.throw
        "Rust Pyodide extension ${name} link_dep ${dep} has incompatible wasm_runtime ${producer.runtime}; expected link-only"
      else if producer.profile != expectedProfile then builtins.throw
        "Rust Pyodide extension ${name} link_dep ${dep} has incompatible nixpkgs_profile ${producer.profile}; expected ${expectedProfile}"
      else if builtins.toJSON producer.pins != builtins.toJSON expectedPins then builtins.throw
        "Rust Pyodide extension ${name} link_dep ${dep} has incompatible nixpkg_pins authority"
      else dep;
  validateLink = dep:
    if hasLabel dep "lang:cpp" && hasLabel dep "kind:wasm" && hasLabel dep "wasm:static"
    then if hasLabel dep "wasm:wasi" then builtins.throw
      "Rust Pyodide extension ${name} cannot link WASI static producer ${dep}"
    else validateLinkContract dep
    else builtins.throw
      "Rust Pyodide extension ${name} link_dep ${dep} is unsupported; expected labels lang:cpp, kind:wasm, wasm:static";
  validateHeader = dep:
    if hasLabel dep "lang:cpp" && hasLabel dep "kind:headers" then dep
    else builtins.throw
      "Rust Pyodide extension ${name} header_dep ${dep} is unsupported; expected labels lang:cpp, kind:headers";
  validatedLinks = map validateLink resolved;
  validatedHeaders = map validateHeader headerDeps;
  packages = map ctx.dependencyArtifactOf validatedLinks;
  headerPackages = map ctx.dependencyArtifactOf validatedHeaders;
in assert _overrides; {
  libraries = packages;
  headers = headerPackages;
  linkNames = map sanitizeNativeLinkName validatedLinks;
  nativeLinks = map (dep: { name = sanitizeNativeLinkName dep; kind = "static"; }) validatedLinks;
  wasmStaticLibs = packages;
  wasmStaticArchives = map (dep:
    "${ctx.dependencyArtifactOf dep}/lib/lib${sanitizeNativeLinkName dep}.a"
  ) validatedLinks;
}
