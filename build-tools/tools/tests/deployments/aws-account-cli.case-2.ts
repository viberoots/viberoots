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

test("aws-account check can prompt to initialize stack config and continue", async () => {
  await runInTemp("aws-account-check-prompt-init", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    await withCwd(tmp, async () => {
      const out: string[] = [];
      const prompts: string[] = [];
      const answers = ["yes", "example.com"];
      const previousExitCode = process.exitCode;
      process.exitCode = undefined;
      try {
        await withControlPlaneArgv(
          [
            "aws-account",
            "check",
            "--expected-aws-account-id",
            "123456789012",
            "--aws-organization-id",
            "o-example",
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
              question: async (prompt) => {
                prompts.push(prompt);
                return answers.shift() || "";
              },
              toolResolver: (tool) => `/nix/store/fake-${tool}/bin/${tool}`,
              commandRunner: async () => ({
                stdout: JSON.stringify({ Account: "123456789012" }),
                stderr: "",
              }),
            }),
        );
      } finally {
        process.exitCode = previousExitCode;
      }
      const configPath = path.join(tmp, "config", "control-plane", "stack.json");
      const config = JSON.parse(await fsp.readFile(configPath, "utf8")) as Record<string, unknown>;
      assert.match(prompts[0] || "", /Generate config\/control-plane\/stack\.json now/);
      assert.match(prompts[1] || "", /Domain/);
      assert.equal(config.domain, "example.com");
      assert.equal(Object.hasOwn(config, "serviceHost"), false);
      await withControlPlaneArgv([], async () => {
        const runtimeConfig = await readAwsAccountConfig(tmp);
        assert.equal(runtimeConfig.serviceHost, "deploy.control.example.com");
      });
      assert.ok(out.join("\n").includes("Continuing with config/control-plane/stack.json"));
      assert.equal(out.join("\n").includes("Next:\n  Edit config/control-plane/stack.json"), false);
      assert.ok(out.join("\n").includes("  PASS    check-supabase"));
      assert.ok(
        await exists(
          path.join(tmp, "buck-out", "aws-account", "control-example.com", "status.json"),
        ),
      );
    });
  });
});

test("aws-account check prints config-init guidance without an interactive prompt", async () => {
  await runInTemp("aws-account-check-noninteractive-guidance", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    const out: string[] = [];
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    const oldStdin = process.stdin;
    const oldStdout = process.stdout;
    try {
      Object.defineProperty(process, "stdin", {
        value: { isTTY: false },
        configurable: true,
      });
      Object.defineProperty(process, "stdout", {
        value: { isTTY: false },
        configurable: true,
      });
      await withControlPlaneArgv(["aws-account", "check"], () =>
        runAwsAccountCommand({ cwd: tmp, stdout: (text) => out.push(text) }),
      );
      assert.equal(process.exitCode, 2);
    } finally {
      Object.defineProperty(process, "stdin", { value: oldStdin, configurable: true });
      Object.defineProperty(process, "stdout", { value: oldStdout, configurable: true });
      process.exitCode = previousExitCode;
    }
    assert.ok(out[0]?.includes("AWS account stack config is not initialized."));
    assert.ok(out[0]?.includes("control-plane aws-account config-init"));
    assert.ok(out[0]?.includes("config/control-plane/stack.json"));
  });
});

test("aws-account check prompt fills domain in an existing stack config", async () => {
  await runInTemp("aws-account-check-prompt-existing-config", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    await withCwd(tmp, async () => {
      await withControlPlaneArgv(
        [
          "aws-account",
          "config-init",
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
      const prompts: string[] = [];
      await withControlPlaneArgv(["aws-account", "check"], () =>
        runAwsAccountCommand({
          cwd: tmp,
          now: () => NOW,
          env: { SUPABASE_ACCESS_TOKEN: "test-token" },
          httpFetch: fakeSupabaseFetch,
          stdout: (text) => out.push(text),
          question: async (prompt) => {
            prompts.push(prompt);
            return prompts.length === 1 ? "y" : "example.com";
          },
          toolResolver: (tool) => `/nix/store/fake-${tool}/bin/${tool}`,
          commandRunner: async () => ({
            stdout: JSON.stringify({ Account: "123456789012" }),
            stderr: "",
          }),
        }),
      );
      const configPath = path.join(tmp, "config", "control-plane", "stack.json");
      const config = JSON.parse(await fsp.readFile(configPath, "utf8")) as Record<string, unknown>;
      assert.equal(config.domain, "example.com");
      assert.equal(config.awsAccountId, "123456789012");
      assert.equal(config.supabaseOrgId, "supabase-org");
      assert.ok(out.join("\n").includes("AWS account stack config updated"));
      assert.ok(out.join("\n").includes("  PASS    check-supabase"));
    });
  });
});

test("aws-account check loads canonical stack config without --config", async () => {
  await runInTemp("aws-account-canonical-config", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    await withCwd(tmp, async () => {
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
          now: () => NOW,
          env: { SUPABASE_ACCESS_TOKEN: "test-token" },
          httpFetch: fakeSupabaseFetch,
          stdout: (text) => out.push(text),
          toolResolver: (tool) => `/nix/store/fake-${tool}/bin/${tool}`,
          commandRunner: async () => ({
            stdout: JSON.stringify({ Account: "123456789012" }),
            stderr: "",
          }),
        }),
      );
      assert.ok(out[0]?.includes("AWS Account Check"));
      assert.ok(out[0]?.includes("Domain:   example.com"));
      assert.ok(
        await exists(
          path.join(tmp, "buck-out", "aws-account", "control-example.com", "status.json"),
        ),
      );
    });
  });
});

test("aws-account config-init with domain skips stale fill-domain guidance", async () => {
  await runInTemp("aws-account-config-init-domain-guidance", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    await withCwd(tmp, async () => {
      const out: string[] = [];
      await withControlPlaneArgv(
        ["aws-account", "config-init", "--domain", "deploy.example.com"],
        () => runAwsAccountCommand({ cwd: tmp, stdout: (text) => out.push(text) }),
      );
      const text = out.join("\n");
      assert.match(text, /AWS account stack config written/);
      assert.match(text, /sprinkleref --init-local/);
      assert.match(text, /control-plane aws-account check/);
      assert.doesNotMatch(text, /fill "domain"/);
      const config = JSON.parse(
        await fsp.readFile(path.join(tmp, "config/control-plane/stack.json"), "utf8"),
      );
      assert.equal(config.domain, "deploy.example.com");
    });
  });
});
