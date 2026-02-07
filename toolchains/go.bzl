load("@prelude//go:toolchain.bzl", "GoToolchainInfo")
load("@prelude//go_bootstrap:go_bootstrap.bzl", "GoBootstrapToolchainInfo")
load("@prelude//os_lookup:defs.bzl", "ScriptLanguage")
load("@prelude//utils:cmd_script.bzl", "cmd_script")
load("//:toolchain_paths.bzl", "NIX_GO_BIN", "NIX_GO_ROOT")

def _require_nix_bin(bin_path, label):
    if not bin_path or not bin_path.startswith("/nix/store/"):
        fail("{} must be a /nix/store path (got: {}). Run build-tools/tools/dev/gen-toolchain-paths.ts or i.".format(label, bin_path))

def _go_platform() -> (str, str):
    arch = host_info().arch
    if arch.is_aarch64:
        go_arch = "arm64"
    elif arch.is_x86_64:
        go_arch = "amd64"
    else:
        fail("Unsupported go arch: {}".format(arch))

    os = host_info().os
    if os.is_macos:
        go_os = "darwin"
    elif os.is_linux:
        go_os = "linux"
    elif os.is_windows:
        go_os = "windows"
    else:
        fail("Unsupported go os: {}".format(os))

    return go_os, go_arch

def _nix_go_bootstrap_toolchain_impl(ctx):
    _require_nix_bin(ctx.attrs.go, "NIX_GO_BIN")
    go_os, go_arch = _go_platform()
    script_language = ScriptLanguage("bat" if go_os == "windows" else "sh")
    return [
        DefaultInfo(),
        GoBootstrapToolchainInfo(
            env_go_arch = go_arch,
            env_go_os = go_os,
            env_go_root = ctx.attrs.go_root or None,
            go = RunInfo(cmd_script(ctx, "go", cmd_args(ctx.attrs.go), script_language)),
            go_wrapper = ctx.attrs.go_wrapper[RunInfo],
        ),
    ]

system_go_bootstrap_toolchain = rule(
    impl = _nix_go_bootstrap_toolchain_impl,
    attrs = {
        "go": attrs.string(default = NIX_GO_BIN),
        "go_root": attrs.string(default = NIX_GO_ROOT),
        "go_wrapper": attrs.default_only(attrs.dep(providers = [RunInfo], default = "prelude//go/tools:go_wrapper_py")),
    },
    is_toolchain_rule = True,
)

def _nix_go_toolchain_impl(ctx):
    _require_nix_bin(ctx.attrs.go, "NIX_GO_BIN")
    go_os, go_arch = _go_platform()
    script_language = ScriptLanguage("bat" if go_os == "windows" else "sh")
    return [
        DefaultInfo(),
        GoToolchainInfo(
            assembler = RunInfo(cmd_script(ctx, "asm", cmd_args(ctx.attrs.go, "tool", "asm"), script_language)),
            cgo = RunInfo(cmd_script(ctx, "cgo", cmd_args(ctx.attrs.go, "tool", "cgo"), script_language)),
            cgo_wrapper = ctx.attrs.cgo_wrapper[RunInfo],
            concat_files = ctx.attrs.concat_files[RunInfo],
            compiler = RunInfo(cmd_script(ctx, "compile", cmd_args(ctx.attrs.go, "tool", "compile"), script_language)),
            cover = RunInfo(cmd_script(ctx, "cover", cmd_args(ctx.attrs.go, "tool", "cover"), script_language)),
            env_go_arch = go_arch,
            env_go_os = go_os,
            env_go_root = ctx.attrs.go_root or None,
            external_linker_flags = [],
            gen_stdlib_importcfg = ctx.attrs.gen_stdlib_importcfg[RunInfo],
            go = RunInfo(cmd_script(ctx, "go", cmd_args(ctx.attrs.go), script_language)),
            go_wrapper = ctx.attrs.go_wrapper[RunInfo],
            linker = RunInfo(cmd_script(ctx, "link", cmd_args(ctx.attrs.go, "tool", "link"), script_language)),
            packer = RunInfo(cmd_script(ctx, "pack", cmd_args(ctx.attrs.go, "tool", "pack"), script_language)),
            build_tags = [],
            linker_flags = [],
            assembler_flags = [],
            compiler_flags = [],
        ),
    ]

system_go_toolchain = rule(
    impl = _nix_go_toolchain_impl,
    attrs = {
        "go": attrs.string(default = NIX_GO_BIN),
        "go_root": attrs.string(default = NIX_GO_ROOT),
        "cgo_wrapper": attrs.default_only(attrs.dep(providers = [RunInfo], default = "prelude//go/tools:cgo_wrapper")),
        "concat_files": attrs.default_only(attrs.dep(providers = [RunInfo], default = "prelude//go_bootstrap/tools:go_concat_files")),
        "gen_stdlib_importcfg": attrs.default_only(attrs.dep(providers = [RunInfo], default = "prelude//go/tools:gen_stdlib_importcfg")),
        "go_wrapper": attrs.default_only(attrs.dep(providers = [RunInfo], default = "prelude//go_bootstrap/tools:go_go_wrapper")),
    },
    is_toolchain_rule = True,
)


