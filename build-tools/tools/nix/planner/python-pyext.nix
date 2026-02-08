{ lib, ctx, core, cpp }:
let
  T = ctx.T;
  get = ctx.get;
  repoRoot = ctx.repoRoot;
  pkgPathOf = ctx.pkgPathOf;
  LC = import ./link-closure.nix { inherit lib; };

  cleanLabel = core.cleanLabel;
  normalizeLabelList = core.normalizeLabelList;
  normalizeOverrides = core.normalizeOverrides;
  ensureString = core.ensureString;
  ensureStringList = core.ensureStringList;
  nodeOfName = core.nodeOfName;
  labelsOfName = core.labelsOfName;
  depsOfName = core.depsOfName;
  labelsOf = core.labelsOf;
  lockRelFor = core.lockRelFor;

  mkCppLib = cpp.mkCppLib;
  mkCppHeaders = cpp.mkCppHeaders;
  ensureRepoCppLibDep = cpp.ensureRepoCppLibDep;
  ensureRepoCppHeadersDep = cpp.ensureRepoCppHeadersDep;
  patchInputsFor = cpp.patchInputsFor;
  collectNixAttrsFor = cpp.collectNixAttrsFor;

  collectPyExtDepsTransitive = name:
    let
      startDeps = depsOfName name;
      go = st: q:
        if q == [] then st.out else
        let
          dn0 = builtins.head q;
          dn = cleanLabel dn0;
          rest = builtins.tail q;
        in
          if builtins.hasAttr dn st.seen then go st rest else
          let
            seen' = st.seen // { "${dn}" = true; };
            n = nodeOfName dn;
            isPyExt = n != null && builtins.elem "kind:pyext" (labelsOf n);
            out' = if isPyExt then st.out ++ [ dn ] else st.out;
            nexts = if n == null then [] else depsOfName dn;
          in go { seen = seen'; out = out'; } (rest ++ nexts);
    in go { seen = {}; out = []; } startDeps;

  mkApp = name:
    let
      pyExtDeps = collectPyExtDepsTransitive name;
      overlays = map mkPyExt pyExtDeps;
    in T.pyApp {
      inherit name;
      lockfile = lockRelFor name;
      srcRoot = repoRoot;
      subdir = pkgPathOf name;
      nativeModuleOverlays = overlays;
    };

  mkLib = name:
    let
      pyExtDeps = collectPyExtDepsTransitive name;
      overlays = map mkPyExt pyExtDeps;
    in T.pyLib {
      inherit name;
      lockfile = lockRelFor name;
      srcRoot = repoRoot;
      subdir = pkgPathOf name;
      nativeModuleOverlays = overlays;
    };

  mkTest = name:
    let
      pyExtDeps = collectPyExtDepsTransitive name;
      overlays = map mkPyExt pyExtDeps;
    in T.pyTest {
      inherit name;
      lockfile = lockRelFor name;
      srcRoot = repoRoot;
      subdir = pkgPathOf name;
      nativeModuleOverlays = overlays;
    };

  mkPyExt = name:
    let
      n = nodeOfName name;
      mod = ensureString ("module for " + name) (if n == null then null else get n "module");
      cflags = ensureStringList ("cflags for " + name) (if n == null then null else get n "cflags");
      ldflags = ensureStringList ("ldflags for " + name) (if n == null then null else get n "ldflags");
      buildPyDeps = ensureStringList ("build_py_deps for " + name) (if n == null then null else get n "build_py_deps");
      linkDeps0 = normalizeLabelList ("link_deps for " + name) (if n == null then null else get n "link_deps");
      headerDeps0 = normalizeLabelList ("header_deps for " + name) (if n == null then null else get n "header_deps");
      defaultClosure =
        let raw = if n == null then null else get n "link_closure";
        in if raw == null then "direct"
           else if builtins.isString raw then raw
           else builtins.throw ("python planner: expected link_closure for " + name + " to be a string");
      overridesRaw = if n == null then null else get n "link_closure_overrides";
      overrides0 = normalizeOverrides name overridesRaw;
      overrideKeys = builtins.attrNames overrides0;
      missingOverrideKeys = builtins.filter (k: !(builtins.elem k linkDeps0)) overrideKeys;
      _overrideKeysValid =
        if missingOverrideKeys == [] then null
        else builtins.throw ("python planner: link_closure_overrides for " + name + " contains keys not present in link_deps: " + (builtins.toString missingOverrideKeys));
      linkDepsOf = nm:
        let
          dn = cleanLabel nm;
          nn = nodeOfName dn;
          raw = if nn == null then null else get nn "link_deps";
        in normalizeLabelList ("link_deps for " + dn) raw;
      resolvedLinkDeps = LC.resolveLinkClosure {
        inherit (core) byName;
        linkDepsOf = linkDepsOf;
        roots = linkDeps0;
        defaultClosure = defaultClosure;
        overrides = overrides0;
      };
      repoLinkPkgs = builtins.map (dn: mkCppLib (ensureRepoCppLibDep name dn)) resolvedLinkDeps;
      repoHeaderPkgs = builtins.map (dn: mkCppHeaders (ensureRepoCppHeadersDep name dn)) headerDeps0;
      includeRoots = builtins.map (p: "${p}/include") repoHeaderPkgs;
      lockRel = lockRelFor name;
      importerDir =
        if lib.hasSuffix "/uv.lock" lockRel then lib.removeSuffix "/uv.lock" lockRel
        else pkgPathOf name;
      wheelhouse =
        if (builtins.length buildPyDeps) > 0 then (
          T.pyWheelhouse {
            name = name;
            lockfile = lockRel;
            subdir = importerDir;
            srcRoot = repoRoot;
          }
        ) else null;
    in T.pyExt {
      inherit name;
      module = mod;
      lockfile = lockRel;
      srcRoot = repoRoot;
      subdir = pkgPathOf name;
      srcList = core.srcsOf name;
      nixCxxAttrs = collectNixAttrsFor name;
      cflags = cflags;
      ldflags = ldflags;
      wheelhouse = wheelhouse;
      buildPyDeps = buildPyDeps;
      repoCxxPkgs = repoLinkPkgs;
      includeRoots = includeRoots;
    };
in {
  inherit collectPyExtDepsTransitive;
  inherit mkApp mkLib mkTest mkPyExt;
}
