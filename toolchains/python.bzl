load(
    "@prelude//toolchains:python.bzl",
    _system_python_bootstrap_toolchain = "system_python_bootstrap_toolchain",
    _system_python_toolchain = "system_python_toolchain",
)
load("//:toolchain_paths.bzl", "NIX_PYTHON_BIN")

def _require_nix_bin(bin_path, label):
    if not bin_path or not bin_path.startswith("/nix/store/"):
        fail("{} must be a /nix/store path (got: {}). Run build-tools/tools/dev/gen-toolchain-paths.ts or i.".format(label, bin_path))

def system_python_bootstrap_toolchain(**kwargs):
    _require_nix_bin(NIX_PYTHON_BIN, "NIX_PYTHON_BIN")
    kw = dict(kwargs)
    kw["interpreter"] = NIX_PYTHON_BIN
    return _system_python_bootstrap_toolchain(**kw)

def system_python_toolchain(**kwargs):
    _require_nix_bin(NIX_PYTHON_BIN, "NIX_PYTHON_BIN")
    kw = dict(kwargs)
    kw["interpreter"] = NIX_PYTHON_BIN
    return _system_python_toolchain(**kw)


