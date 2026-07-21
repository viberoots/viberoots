import type { VerifyExecutionPolicy } from "../../dev/verify/remote-policy";

export const REMOTE_TARGET_TEST_POLICY: VerifyExecutionPolicy = {
  mode: "remote",
  buckConfig: "/tmp/remote.buckconfig",
  system: "x86_64-linux",
  artifactDir: "/tmp/artifacts",
  activationDir: "/tmp/activation",
  profilePrefix: "linux-x86_64",
  passProfiles: {},
  remoteSmoke: null,
};
