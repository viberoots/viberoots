def _source_list(value, field):
    if not isinstance(value, list):
        fail("tauri_app: %s must be a list of declared source files" % field)
    for item in value:
        if not isinstance(item, str) or item == "":
            fail("tauri_app: %s must contain non-empty source paths" % field)
        if item.startswith("/") or ".." in item.split("/") or "\\" in item:
            fail("tauri_app: %s must remain package-relative: %s" % (field, item))
        if "*" in item:
            fail("tauri_app: %s does not accept wildcard paths: %s" % (field, item))
    return value

def _relative_path(value, field):
    if not isinstance(value, str) or value == "":
        fail("tauri_app: %s must be a non-empty relative path" % field)
    if value.startswith("/") or ".." in value.split("/") or "\\" in value or "*" in value:
        fail("tauri_app: %s must remain package-relative: %s" % (field, value))
    return value

def _rooted(root, value):
    return value if root == "." else root + "/" + value

def _optional_identifier(value, field):
    if value == "":
        return value
    parts = value.split(".")
    if len(parts) < 2:
        fail("tauri_app: %s must be a reverse-DNS identifier when supplied" % field)
    allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"
    for part in parts:
        if part == "" or part[0] == "-" or part[-1] == "-":
            fail("tauri_app: %s must be a conservative reverse-DNS identifier: %s" % (field, value))
        if [character for character in part.elems() if character not in allowed]:
            fail("tauri_app: %s must be a conservative reverse-DNS identifier: %s" % (field, value))
    return value

def _mapped_list(value, field):
    if not isinstance(value, list):
        fail("tauri_app: %s must be a list of explicit src/dest mappings" % field)
    sources = []
    destinations = []
    for item in value:
        if not isinstance(item, dict) or sorted(item.keys()) != ["dest", "src"]:
            fail("tauri_app: %s entries must contain only src and dest" % field)
        source = _relative_path(item["src"], field + " src")
        destination = _relative_path(item["dest"], field + " dest")
        if destination in destinations:
            fail("tauri_app: %s destinations must be unique: %s" % (field, destination))
        sources.append(source)
        destinations.append(destination)
    return (sources, destinations)

def _declared_identifiers(value, field, extra_characters = ""):
    if not isinstance(value, list):
        fail("tauri_app: %s must be a list of explicit identifiers" % field)
    first = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_"
    remaining = first + "0123456789" + extra_characters
    seen = []
    for item in value:
        if not isinstance(item, str) or item == "" or item[0] not in first or [c for c in item[1:].elems() if c not in remaining]:
            fail("tauri_app: %s must use a conservative identifier grammar: %s" % (field, item))
        if item in seen:
            fail("tauri_app: %s must not contain duplicate identifiers: %s" % (field, item))
        seen.append(item)
    return value

def prepare_mobile_source_attrs(kwargs, root):
    android_config = kwargs.pop("android_config", "")
    ios_config = kwargs.pop("ios_config", "")
    android_project_srcs = _source_list(kwargs.pop("android_project_srcs", []), "android_project_srcs")
    ios_project_srcs = _source_list(kwargs.pop("ios_project_srcs", []), "ios_project_srcs")
    return {
        "android_config": _rooted(root, _relative_path(android_config, "android_config")) if android_config else None,
        "ios_config": _rooted(root, _relative_path(ios_config, "ios_config")) if ios_config else None,
        "android_project_srcs": [_rooted(root, value) for value in android_project_srcs],
        "ios_project_srcs": [_rooted(root, value) for value in ios_project_srcs],
    }

_MOBILE_PUBLIC_ARGS = [
    "android_compile_sdk",
    "android_config",
    "android_min_sdk",
    "android_package",
    "android_project_srcs",
    "app_commands",
    "app_windows",
    "capabilities",
    "crate",
    "frontend_dist",
    "icons",
    "ios_bundle_identifier",
    "ios_config",
    "ios_deployment_target",
    "ios_project_srcs",
    "permissions",
    "resources",
    "srcs",
    "tauri_artifact_kind",
    "tauri_bundle_identifier",
    "tauri_config",
    "tauri_deployment_eligibility",
    "tauri_package_name",
    "tauri_root",
    "tauri_signing_mode",
]

_MOBILE_ONLY_ARGS = ["android_compile_sdk", "android_config", "android_min_sdk", "android_package", "android_project_srcs", "ios_bundle_identifier", "ios_config", "ios_deployment_target", "ios_project_srcs", "tauri_package_name"]
_PLUGIN_ARGS = ["plugins", "plugin_deps", "plugin_permissions", "tauri_plugins", "tauri_plugin_deps", "tauri_plugin_permissions"]

def _int_attr(value, field):
    if not isinstance(value, int) or value <= 0: fail("tauri_app: %s must be a positive integer" % field)
    return value

def _mobile_tauri_target(platform, artifact_kind, bundle_identifier, package_name, signing_mode, deployment_eligibility):
    kinds = {"ios": ["ios-simulator-bundle", "ios-unsigned-archive", "ios-signed-ipa"], "android": ["android-debug-apk", "android-unsigned-aab", "android-signed-aab"]}
    if platform not in kinds: fail("tauri_app: unsupported tauri mobile platform: %s" % platform)
    if artifact_kind not in kinds[platform]: fail("tauri_app: artifact kind %s is unsupported for %s" % (artifact_kind, platform))
    if signing_mode not in ["unsigned-local", "debug-local", "release-signed"]: fail("tauri_app: unsupported signing mode: %s" % signing_mode)
    if deployment_eligibility not in ["not-eligible", "release-admitted"]: fail("tauri_app: deployment eligibility must be not-eligible or release-admitted")
    if deployment_eligibility == "release-admitted" and signing_mode != "release-signed": fail("tauri_app: only release-signed artifacts may be deployment eligible")
    if (artifact_kind.endswith("signed-aab") or artifact_kind.endswith("signed-ipa")) and signing_mode != "release-signed": fail("tauri_app: signed mobile artifacts require release-signed signing mode")
    return {"family": "tauri", "platform": platform, "artifactKind": artifact_kind, "bundleIdentifier": bundle_identifier, "packageName": package_name, "signingMode": signing_mode, "deploymentEligibility": deployment_eligibility}

def _prepare_disabled_attrs(macro_name, platform, kwargs):
    kw = dict(kwargs)
    for key in _PLUGIN_ARGS:
        if key in kw: fail("%s: unreviewed plugin declarations are not supported: %s" % (macro_name, key))
    unknown = sorted([key for key in kw.keys() if key not in _MOBILE_PUBLIC_ARGS])
    if unknown:
        fail("%s: unknown arguments: %s" % (macro_name, ", ".join(unknown)))
    root = kw.pop("tauri_root", ".")
    if root not in [".", "src-tauri"]:
        fail("tauri_app: tauri_root must be . or src-tauri")
    config = kw.pop("tauri_config", "tauri.conf.json")
    if config != "tauri.conf.json":
        fail("tauri_app: tauri_config must be the canonical tauri-root-relative tauri.conf.json")
    frontend = kw.pop("frontend_dist", None)
    if not isinstance(frontend, str) or frontend == "":
        fail("tauri_app: frontend_dist must name one Buck-built frontend target")
    resource_sources, resource_destinations = _mapped_list(kw.pop("resources", []), "resources")
    icons = _source_list(kw.pop("icons", []), "icons")
    if not icons:
        fail("tauri_app: icons must declare at least one package-relative icon")
    mobile = prepare_mobile_source_attrs(kw, root)
    bundle_identifier = _optional_identifier(kw.pop("ios_bundle_identifier", kw.pop("tauri_bundle_identifier", "")), "ios_bundle_identifier")
    package_name = _optional_identifier(kw.pop("android_package", kw.pop("tauri_package_name", "")), "android_package")
    artifact_kind = kw.pop("tauri_artifact_kind", "ios-simulator-bundle" if platform == "ios" else "android-debug-apk")
    signing_mode = kw.pop("tauri_signing_mode", "unsigned-local" if platform == "ios" else "debug-local")
    deployment_eligibility = kw.pop("tauri_deployment_eligibility", "not-eligible")
    tauri_target = _mobile_tauri_target(platform, artifact_kind, bundle_identifier, package_name, signing_mode, deployment_eligibility)
    attrs = {
        "crate": kw.pop("crate", ""),
        "frontend_dist": frontend,
        "tauri_root": root,
        "tauri_config": _rooted(root, config),
        "tauri_target": tauri_target,
        "resources": [_rooted(root, value) for value in resource_sources],
        "resource_sources": resource_sources,
        "resource_destinations": resource_destinations,
        "capabilities": [_rooted(root, value) for value in _source_list(kw.pop("capabilities", []), "capabilities")],
        "permissions": [_rooted(root, value) for value in _source_list(kw.pop("permissions", []), "permissions")],
        "icons": [_rooted(root, value) for value in icons],
        "srcs": [_rooted(root, value) for value in _source_list(kw.pop("srcs", []), "srcs")],
        "app_commands": _declared_identifiers(kw.pop("app_commands", []), "app_commands"),
        "app_windows": _declared_identifiers(kw.pop("app_windows", ["main"]), "app_windows", "-"),
        "android_package": package_name,
        "android_min_sdk": _int_attr(kw.pop("android_min_sdk", 24), "android_min_sdk"),
        "android_compile_sdk": _int_attr(kw.pop("android_compile_sdk", 35), "android_compile_sdk"),
        "ios_bundle_identifier": bundle_identifier,
        "ios_deployment_target": kw.pop("ios_deployment_target", "17.0"),
    }
    attrs.update(mobile)
    return attrs

def _disabled_mobile_tauri_impl(ctx):
    fail("%s: platform-not-enabled: mobile Tauri platform is loadable but disabled until its reviewed platform builder lands" % ctx.attrs.macro_name)

_disabled_mobile_tauri_target = rule(
    impl = _disabled_mobile_tauri_impl,
    attrs = {
        "macro_name": attrs.string(), "mobile_platform": attrs.string(), "suite_members": attrs.list(attrs.string(), default = []),
        "crate": attrs.string(default = ""), "frontend_dist": attrs.option(attrs.dep(), default = None), "tauri_root": attrs.string(default = "."), "tauri_config": attrs.option(attrs.source(), default = None),
        "tauri_target": attrs.dict(key = attrs.string(), value = attrs.string(), default = {}),
        "resources": attrs.list(attrs.source(), default = []), "resource_sources": attrs.list(attrs.string(), default = []), "resource_destinations": attrs.list(attrs.string(), default = []),
        "capabilities": attrs.list(attrs.source(), default = []), "permissions": attrs.list(attrs.source(), default = []), "icons": attrs.list(attrs.source(), default = []), "srcs": attrs.list(attrs.source(), default = []),
        "app_commands": attrs.list(attrs.string(), default = []), "app_windows": attrs.list(attrs.string(), default = []),
        "android_config": attrs.option(attrs.source(), default = None), "android_project_srcs": attrs.list(attrs.source(), default = []), "android_package": attrs.string(default = ""), "android_min_sdk": attrs.int(default = 24), "android_compile_sdk": attrs.int(default = 35),
        "ios_config": attrs.option(attrs.source(), default = None), "ios_project_srcs": attrs.list(attrs.source(), default = []), "ios_bundle_identifier": attrs.string(default = ""), "ios_deployment_target": attrs.string(default = "17.0"),
    },
)

def disabled_mobile_tauri_macro(name, macro_name, mobile_platform = "", suite_members = [], kwargs = {}):
    _disabled_mobile_tauri_target(name = name, macro_name = macro_name, mobile_platform = mobile_platform, suite_members = suite_members, **_prepare_disabled_attrs(macro_name, mobile_platform, kwargs))

def _private_mobile_fixture_impl(ctx):
    return [DefaultInfo(default_outputs = [])]

_private_mobile_fixture = rule(
    impl = _private_mobile_fixture_impl,
    attrs = {"tauri_target": attrs.dict(key = attrs.string(), value = attrs.string(), default = {}), "android_config": attrs.option(attrs.source(), default = None), "android_project_srcs": attrs.list(attrs.source(), default = []), "ios_config": attrs.option(attrs.source(), default = None), "ios_project_srcs": attrs.list(attrs.source(), default = [])},
)

def private_mobile_tauri_contract_fixture(name, mobile_platform, **kwargs):
    prepared = _prepare_disabled_attrs("private_mobile_tauri_contract_fixture", mobile_platform, kwargs)
    _private_mobile_fixture(name = name, tauri_target = prepared["tauri_target"], android_config = prepared["android_config"], android_project_srcs = prepared["android_project_srcs"], ios_config = prepared["ios_config"], ios_project_srcs = prepared["ios_project_srcs"])

def _suite_kwargs(kwargs, platform):
    kw = dict(kwargs)
    overrides = kw.pop(platform + "_overrides", {}) or {}
    for key in ["desktop_overrides", "ios_overrides", "android_overrides"]:
        kw.pop(key, None)
    for key in _PLUGIN_ARGS:
        if key in kw: fail("tauri_mobile_suite: unreviewed plugin declarations are not supported: %s" % key)
    if not isinstance(overrides, dict): fail("tauri_mobile_suite: %s_overrides must be a dict" % platform)
    if platform == "desktop":
        for key in _MOBILE_ONLY_ARGS:
            kw.pop(key, None)
    kw.update(overrides)
    return kw

def _suite_platform_kwargs(kwargs, platform, frontend_dist):
    kw = _suite_kwargs(kwargs, platform)
    frontend = kw.pop("frontend_dist", frontend_dist); kw["frontend_dist"] = frontend; return kw

def tauri_mobile_suite_contract(name, frontend_dist, kwargs, tauri_app_macro):
    suite_members = [":" + name + "_desktop", ":" + name + "_ios", ":" + name + "_android"]
    desktop_kwargs = _suite_platform_kwargs(kwargs, "desktop", frontend_dist)
    desktop_frontend = desktop_kwargs.pop("frontend_dist")
    tauri_app_macro(name = name + "_desktop", frontend_dist = desktop_frontend, **desktop_kwargs)
    ios_kwargs = _suite_platform_kwargs(kwargs, "ios", frontend_dist)
    android_kwargs = _suite_platform_kwargs(kwargs, "android", frontend_dist)
    disabled_mobile_tauri_macro(name + "_ios", "tauri_mobile_suite", mobile_platform = "ios", suite_members = suite_members, kwargs = ios_kwargs)
    disabled_mobile_tauri_macro(name + "_android", "tauri_mobile_suite", mobile_platform = "android", suite_members = suite_members, kwargs = android_kwargs)

__all__ = ["disabled_mobile_tauri_macro", "prepare_mobile_source_attrs", "private_mobile_tauri_contract_fixture", "tauri_mobile_suite_contract"]
