import {
  AWS_ACCOUNT_STACK_CONFIG_FIELDS_WITHOUT_DEFAULTS,
  NOW,
  assert,
  exists,
  fakeSupabaseFetch,
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
      assert.ok(out[0]?.includes("Local values or shared resolver refs:"));
      assert.equal(out[0]?.includes("selected SprinkleRef default/category chain"), false);
      assert.ok(out[0]?.includes("ref: config://control-plane/aws/account-id"));
      assert.ok(out[0]?.includes("category: control"));
      assert.ok(out[0]?.includes("action: fill local values or write the ref in SprinkleRef"));
      assert.ok(out[0]?.includes("ref: config://control-plane/supabase/org-id"));
      assert.ok(out[0]?.includes("ref: config://control-plane/supabase/project-ref"));
      assert.equal(out[0]?.includes("Bootstrap category:"), false);
      assert.ok(out[0]?.includes("ref: secret://control-plane/supabase/management-api-token"));
      assert.ok(out[0]?.includes("config/sprinkleref/local/values.json"));
      assert.equal(out[0]?.includes("passed with --config"), false);
      assert.ok(out[0]?.includes("Waiting on missing values listed above."));
      assert.ok(
        out[0]?.includes("Fix the problems above, then rerun:\n  control-plane aws-account check"),
      );
      assert.ok(
        out[0]?.includes("control-plane aws-account check --json"),
        "automation command should use canonical config by default",
      );
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

test("aws-account check resolves Supabase token from SprinkleRef ref", async () => {
  await runInTemp("aws-account-supabase-sprinkleref", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    await withCwd(tmp, async () => {
      const secretRef = "secret://control-plane/supabase/management-api-token";
      await fsp.mkdir(path.join(tmp, "config/sprinkleref"), { recursive: true });
      await fsp.mkdir(path.join(tmp, ".local"), { recursive: true });
      await fsp.writeFile(
        path.join(tmp, "config/sprinkleref", "selected.json"),
        JSON.stringify(
          {
            version: 1,
            defaultCategory: "control",
            categories: {
              main: { backend: "local-file", file: ".local/main-secrets.json" },
              control: { backend: "local-file", file: ".local/secrets.json" },
            },
          },
          null,
          2,
        ),
      );
      await fsp.writeFile(
        path.join(tmp, ".local", "secrets.json"),
        JSON.stringify({ [secretRef]: "test-token" }, null, 2),
      );
      await withControlPlaneArgv(
        [
          "aws-account",
          "config-init",
          "--domain",
          "example.com",
          "--expected-aws-account-id",
          "123456789012",
          "--aws-organization-id",
          "o-example",
          "--supabase-org-id",
          "supabase-org",
          "--supabase-project-ref",
          "project-ref",
        ],
        () => runAwsAccountCommand({ cwd: tmp, stdout: () => undefined }),
      );
      const out: string[] = [];
      await withControlPlaneArgv(["aws-account", "check"], () =>
        runAwsAccountCommand({
          cwd: tmp,
          now: () => NOW,
          env: {},
          httpFetch: fakeSupabaseFetch,
          stdout: (text) => out.push(text),
          toolResolver: (tool) => `/nix/store/fake-${tool}/bin/${tool}`,
          commandRunner: async () => ({
            stdout: JSON.stringify({ Account: "123456789012" }),
            stderr: "",
          }),
        }),
      );
      assert.ok(out[0]?.includes("  PASS    check-supabase"));
      const evidence = JSON.parse(
        await fsp.readFile(
          path.join(
            tmp,
            "buck-out",
            "aws-account",
            "control-example.com",
            "check-supabase",
            "supabase-readiness.json",
          ),
          "utf8",
        ),
      );
      assert.equal(evidence.supabaseAccessToken.source, "sprinkleref");
      assert.equal(evidence.supabaseAccessToken.ref, secretRef);
      assert.equal(evidence.supabaseAccessToken.category, "control");
      assert.equal(evidence.supabaseAccessToken.secretValuePrinted, false);
      assert.doesNotMatch(JSON.stringify(evidence), /test-token/);
    });
  });
});
