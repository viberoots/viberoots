load("@prelude//go:def.bzl", "go_binary", "go_library", "go_test")
load("//third_party/providers:auto_map.bzl", "MODULE_PROVIDERS")

def _providers_for(name):
    pkg = native.package_name()
    key = "//%s:%s" % (pkg, name)
    return MODULE_PROVIDERS.get(key, [])

def _normalize_build_tags(tags):
    # Lowercase, de-duplicate, sorted
    s = {}
    for t in tags or []:
        if not isinstance(t, str):
            continue
        s[t.lower()] = True
    out = sorted(s.keys())
    return out

def _append_tuple_labels(kwargs, build_tags, goos, goarch, cgo_enabled):
    labels = kwargs.pop("labels", [])
    extra = []
    norm_tags = _normalize_build_tags(build_tags)
    if len(norm_tags) > 0:
        extra.append("gotags:" + ",".join(norm_tags))
    if isinstance(goos, str) and goos != "":
        extra.append("goenv:GOOS=" + goos.lower())
    if isinstance(goarch, str) and goarch != "":
        extra.append("goenv:GOARCH=" + goarch.lower())
    if cgo_enabled != None:
        extra.append("goenv:CGO_ENABLED=" + ("1" if bool(cgo_enabled) else "0"))
    kwargs["labels"] = labels + extra

def nix_go_library(name, **kwargs):
    build_tags = kwargs.pop("build_tags", [])
    goos = kwargs.pop("goos", None)
    goarch = kwargs.pop("goarch", None)
    cgo_enabled = kwargs.pop("cgo_enabled", None)
    _append_tuple_labels(kwargs, build_tags, goos, goarch, cgo_enabled)
    deps = kwargs.pop("deps", [])
    deps = deps + _providers_for(name)
    go_library(name = name, deps = deps, **kwargs)

def nix_go_binary(name, **kwargs):
    build_tags = kwargs.pop("build_tags", [])
    goos = kwargs.pop("goos", None)
    goarch = kwargs.pop("goarch", None)
    cgo_enabled = kwargs.pop("cgo_enabled", None)
    _append_tuple_labels(kwargs, build_tags, goos, goarch, cgo_enabled)
    deps = kwargs.pop("deps", [])
    deps = deps + _providers_for(name)
    go_binary(name = name, deps = deps, **kwargs)

def nix_go_test(name, **kwargs):
    build_tags = kwargs.pop("build_tags", [])
    goos = kwargs.pop("goos", None)
    goarch = kwargs.pop("goarch", None)
    cgo_enabled = kwargs.pop("cgo_enabled", None)
    _append_tuple_labels(kwargs, build_tags, goos, goarch, cgo_enabled)
    deps = kwargs.pop("deps", [])
    deps = deps + _providers_for(name)
    go_test(name = name, deps = deps, **kwargs)


