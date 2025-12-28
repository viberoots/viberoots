def maybe_autowire_go_library_test(nix_go_test, name):
    tests = native.glob(["pkg/**/*_test.go"]) or []
    if len(tests) == 0:
        return
    nix_go_test(
        name = name + "_test",
        library = ":%s" % name,
        srcs = tests,
    )


def _binary_pkg_srcs(name):
    pkg_srcs = native.glob(["cmd/%s/**/*.go" % name], exclude = ["**/*_test.go"]) or []
    if len(pkg_srcs) > 0:
        return pkg_srcs
    return native.glob(["cmd/**/*.go"], exclude = ["**/*_test.go"]) or []


def maybe_autowire_go_binary_test(nix_go_library, nix_go_test, name, base_deps, extra_module_providers, build_tags, goos, goarch, cgo_enabled, nixpkg_deps, repo_cgo_deps, local_patch_dirs):
    tests = native.glob(["cmd/%s/**/*_test.go" % name]) or []
    if len(tests) == 0:
        return

    nix_go_library(
        name = name + "_pkg",
        srcs = _binary_pkg_srcs(name),
        deps = base_deps,
        extra_module_providers = extra_module_providers,
        build_tags = build_tags,
        goos = goos,
        goarch = goarch,
        cgo_enabled = cgo_enabled,
        nixpkg_deps = nixpkg_deps,
        repo_cgo_deps = repo_cgo_deps,
        local_patch_dirs = local_patch_dirs,
        visibility = ["PUBLIC"],
    )
    nix_go_test(
        name = name + "_test",
        library = ":%s" % (name + "_pkg"),
        srcs = tests,
    )


