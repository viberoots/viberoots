{ lib }:
sourceRoot:
path:
_type:
let
  root = builtins.toString sourceRoot;
  rootWithSlash = root + "/";
  absolute = builtins.toString path;
  relative = if lib.hasPrefix rootWithSlash absolute then lib.removePrefix rootWithSlash absolute else absolute;
  testRoot = "build-tools/tools/tests";
  runtimeTestSupport = [
    "${testRoot}/defs.bzl"
    "${testRoot}/dev/canonical-artifact-reviewed-config-handoff.fixture.ts"
    "${testRoot}/template_taxonomy_adapter.bzl"
  ];
  runtimeTestSupportDirs = [
    "${testRoot}/dev"
  ];
in
if relative == testRoot then true
else if builtins.elem relative runtimeTestSupportDirs then true
else if lib.hasPrefix "${testRoot}/" relative then builtins.elem relative runtimeTestSupport
else true
