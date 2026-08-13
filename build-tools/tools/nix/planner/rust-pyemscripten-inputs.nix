{ lib, P, ctx, nodeFor, normalizeList, sanitizeNativeLinkName, LC, byName }:
name:
let
  clean = P.cleanLabel;
  node = nodeFor name;
  labelsOf = dep: P.labelsOf (nodeFor dep);
  hasLabel = dep: label: builtins.elem label (labelsOf dep);
  linkDeps = normalizeList "link_deps" (ctx.get node "link_deps");
  headerDeps = normalizeList "header_deps" (ctx.get node "header_deps");
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
  validateLink = dep:
    if hasLabel dep "lang:cpp" && hasLabel dep "kind:wasm" && hasLabel dep "wasm:static"
    then if hasLabel dep "wasm:wasi" then builtins.throw
      "Rust Pyodide extension ${name} cannot link WASI static producer ${dep}"
    else dep
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
