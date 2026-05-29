#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateRemoteExecTargets } from "../../dev/remote-exec-policy-check";

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
      lockCapabilities: ["external-mutating"],
      targets: [
        {
          target: "//pkg:t",
          ruleFamily: "go_nix_test",
          labels: ["remote:ready", "remote:external-mutating-locked"],
          runFromProjectRoot: true,
          useProjectRelativePaths: true,
          commandInputsDeclared: true,
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
      allowedProfiles: ["linux-x86_64-large"],
      targets: [
        {
          target: "//pkg:t",
          ruleFamily: "go_nix_test",
          labels: ["remote:ready", "verify:resource-limited"],
          runFromProjectRoot: true,
          useProjectRelativePaths: true,
          commandInputsDeclared: true,
        },
      ],
    }),
    [],
  );
});
