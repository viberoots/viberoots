load("@prelude//:build_mode.bzl", "BuildModeInfo")

def _remote_profile_conversion_action_key_impl(_ctx: AnalysisContext) -> list[Provider]:
    return [
        DefaultInfo(),
        BuildModeInfo(cell = "viberoots", mode = "remote-profile-probe"),
    ]

remote_profile_conversion_action_key = rule(
    impl = _remote_profile_conversion_action_key_impl,
    attrs = {},
)
