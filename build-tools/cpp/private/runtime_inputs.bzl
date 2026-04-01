load("//build-tools/lang:collections.bzl", "dedupe_preserve")
load("//build-tools/lang:global_inputs.bzl", "global_nix_inputs")

_CPP_RUNTIME_NIX_INPUTS = [
    "//build-tools/tools/buck:runtime_ts",
    "//build-tools/tools/dev:runtime_ts",
    "//build-tools/tools/lib:runtime_ts",
    "//build-tools/tools/nix:runtime_nix",
]

def cpp_runtime_nix_inputs():
    """
    Hidden action inputs for C++ rules that execute planner/exporter glue from
    the live workspace.

    These files are read by the Buck action at execution time, so they must be
    part of the Buck rule key to keep planner/helper edits from going stale.
    """
    return dedupe_preserve(global_nix_inputs() + _CPP_RUNTIME_NIX_INPUTS)
