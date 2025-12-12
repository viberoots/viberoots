load("//lang:collections.bzl", "dedupe_preserve")

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
    base_list = base if isinstance(base, list) else []
    provs = providers_for(MODULE_PROVIDERS, name)
    return dedupe_preserve(base_list + provs)


