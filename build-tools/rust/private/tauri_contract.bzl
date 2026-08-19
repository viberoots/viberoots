load("@viberoots//build-tools/rust/private:tauri_mobile_contract.bzl", "prepare_mobile_source_attrs")

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

def _declared_identifiers(value, field, extra_characters = ""):
    if not isinstance(value, list):
        fail("tauri_app: %s must be a list of explicit identifiers" % field)
    seen = []
    first_characters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_"
    remaining_characters = first_characters + "0123456789" + extra_characters
    for item in value:
        if not isinstance(item, str) or item == "":
            fail("tauri_app: %s must contain non-empty identifiers" % field)
        if item[0] not in first_characters:
            fail("tauri_app: %s must use a conservative identifier grammar: %s" % (field, item))
        if [character for character in item[1:].elems() if character not in remaining_characters]:
            fail("tauri_app: %s must use a conservative identifier grammar: %s" % (field, item))
        if item in seen:
            fail("tauri_app: %s must not contain duplicate identifiers: %s" % (field, item))
        seen.append(item)
    return value

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

def _mapped_list(value, field, labels = False):
    if not isinstance(value, list):
        fail("tauri_app: %s must be a list of explicit src/dest mappings" % field)
    sources = []
    destinations = []
    for item in value:
        if not isinstance(item, dict) or sorted(item.keys()) != ["dest", "src"]:
            fail("tauri_app: %s entries must contain only src and dest" % field)
        source = item["src"]
        if labels:
            if not isinstance(source, str) or source == "":
                fail("tauri_app: %s src must be a non-empty target label" % field)
        else:
            _relative_path(source, field + " src")
        destination = _relative_path(item["dest"], field + " dest")
        if destination in destinations:
            fail("tauri_app: %s destinations must be unique: %s" % (field, destination))
        sources.append(source)
        destinations.append(destination)
    return (sources, destinations)

def _tauri_target(platform, artifact_kind, bundle_identifier, package_name, signing_mode, deployment_eligibility):
    if platform not in ["desktop-darwin", "ios", "android"]:
        fail("tauri_app: unsupported tauri platform: %s" % platform)
    artifact_kinds = {
        "desktop-darwin": ["macos-app"],
        "ios": ["ios-simulator-bundle", "ios-unsigned-archive", "ios-signed-ipa"],
        "android": ["android-debug-apk", "android-unsigned-aab", "android-signed-aab"],
    }
    if artifact_kind not in artifact_kinds[platform]:
        fail("tauri_app: artifact kind %s is unsupported for %s" % (artifact_kind, platform))
    signing_modes = ["adhoc-platform", "unsigned-local", "debug-local", "release-signed"]
    if signing_mode not in signing_modes:
        fail("tauri_app: unsupported signing mode: %s" % signing_mode)
    if deployment_eligibility not in ["not-eligible", "release-admitted"]:
        fail("tauri_app: deployment eligibility must be not-eligible or release-admitted")
    if deployment_eligibility == "release-admitted" and signing_mode != "release-signed":
        fail("tauri_app: only release-signed artifacts may be deployment eligible")
    if platform == "desktop-darwin" and (
        artifact_kind != "macos-app" or signing_mode != "adhoc-platform" or deployment_eligibility != "not-eligible"
    ):
        fail("tauri_app: desktop-darwin currently supports only macos-app, adhoc-platform, not-eligible")
    if platform != "desktop-darwin":
        fail("tauri_app: %s metadata is planned, but no reviewed mobile builder is enabled" % platform)
    return {
        "family": "tauri",
        "platform": platform,
        "artifactKind": artifact_kind,
        "bundleIdentifier": bundle_identifier,
        "packageName": package_name,
        "signingMode": signing_mode,
        "deploymentEligibility": deployment_eligibility,
    }

def prepare_tauri_contract(kind, kwargs):
    if kind != "tauri":
        return {}
    kwargs["labels"] = (kwargs.get("labels", []) or []) + ["app:tauri", "platform:aarch64-darwin", "tauri-platform:desktop-darwin", "tauri-artifact:macos-app"]
    root = kwargs.pop("tauri_root", ".")
    if root not in [".", "src-tauri"]:
        fail("tauri_app: tauri_root must be . or src-tauri")
    config = kwargs.pop("tauri_config", "tauri.conf.json")
    if config != "tauri.conf.json":
        fail("tauri_app: tauri_config must be the canonical tauri-root-relative tauri.conf.json")
    frontend = kwargs.pop("frontend_dist", None)
    if not isinstance(frontend, str) or frontend == "":
        fail("tauri_app: frontend_dist must name one Buck-built frontend target")
    legacy_platform = kwargs.pop("tauri_platform", "aarch64-darwin")
    if legacy_platform != "aarch64-darwin":
        fail("tauri_app: only aarch64-darwin has reviewed native package and launch evidence; got %s" % legacy_platform)
    platform = kwargs.pop("tauri_target_platform", "desktop-darwin")
    artifact_kind = kwargs.pop("tauri_artifact_kind", "macos-app")
    bundle_identifier = _optional_identifier(kwargs.pop("tauri_bundle_identifier", ""), "tauri_bundle_identifier")
    package_name = _optional_identifier(kwargs.pop("tauri_package_name", ""), "tauri_package_name")
    signing_mode = kwargs.pop("tauri_signing_mode", "adhoc-platform")
    deployment_eligibility = kwargs.pop("tauri_deployment_eligibility", "not-eligible")
    tauri_target = _tauri_target(
        platform,
        artifact_kind,
        bundle_identifier,
        package_name,
        signing_mode,
        deployment_eligibility,
    )
    resource_sources, resource_destinations = _mapped_list(
        kwargs.pop("resources", []),
        "resources",
    )
    capabilities = _source_list(kwargs.pop("capabilities", []), "capabilities")
    permissions = _source_list(kwargs.pop("permissions", []), "permissions")
    icons = _source_list(kwargs.pop("icons", []), "icons")
    if not icons:
        fail("tauri_app: icons must declare at least one package-relative icon")
    sidecar_deps, sidecar_destinations = _mapped_list(
        kwargs.pop("sidecar_deps", []),
        "sidecar_deps",
        labels = True,
    )
    app_commands = _declared_identifiers(kwargs.pop("app_commands", []), "app_commands")
    app_windows = _declared_identifiers(kwargs.pop("app_windows", ["main"]), "app_windows", "-")
    if not app_windows:
        fail("tauri_app: app_windows must declare at least one window")
    attrs = {
        "tauri_root": root,
        "tauri_config": _rooted(root, config),
        "frontend_dist": frontend,
        "tauri_platform": legacy_platform,
        "tauri_target": tauri_target,
        "resources": [_rooted(root, value) for value in resource_sources],
        "resource_sources": resource_sources,
        "resource_destinations": resource_destinations,
        "capabilities": [_rooted(root, value) for value in capabilities],
        "permissions": [_rooted(root, value) for value in permissions],
        "icons": [_rooted(root, value) for value in icons],
        "sidecar_deps": sidecar_deps,
        "sidecar_destinations": sidecar_destinations,
        "app_commands": app_commands,
        "app_windows": app_windows,
    }
    attrs.update(prepare_mobile_source_attrs(kwargs, root))
    return attrs

def tauri_rule_attrs():
    return {
        "tauri_config": attrs.option(attrs.source(), default = None),
        "tauri_root": attrs.string(default = "."),
        "frontend_dist": attrs.option(attrs.dep(), default = None),
        "tauri_platform": attrs.string(default = ""),
        "tauri_target": attrs.dict(key = attrs.string(), value = attrs.string(), default = {}),
        "resources": attrs.list(attrs.source(), default = []),
        "resource_sources": attrs.list(attrs.string(), default = []),
        "resource_destinations": attrs.list(attrs.string(), default = []),
        "capabilities": attrs.list(attrs.source(), default = []),
        "permissions": attrs.list(attrs.source(), default = []),
        "icons": attrs.list(attrs.source(), default = []),
        "sidecar_deps": attrs.list(attrs.dep(), default = []),
        "sidecar_destinations": attrs.list(attrs.string(), default = []),
        "app_commands": attrs.list(attrs.string(), default = []),
        "app_windows": attrs.list(attrs.string(), default = []),
        "android_config": attrs.option(attrs.source(), default = None),
        "ios_config": attrs.option(attrs.source(), default = None),
        "android_project_srcs": attrs.list(attrs.source(), default = []),
        "ios_project_srcs": attrs.list(attrs.source(), default = []),
    }

def _dep_outputs(deps):
    outputs = []
    for dep in deps:
        outputs.extend(dep[DefaultInfo].default_outputs)
    return outputs

def tauri_action_inputs(ctx):
    if ctx.attrs.kind != "tauri":
        return []
    if ctx.attrs.tauri_config == None or ctx.attrs.frontend_dist == None:
        fail("tauri_app requires declared configuration and frontend inputs")
    mobile_configs = [value for value in [ctx.attrs.android_config, ctx.attrs.ios_config] if value != None]
    return [
        ctx.attrs.tauri_config,
    ] + ctx.attrs.resources + ctx.attrs.capabilities + ctx.attrs.permissions + ctx.attrs.icons + mobile_configs + ctx.attrs.android_project_srcs + ctx.attrs.ios_project_srcs + _dep_outputs(
        [ctx.attrs.frontend_dist] + ctx.attrs.sidecar_deps,
    )

__all__ = ["TAURI_PUBLIC_ARGS", "prepare_tauri_contract", "tauri_action_inputs", "tauri_rule_attrs"]

TAURI_PUBLIC_ARGS = [
    "android_config",
    "android_project_srcs",
    "app_commands",
    "app_windows",
    "capabilities",
    "frontend_dist",
    "icons",
    "ios_config",
    "ios_project_srcs",
    "permissions",
    "resources",
    "sidecar_deps",
    "tauri_artifact_kind",
    "tauri_bundle_identifier",
    "tauri_config",
    "tauri_deployment_eligibility",
    "tauri_package_name",
    "tauri_platform",
    "tauri_root",
    "tauri_signing_mode",
    "tauri_target_platform",
]
