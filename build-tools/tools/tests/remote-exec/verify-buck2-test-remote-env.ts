export const VERIFY_BUCK2_TEST_REMOTE_ENV = {
  VBR_REMOTE_ARTIFACT_DIR: "/tmp/vbr-remote/artifacts",
  VBR_REMOTE_BUCK_CONFIG: "/tmp/vbr-remote/buckconfig",
  VBR_REMOTE_EXEC_SYSTEM: "x86_64-linux",
  VBR_REMOTE_CI_TOOLS: "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-remote-ci-tools",
  VBR_REMOTE_BUILDER_TRANSPORT: "/tmp/remote-builder-transport.json",
  VBR_REMOTE_PROBE_FLAKE: "/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-probe-flake",
  VBR_REMOTE_BUILDER_IDENTITY: "builder",
  VBR_REMOTE_REVIEWED_BUILDERS:
    "/nix/store/cccccccccccccccccccccccccccccccc-reviewed-builders/registry.json",
} as const;
