load(":remote_execution_profiles.bzl", "remote_worker_capabilities")

def _configuration(ctx: AnalysisContext) -> ConfigurationInfo:
    constraints = {}
    constraints.update(ctx.attrs.cpu_configuration[ConfigurationInfo].constraints)
    constraints.update(ctx.attrs.os_configuration[ConfigurationInfo].constraints)
    return ConfigurationInfo(constraints = constraints, values = {})

def _remote_execution_platform_impl(ctx: AnalysisContext) -> list[Provider]:
    configuration = _configuration(ctx)
    platform = ExecutionPlatformInfo(
        configuration = configuration,
        executor_config = CommandExecutorConfig(
            local_enabled = ctx.attrs.local_enabled,
            remote_enabled = ctx.attrs.remote_enabled,
            remote_execution_properties = ctx.attrs.remote_execution_properties,
            remote_execution_use_case = ctx.attrs.remote_execution_use_case,
            use_limited_hybrid = ctx.attrs.use_limited_hybrid,
        ),
        label = ctx.label.raw_target(),
    )
    return [
        DefaultInfo(),
        PlatformInfo(label = str(ctx.label.raw_target()), configuration = configuration),
        platform,
    ]

remote_execution_platform = rule(
    impl = _remote_execution_platform_impl,
    attrs = {
        "cpu_configuration": attrs.dep(providers = [ConfigurationInfo]),
        "local_enabled": attrs.bool(),
        "os_configuration": attrs.dep(providers = [ConfigurationInfo]),
        "remote_enabled": attrs.bool(),
        "remote_execution_properties": attrs.dict(key = attrs.string(), value = attrs.string()),
        "remote_execution_use_case": attrs.string(),
        "use_limited_hybrid": attrs.bool(),
    },
)

def _remote_execution_platforms_impl(ctx: AnalysisContext) -> list[Provider]:
    return [
        DefaultInfo(),
        ExecutionPlatformRegistrationInfo(
            platforms = [platform[ExecutionPlatformInfo] for platform in ctx.attrs.platforms],
        ),
    ]

remote_execution_platforms = rule(
    impl = _remote_execution_platforms_impl,
    attrs = {
        "platforms": attrs.list(attrs.dep(providers = [ExecutionPlatformInfo])),
    },
)

def _remote_platform(name: str, os: str, cpu: str, size: str, local_enabled: bool, remote_enabled: bool, use_limited_hybrid: bool) -> None:
    remote_execution_platform(
        name = name,
        cpu_configuration = "prelude//cpu:{}".format("arm64" if cpu == "aarch64" else cpu),
        local_enabled = local_enabled,
        os_configuration = "prelude//os:{}".format("macos" if os == "darwin" else os),
        remote_enabled = remote_enabled,
        remote_execution_properties = remote_worker_capabilities(os, cpu, size),
        remote_execution_use_case = "buck2-build",
        use_limited_hybrid = use_limited_hybrid,
    )

def remote_execution_platform_targets() -> None:
    _remote_platform("remote_linux_x86_64_default", "linux", "x86_64", "default", False, True, False)
    _remote_platform("remote_linux_x86_64_hybrid_default", "linux", "x86_64", "default", True, True, True)
    _remote_platform("remote_linux_x86_64_large", "linux", "x86_64", "large", False, True, False)
    _remote_platform("remote_linux_aarch64_default", "linux", "aarch64", "default", False, True, False)
    _remote_platform("remote_linux_aarch64_large", "linux", "aarch64", "large", False, True, False)
    _remote_platform("remote_darwin_aarch64_default", "darwin", "aarch64", "default", False, True, False)
    _remote_platform("remote_local_fallback", "linux", "x86_64", "local-fallback", True, False, False)
    remote_execution_platforms(
        name = "remote_execution_platforms",
        platforms = [
            ":remote_linux_x86_64_default",
            ":remote_linux_x86_64_hybrid_default",
            ":remote_linux_x86_64_large",
            ":remote_linux_aarch64_default",
            ":remote_linux_aarch64_large",
            ":remote_darwin_aarch64_default",
            ":remote_local_fallback",
        ],
        visibility = ["PUBLIC"],
    )
