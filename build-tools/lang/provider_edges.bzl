load("//build-tools/lang:collections.bzl", "dedupe_preserve")
load("//build-tools/lang:dict_inputs.bzl", "PROVIDER_EDGES_KEY_PREFIX", "attach_items_dict_safe")
load("//build-tools/lang:auto_map.bzl", _DEFAULT_MODULE_PROVIDERS = "MODULE_PROVIDERS")
load("@prelude//:rules.bzl", "genrule")

def target_key_for_current_package(name):
    pkg = native.package_name()
    return "//%s:%s" % (pkg, name)

def providers_for(MODULE_PROVIDERS, name):
    key = target_key_for_current_package(name)
    labels = MODULE_PROVIDERS.get(key, [])
    out = []
    for l in labels:
        if isinstance(l, str):
            out.append(l)
    return out

def realize_provider_edges(MODULE_PROVIDERS, name, into = "deps", base = None):
    if into != "deps" and into != "srcs":
        fail("realize_provider_edges: into must be 'deps' or 'srcs'; got: %s" % into)

    provs = providers_for(MODULE_PROVIDERS, name)

    if base == None:
        return dedupe_preserve(provs)

    if isinstance(base, list):
        return dedupe_preserve(base + provs)

    if isinstance(base, dict):
        cur = base.get(into, []) or []
        if not isinstance(cur, list):
            fail("realize_provider_edges: expected %s to be a list; got: %s" % (into, cur))
        merged = dedupe_preserve(cur + provs)
        base[into] = merged
        return merged

    fail("realize_provider_edges: base must be None, list, or dict; got: %s" % base)


def merge_provider_edges(
        name,
        deps,
        into = "deps",
        base = None,
        dict_safe = False,
        key_prefix = PROVIDER_EDGES_KEY_PREFIX,
        MODULE_PROVIDERS = None):
    provs = _DEFAULT_MODULE_PROVIDERS if MODULE_PROVIDERS == None else MODULE_PROVIDERS

    if dict_safe:
        dst_to_src = {} if base == None else (dict(base) if isinstance(base, dict) else {})
        merged = realize_provider_edges(provs, name, into = into, base = (deps or []))
        return attach_items_dict_safe(dst_to_src, merged, key_prefix)

    merged_base = deps if base == None else base
    return realize_provider_edges(provs, name, into = into, base = merged_base)


def merge_provider_edges_list_probe(name, target_name, providers, base_list = [], into = "deps"):
    MODULE_PROVIDERS = {
        target_key_for_current_package(target_name): providers,
    }
    merged = merge_provider_edges(target_name, base_list, into = into, MODULE_PROVIDERS = MODULE_PROVIDERS)
    out = name + ".txt"
    genrule(
        name = name,
        srcs = [],
        out = out,
        cmd = "cat > $OUT <<'EOF'\n%s\nEOF" % "\n".join(merged),
        labels = ["kind:probe"],
    )


def merge_provider_edges_dict_safe_probe(
        name,
        target_name,
        providers,
        deps = [],
        base_dict = None,
        key_prefix = PROVIDER_EDGES_KEY_PREFIX):
    MODULE_PROVIDERS = {
        target_key_for_current_package(target_name): providers,
    }
    dst_to_src = {} if base_dict == None else (dict(base_dict) if isinstance(base_dict, dict) else {})
    merged = merge_provider_edges(
        target_name,
        deps,
        into = "srcs",
        base = dst_to_src,
        dict_safe = True,
        key_prefix = key_prefix,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
    out = name + ".items.txt"
    lines = []
    for k in sorted(merged.keys()):
        lines.append("%s=%s" % (k, merged[k]))
    genrule(
        name = name,
        srcs = [],
        out = out,
        cmd = "cat > $OUT <<'EOF'\n%s\nEOF" % "\n".join(lines),
        labels = ["kind:probe"],
    )


def realize_provider_edges_probe(name, target_name, providers, base_list = [], into = "deps", use_kwargs = False):
    MODULE_PROVIDERS = {
        target_key_for_current_package(target_name): providers,
    }

    if use_kwargs:
        merged = realize_provider_edges(MODULE_PROVIDERS, target_name, into = into, base = { into: base_list })
    else:
        merged = realize_provider_edges(MODULE_PROVIDERS, target_name, into = into, base = base_list)

    out = name + ".txt"
    genrule(
        name = name,
        srcs = [],
        out = out,
        cmd = "cat > $OUT <<'EOF'\n%s\nEOF" % "\n".join(merged),
        labels = ["kind:probe"],
    )


def strip_provider_targets(deps, provider_prefix = "//third_party/providers:"):
    if deps == None:
        return []
    if not isinstance(deps, list):
        fail("strip_provider_targets: deps must be a list; got: %s" % deps)
    if not isinstance(provider_prefix, str) or provider_prefix == "":
        fail("strip_provider_targets: provider_prefix must be a non-empty string; got: %s" % provider_prefix)
    # Normalize for cell-prefixed labels by dropping the leading "//" from the prefix.
    # Example: "//third_party/providers:" -> "third_party/providers:"
    suffix = provider_prefix[2:] if provider_prefix.startswith("//") else provider_prefix
    out = []
    for d in deps:
        if isinstance(d, str):
            # Accept both cell-less and cell-prefixed labels (e.g. "//..." and "root//...").
            # Buck often renders labels with a cell prefix in query output; call sites should not
            # need to account for that when asking to strip provider targets.
            parts = d.split("//", 1)
            if len(parts) == 2 and (
                    parts[1].startswith(suffix) or
                    (d.startswith("workspace_providers//:") and parts[1].startswith(":"))):
                continue
            out.append(d)
            continue
        out.append(d)
    return out


def strip_provider_targets_probe(name, items, provider_prefix = "//third_party/providers:"):
    filtered = strip_provider_targets(items, provider_prefix = provider_prefix)
    lines = []
    for x in filtered:
        if isinstance(x, str):
            lines.append(x)
        else:
            lines.append(repr(x))

    out = name + ".txt"
    genrule(
        name = name,
        srcs = [],
        out = out,
        cmd = "cat > $OUT <<'EOF'\n%s\nEOF" % "\n".join(lines),
        labels = ["kind:probe"],
    )
