load("//lang:dict_inputs.bzl", "PROVIDER_EDGES_KEY_PREFIX")
load("//lang:labels_file.bzl", "labels_file")
load("//lang:planner_visible_wiring.bzl", "wire_planner_visible_inputs")
load("//lang:provider_edges.bzl", "target_key_for_current_package")

def planner_visible_inputs_probe(
        name,
        target_name,
        providers,
        deps = [],
        srcs = [],
        extra_srcs = [],
        srcs_include_deps = False,
        provider_realization_mode = None,
        realize_providers_into = None,
        strip_providers_from_deps = True,
        provider_dict_safe = False,
        provider_key_prefix = PROVIDER_EDGES_KEY_PREFIX):
    MODULE_PROVIDERS = {
        target_key_for_current_package(target_name): providers,
    }
    wired = wire_planner_visible_inputs(
        name = target_name,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        deps = deps,
        srcs = srcs,
        extra_srcs = extra_srcs,
        srcs_include_deps = srcs_include_deps,
        provider_realization_mode = provider_realization_mode,
        realize_providers_into = realize_providers_into,
        strip_providers_from_deps = strip_providers_from_deps,
        provider_dict_safe = provider_dict_safe,
        provider_key_prefix = provider_key_prefix,
    )
    srcs_out = wired.get("srcs", [])
    if isinstance(srcs_out, dict):
        items = sorted(srcs_out.keys())
    else:
        items = srcs_out
    labels_file(
        name = name,
        labels = items,
        out = name + ".items.txt",
    )
