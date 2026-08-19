{ lib, P, ctx, nodeFor, normalizeList, sourcePath }:
let
  clean = P.cleanLabel;
  repoRoot = builtins.toString ctx.repoRoot;
  tauriSourceRoot = builtins.path {
    path = ctx.repoRoot;
    name = "viberoots-tauri-source";
    filter = path: _type:
      let
        absolute = builtins.toString path;
        relative = lib.removePrefix "${repoRoot}/" absolute;
      in absolute == repoRoot
        || relative == "projects"
        || lib.hasPrefix "projects/" relative;
  };
  requiredString = name: field:
    let value = ctx.get (nodeFor name) field;
    in if value == null || !(builtins.isString value) || value == ""
       then builtins.throw "Tauri target ${name} requires ${field}"
       else value;
  sourceList = name: field:
    let value = ctx.get (nodeFor name) field;
    in if value == null then []
       else if builtins.isList value && builtins.all builtins.isString value
       then map (item: tauriSourceRoot + "/${sourcePath name item}") value
       else builtins.throw "Tauri target ${name} ${field} must be a list of declared sources";
  stringList = name: field:
    let value = ctx.get (nodeFor name) field;
    in if builtins.isList value && builtins.all builtins.isString value
       then value
       else builtins.throw "Tauri target ${name} ${field} must be a list of strings";
  mappedSources = name:
    let
      paths = sourceList name "resources";
      sources = stringList name "resource_sources";
      destinations = stringList name "resource_destinations";
    in if builtins.length paths != builtins.length sources
      || builtins.length paths != builtins.length destinations
       then builtins.throw "Tauri target ${name} resource mapping fields disagree"
       else lib.imap0 (index: path: {
         inherit path;
         source = builtins.elemAt sources index;
         destination = builtins.elemAt destinations index;
       }) paths;
  artifactRecord = destinations: index: dep: {
    label = clean dep;
    artifact = ctx.dependencyArtifactOf dep;
    destination = builtins.elemAt destinations index;
  };
  validateFrontend = name: dep:
    let labels = P.labelsOf (nodeFor dep);
    in if builtins.elem "lang:node" labels
       && (builtins.elem "kind:app" labels || builtins.elem "kind:webapp" labels)
       && builtins.elem "webapp:static" labels
       then dep
       else builtins.throw
         "Tauri target ${name} frontend_dist must be a Buck-built static Node webapp: ${dep}";
  validateSidecar = name: dep:
    let labels = P.labelsOf (nodeFor dep);
    in if builtins.elem "sidecar:reviewed" labels && builtins.elem "kind:bin" labels
       then dep
       else builtins.throw
         "Tauri target ${name} sidecar_deps requires kind:bin and sidecar:reviewed: ${dep}";
  typedTargetFor = name:
    let
      value = ctx.get (nodeFor name) "tauri_target";
      field = key:
        if builtins.isAttrs value && builtins.hasAttr key value then builtins.getAttr key value else "";
      expectedKeys = [
        "artifactKind"
        "bundleIdentifier"
        "deploymentEligibility"
        "family"
        "packageName"
        "platform"
        "signingMode"
      ];
      actualKeys = if builtins.isAttrs value then builtins.attrNames value else [];
      extraKeys = builtins.filter (key: !(builtins.elem key expectedKeys)) actualKeys;
    in if !(builtins.isAttrs value)
      then builtins.throw "Tauri target ${name} requires typed tauri_target metadata"
      else if extraKeys != []
      then builtins.throw "Tauri target ${name} tauri_target has unknown fields: ${builtins.toString extraKeys}"
      else if field "family" != "tauri"
      then builtins.throw "Tauri target ${name} tauri_target.family must be tauri"
      else if field "platform" != "desktop-darwin"
      then builtins.throw "Tauri target ${name} has no reviewed mobile builder for ${(field "platform")}"
      else if field "artifactKind" != "macos-app"
      then builtins.throw "Tauri target ${name} artifactKind must be macos-app for desktop-darwin"
      else if field "signingMode" != "adhoc-platform"
      then builtins.throw "Tauri target ${name} signingMode must be adhoc-platform for desktop-darwin"
      else if field "deploymentEligibility" != "not-eligible"
      then builtins.throw "Tauri target ${name} local desktop artifacts are not deployment eligible"
      else value;
in {
  contractFor = name: selectedSystem:
    let
      frontend = validateFrontend name (clean (requiredString name "frontend_dist"));
      sidecarDeps = map (validateSidecar name)
        (normalizeList "sidecar_deps" (ctx.get (nodeFor name) "sidecar_deps"));
      sidecarDestinations = stringList name "sidecar_destinations";
      platform = requiredString name "tauri_platform";
      tauriTarget = typedTargetFor name;
    in if platform != "aarch64-darwin" then builtins.throw
      "Tauri target ${name} has no reviewed native package/launch evidence for ${platform}"
    else if selectedSystem != platform then builtins.throw
      "Tauri target ${name} requires selected system ${platform}; got ${selectedSystem}"
    else if builtins.length sidecarDeps != builtins.length sidecarDestinations
    then builtins.throw "Tauri target ${name} sidecar mapping fields disagree"
    else {
      inherit platform;
      target = tauriTarget;
      sourceRoot = tauriSourceRoot;
      root = requiredString name "tauri_root";
      config = tauriSourceRoot
        + "/${sourcePath name (requiredString name "tauri_config")}";
      frontend = ctx.dependencyArtifactOf frontend;
      resources = mappedSources name;
      capabilities = sourceList name "capabilities";
      permissions = sourceList name "permissions";
      icons = sourceList name "icons";
      androidConfig = let value = ctx.get (nodeFor name) "android_config"; in if value == null || value == "" then "" else tauriSourceRoot + "/${sourcePath name value}";
      iosConfig = let value = ctx.get (nodeFor name) "ios_config"; in if value == null || value == "" then "" else tauriSourceRoot + "/${sourcePath name value}";
      androidProjectSrcs = sourceList name "android_project_srcs";
      iosProjectSrcs = sourceList name "ios_project_srcs";
      sidecars = lib.imap0 (artifactRecord sidecarDestinations) sidecarDeps;
      appCommands = stringList name "app_commands";
      appWindows = stringList name "app_windows";
    };
}
