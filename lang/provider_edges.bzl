load("//lang:collections.bzl", "dedupe_preserve")
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


