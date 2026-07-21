#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateRemoteExecTargets } from "../../dev/remote-exec-policy-check";
import { remoteBuilderSmokeEvidence } from "./remote-builder-smoke-test-fixture";

function messages(...labels: string[]): string {
  return validateRemoteExecTargets({
    mode: "remote",
    targets: [{ target: "//pkg:t", labels }],
  })
    .map((f) => f.message)
    .join("\n");
}

test("remote policy rejects local-only targets in remote mode", () => {
  assert.match(messages("remote:local-only"), /cannot be selected in remote mode/);
});

test("remote policy rejects unlabeled targets in remote mode", () => {
  assert.match(messages(), /requires explicit remote:ready/);
});

test("remote policy keeps deployment and external-mutating targets constrained", () => {
  assert.match(messages("remote:ready", "domain:deployment"), /deployment-domain/);
  assert.match(
    messages("remote:ready", "remote:external-mutating-locked"),
    /external-mutating lock/,
  );
  assert.deepEqual(
    validateRemoteExecTargets({
      mode: "remote",
      testOnlyRemoteBuilderSmokeEvidence: remoteBuilderSmokeEvidence,
      lockCapabilities: ["external-mutating"],
      targets: [
        {
          target: "//pkg:t",
          ruleFamily: "go_nix_test",
          labels: ["remote:ready", "remote:external-mutating-locked"],
          runFromProjectRoot: true,
          useProjectRelativePaths: true,
          commandInputsDeclared: true,
          nixBuilderPolicy: "inherit_config",
          remoteBuilderSmokePolicy: "inherit_config",
          remoteBuilderSmokeEvidence,
        },
      ],
    }),
    [],
  );
});

test("remote-ready external-runner metadata must be complete", () => {
  const findings = validateRemoteExecTargets({
    mode: "remote",
    targets: [
      {
        target: "//pkg:t",
        ruleFamily: "go_nix_test",
        labels: ["remote:ready", "verify:resource-limited"],
        runFromProjectRoot: false,
        useProjectRelativePaths: true,
        localResources: ["docker"],
        requiredLocalResources: ["socket"],
        networkAccess: true,
        commandInputsDeclared: false,
        requiresWorkspaceRootLookup: true,
        ambientPathDependency: true,
      },
    ],
  });
  const text = findings.map((f) => f.message).join("\n");
  assert.match(text, /project-relative/);
  assert.match(text, /compatible remote profile/);
  assert.match(text, /local resources/);
  assert.match(text, /network access/);
  assert.match(text, /command inputs/);
  assert.match(text, /WORKSPACE_ROOT/);
  assert.match(text, /ambient PATH/);
});

test("remote-ready labels are limited to reviewed wrapper families", () => {
  assert.match(
    validateRemoteExecTargets({
      mode: "remote",
      targets: [
        {
          target: "//pkg:t",
          ruleFamily: "genrule",
          labels: ["remote:ready"],
          runFromProjectRoot: true,
          useProjectRelativePaths: true,
          commandInputsDeclared: true,
        },
      ],
    })
      .map((f) => f.message)
      .join("\n"),
    /not allowed on genrule/,
  );
});

test("resource labels pass when a compatible profile is selected", () => {
  assert.deepEqual(
    validateRemoteExecTargets({
      mode: "remote",
      testOnlyRemoteBuilderSmokeEvidence: remoteBuilderSmokeEvidence,
      allowedProfiles: ["linux-x86_64-large"],
      targets: [
        {
          target: "//pkg:t",
          ruleFamily: "go_nix_test",
          labels: ["remote:ready", "verify:resource-limited"],
          runFromProjectRoot: true,
          useProjectRelativePaths: true,
          commandInputsDeclared: true,
          nixBuilderPolicy: "inherit_config",
          remoteBuilderSmokePolicy: "inherit_config",
          remoteBuilderSmokeEvidence,
        },
      ],
    }),
    [],
  );
});

test("remote-ready Nix builder policy requires compatible builder evidence", () => {
  const base = {
    target: "//pkg:t",
    ruleFamily: "go_nix_test",
    labels: ["remote:ready"],
    runFromProjectRoot: true,
    useProjectRelativePaths: true,
    commandInputsDeclared: true,
  };
  assert.match(
    validateRemoteExecTargets({
      mode: "remote",
      targets: [{ ...base, nixBuilderPolicy: "local_only" }],
    })
      .map((f) => f.message)
      .join("\n"),
    /cannot disable Nix builders/,
  );
  assert.match(
    validateRemoteExecTargets({
      mode: "remote",
      targets: [{ ...base }],
    })
      .map((f) => f.message)
      .join("\n"),
    /typed Nix builder policy evidence/,
  );
  assert.match(
    validateRemoteExecTargets({
      mode: "remote",
      targets: [{ ...base, nixBuilderPolicy: true }],
    })
      .map((f) => f.message)
      .join("\n"),
    /typed Nix builder policy evidence/,
  );
  assert.match(
    validateRemoteExecTargets({
      mode: "remote",
      targets: [{ ...base, nixBuilderPolicy: "bogus" }],
    })
      .map((f) => f.message)
      .join("\n"),
    /typed Nix builder policy evidence/,
  );
  assert.match(
    validateRemoteExecTargets({
      mode: "remote",
      targets: [{ ...base, nixBuilderPolicy: "inherit_config" }],
    })
      .map((f) => f.message)
      .join("\n"),
    /requires matching remote-builder smoke/,
  );
  assert.match(
    validateRemoteExecTargets({
      mode: "remote",
      testOnlyRemoteBuilderSmokeEvidence: remoteBuilderSmokeEvidence,
      targets: [
        {
          ...base,
          nixBuilderPolicy: "inherit_config",
          remoteBuilderSmokePolicy: "force_builders_file",
        },
      ],
    })
      .map((f) => f.message)
      .join("\n"),
    /requires matching remote-builder smoke/,
  );
  assert.deepEqual(
    validateRemoteExecTargets({
      mode: "remote",
      testOnlyRemoteBuilderSmokeEvidence: remoteBuilderSmokeEvidence,
      targets: [
        {
          ...base,
          nixBuilderPolicy: "inherit_config",
          remoteBuilderSmokePolicy: "inherit_config",
          remoteBuilderSmokeEvidence,
        },
      ],
    }),
    [],
  );
  assert.match(
    validateRemoteExecTargets({
      mode: "remote",
      remoteSystem: "aarch64-linux",
      testOnlyRemoteBuilderSmokeEvidence: remoteBuilderSmokeEvidence,
      targets: [
        {
          ...base,
          nixBuilderPolicy: "inherit_config",
          remoteBuilderSmokePolicy: "inherit_config",
        },
      ],
    })
      .map((f) => f.message)
      .join("\n"),
    /does not match active execution system/,
  );
  assert.match(
    validateRemoteExecTargets({
      mode: "remote",
      targets: [
        {
          ...base,
          nixBuilderPolicy: "inherit_config",
          remoteBuilderSmokePolicy: "yes",
        },
      ],
    })
      .map((f) => f.message)
      .join("\n"),
    /typed remote-builder smoke evidence/,
  );
});
