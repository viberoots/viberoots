load("@prelude//:build_mode.bzl", "BuildModeInfo")
load("@prelude//decls:re_test_common.bzl", "re_test_common")
load("@prelude//tests:re_utils.bzl", "get_re_executors_from_props")

REMOTE_PROFILE_NAMES = [
    "linux-x86_64-default",
    "linux-x86_64-large",
    "linux-aarch64-default",
    "linux-aarch64-large",
    "darwin-aarch64-default",
]

REMOTE_PROFILE_ALLOWED_KEYS = {
    "capabilities": True,
    "dependencies": True,
    "listing_capabilities": True,
    "local_enabled": True,
    "local_listing_enabled": True,
    "remote_cache_enabled": True,
    "remote_execution_dynamic_image": True,
    "resource_units": True,
    "use_case": True,
}

def remote_worker_capabilities(os: str, cpu: str, size: str) -> dict[str, str]:
    return {
        "arch": cpu,
        "os": os,
        "resource_class": size,
        "viberoots_remote_profile": "{}-{}-{}".format(os, cpu, size),
    }

def _profile(os: str, cpu: str, size: str, resource_units: int) -> dict:
    capabilities = remote_worker_capabilities(os, cpu, size)
    return {
        "capabilities": capabilities,
        "dependencies": [],
        "listing_capabilities": capabilities,
        "local_enabled": False,
        "local_listing_enabled": False,
        "remote_cache_enabled": True,
        "resource_units": resource_units,
        "use_case": "buck2-test",
    }

REMOTE_EXECUTION_PROFILES = {
    "darwin-aarch64-default": _profile("darwin", "aarch64", "default", 1),
    "linux-aarch64-default": _profile("linux", "aarch64", "default", 1),
    "linux-aarch64-large": _profile("linux", "aarch64", "large", 4),
    "linux-x86_64-default": _profile("linux", "x86_64", "default", 1),
    "linux-x86_64-large": _profile("linux", "x86_64", "large", 4),
}

def validate_remote_execution_profile(name: str, profile: dict) -> None:
    if "capabilities" not in profile:
        fail("remote execution profile {} is missing capabilities".format(name))
    if "use_case" not in profile:
        fail("remote execution profile {} is missing use_case".format(name))
    for key in profile.keys():
        if key not in REMOTE_PROFILE_ALLOWED_KEYS:
            fail("remote execution profile {} has unsupported key {}".format(name, key))

def remote_execution_profiles() -> dict[str, dict]:
    profiles = {}
    for name in REMOTE_PROFILE_NAMES:
        profile = REMOTE_EXECUTION_PROFILES[name]
        validate_remote_execution_profile(name, profile)
        profiles[name] = profile
    return profiles

def _profile_conversion_probe_impl(ctx: AnalysisContext) -> list[Provider]:
    executor, overrides = get_re_executors_from_props(ctx)
    if executor == None:
        fail("remote profile conversion probe did not produce an executor")
    if "listing" not in overrides:
        fail("remote profile conversion probe did not produce a listing executor")
    return [DefaultInfo()]

remote_profile_conversion_probe = rule(
    impl = _profile_conversion_probe_impl,
    attrs = re_test_common.test_args(),
)

def _profile_conversion_action_key_impl(_ctx: AnalysisContext) -> list[Provider]:
    return [
        DefaultInfo(),
        BuildModeInfo(cell = "viberoots", mode = "remote-profile-probe"),
    ]

remote_profile_conversion_action_key = rule(
    impl = _profile_conversion_action_key_impl,
    attrs = {},
)

def remote_profile_conversion_probe_targets() -> None:
    remote_profile_conversion_action_key(
        name = "remote_profile_conversion_action_key",
        visibility = ["PUBLIC"],
    )
    for profile in REMOTE_PROFILE_NAMES:
        remote_profile_conversion_probe(
            name = "remote_profile_conversion_" + profile.replace("-", "_"),
            remote_execution = profile,
            remote_execution_action_key_providers = ":remote_profile_conversion_action_key",
            visibility = ["PUBLIC"],
        )
