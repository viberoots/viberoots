import {
  AWS_ACCOUNT_STACK_CONFIG_FIELDS_WITHOUT_DEFAULTS,
  NOW,
  assert,
  fakeSupabaseFetch,
  exists,
  fsp,
  path,
  readAwsAccountConfig,
  removeCanonicalStackConfig,
  runAwsAccountCommand,
  runInTemp,
  selectedControlPlaneCommand,
  test,
  withControlPlaneArgv,
  withCwd,
} from "./aws-account-cli.helpers";

test("aws-account check canonical config guidance points back to stack.json", async () => {
  await runInTemp("aws-account-canonical-config-blocked-guidance", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    await withCwd(tmp, async () => {
      await withControlPlaneArgv(["aws-account", "config-init", "--domain", "example.com"], () =>
        runAwsAccountCommand({ cwd: tmp, stdout: () => undefined }),
      );
      await fsp.mkdir(path.join(tmp, "projects/config"), { recursive: true });
      await fsp.writeFile(
        path.join(tmp, "projects/config/shared.json"),
        JSON.stringify(
          {
            schemaVersion: "viberoots-project-config@1",
            activeRuntimeHost: "local-file",
            sprinkleref: {
              version: 1,
              defaultCategory: "control",
              categories: {
                control: { backend: "local-file", file: ".local/missing-control.json" },
              },
            },
          },
          null,
          2,
        ),
      );
      await fsp.writeFile(
        path.join(tmp, "projects/config/local.json"),
        JSON.stringify(
          {
            schemaVersion: "viberoots-project-local-config@1",
            activeRuntimeHost: "local-macos",
          },
          null,
          2,
        ),
      );
      const out: string[] = [];
      const previousExitCode = process.exitCode;
      process.exitCode = undefined;
      try {
        await withControlPlaneArgv(["aws-account", "check"], () =>
          runAwsAccountCommand({
            cwd: tmp,
            now: () => NOW,
            env: {},
            stdout: (text) => out.push(text),
            toolResolver: (tool) => `/nix/store/fake-${tool}/bin/${tool}`,
          }),
        );
      } finally {
        process.exitCode = previousExitCode;
      }
      assert.ok(out[0]?.includes("Missing Values"));
      assert.ok(out[0]?.includes("Shared project config:"));
      assert.equal(out[0]?.includes("selected SprinkleRef default/category chain"), false);
      assert.ok(out[0]?.includes("ref: config://control-plane/aws/account-id"));
      assert.ok(out[0]?.includes("category: control"));
      assert.ok(out[0]?.includes("action: add the shared value or ref to project config"));
      assert.ok(out[0]?.includes("ref: config://control-plane/supabase/org-id"));
      assert.ok(out[0]?.includes("ref: config://control-plane/supabase/project-ref"));
      assert.equal(out[0]?.includes("Bootstrap category:"), false);
      assert.ok(out[0]?.includes("ref: secret://control-plane/supabase/management-api-token"));
      assert.ok(out[0]?.includes("Active local overrides"));
      assert.ok(out[0]?.includes("activeRuntimeHost: shared=local-file local=local-macos"));
      assert.ok(out[0]?.includes("projects/config/shared.json"));
      assert.ok(out[0]?.includes("projects/config/local.json"));
      assert.equal(out[0]?.includes("passed with --config"), false);
      assert.ok(out[0]?.includes("Waiting on missing values listed above."));
      assert.ok(
        out[0]?.includes("Fix the problems above, then rerun:\n  control-plane aws-account check"),
      );
      assert.ok(
        out[0]?.includes("control-plane aws-account check --json"),
        "automation command should use canonical config by default",
      );
      const status = JSON.parse(
        await fsp.readFile(
          path.join(tmp, "buck-out/aws-account/control-example.com/status.json"),
          "utf8",
        ),
      );
      assert.deepEqual(status.localOverrides, [
        { path: "activeRuntimeHost", sharedValue: "local-file", localValue: "local-macos" },
      ]);
      const oldGuard = process.env.VBR_DISALLOW_LOCAL_OVERRIDES;
      process.env.VBR_DISALLOW_LOCAL_OVERRIDES = "1";
      try {
        await assert.rejects(
          withControlPlaneArgv(["aws-account", "check"], () =>
            runAwsAccountCommand({ cwd: tmp, stdout: () => undefined }),
          ),
          /local project config overrides are disabled: activeRuntimeHost/,
        );
      } finally {
        if (oldGuard === undefined) delete process.env.VBR_DISALLOW_LOCAL_OVERRIDES;
        else process.env.VBR_DISALLOW_LOCAL_OVERRIDES = oldGuard;
      }
    });
  });
});

test("aws-account check writes status and evidence without cloud mutation", async () => {
  await runInTemp("aws-account-check", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    const out: string[] = [];
    const evidenceDir = path.join(tmp, "evidence");
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await withControlPlaneArgv(
        [
          "aws-account",
          "check",
          "--domain",
          "example.com",
          "--evidence-dir",
          evidenceDir,
          "--expected-aws-account-id",
          "123456789012",
          "--aws-organization-id",
          "o-example",
          "--expected-aws-role-arn",
          "arn:aws:sts::123456789012:assumed-role/bootstrap/operator",
          "--supabase-org-id",
          "supabase-org",
          "--supabase-project-ref",
          "project-ref",
        ],
        () =>
          runAwsAccountCommand({
            cwd: tmp,
            now: () => NOW,
            env: { SUPABASE_ACCESS_TOKEN: "test-token" },
            httpFetch: fakeSupabaseFetch,
            stdout: (text) => out.push(text),
            toolResolver: (tool) => `/nix/store/fake-${tool}/bin/${tool}`,
            commandRunner: async () => ({
              stdout: JSON.stringify({
                Account: "123456789012",
                Arn: "arn:aws:sts::123456789012:assumed-role/bootstrap/operator",
              }),
              stderr: "",
            }),
          }),
      );
    } finally {
      process.exitCode = previousExitCode;
    }
    const status = JSON.parse(await fsp.readFile(path.join(evidenceDir, "status.json"), "utf8"));
    assert.equal(status.phases["check-tools"].state, "passed");
    assert.equal(status.phases["check-aws-login"].state, "passed");
    assert.equal(status.phases["check-supabase"].state, "passed");
    assert.equal(status.nextPhase, "bootstrap-state");
    assert.ok(await exists(path.join(evidenceDir, "check-tools", "tools.json")));
    assert.ok(out[0]?.includes("AWS Account Check"));
    assert.ok(out[0]?.includes("Stack:    control"));
    assert.ok(out[0]?.includes("  PASS    check-tools"));
    assert.ok(out[0]?.includes("Next\n  All prerequisite checks passed."));
    assert.ok(
      out[0]?.includes(`control-plane aws-account bootstrap --evidence-dir ${evidenceDir}`),
    );
    const statusOut: string[] = [];
    await withControlPlaneArgv(["aws-account", "status", "--evidence-dir", evidenceDir], () =>
      runAwsAccountCommand({ cwd: tmp, stdout: (text) => statusOut.push(text) }),
    );
    assert.ok(statusOut[0]?.includes('"nextPhase": "bootstrap-state"'));
  });
});
