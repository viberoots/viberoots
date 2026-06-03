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

test("aws-account bootstrap applies remote state only with explicit apply", async () => {
  await runInTemp("aws-account-bootstrap-apply", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    const out: string[] = [];
    const calls: Array<{ file: string; args: string[]; cwd?: string }> = [];
    const evidenceDir = path.join(tmp, "evidence");
    await withControlPlaneArgv(
      [
        "aws-account",
        "bootstrap",
        "--domain",
        "example.com",
        "--evidence-dir",
        evidenceDir,
        "--expected-aws-account-id",
        "123456789012",
        "--aws-organization-id",
        "o-example",
        "--supabase-org-id",
        "supabase-org",
        "--supabase-project-ref",
        "project-ref",
        "--apply",
      ],
      () =>
        runAwsAccountCommand({
          cwd: tmp,
          now: () => NOW,
          env: { SUPABASE_ACCESS_TOKEN: "test-token" },
          httpFetch: fakeSupabaseFetch,
          stdout: (text) => out.push(text),
          toolResolver: (tool) => `/nix/store/fake-${tool}/bin/${tool}`,
          commandRunner: async (file, args, options) => {
            calls.push({ file, args, cwd: options?.cwd });
            if (file === "aws") {
              return {
                stdout: JSON.stringify({ Account: "123456789012" }),
                stderr: "",
              };
            }
            if (file === "tofu" && args[0] === "output") {
              return {
                stdout: JSON.stringify({
                  schemaVersion: "aws-control-plane-state-bootstrap@1",
                  stateBucketName: "deployment-control-plane-control-example-com-tofu-state",
                  stateLockTableName: "deployment-control-plane-control-example-com-tofu-locks",
                }),
                stderr: "",
              };
            }
            return {
              stdout: `${file} ${args.join(" ")}`,
              stderr: "",
            };
          },
        }),
    );
    const payload = JSON.parse(out[0] || "{}");
    assert.equal(payload.phases["bootstrap-state"].state, "passed");
    assert.equal(payload.nextPhase, "plan-foundation");
    assert.deepEqual(
      calls.filter((call) => call.file === "tofu").map((call) => call.args[0]),
      ["init", "plan", "apply", "output"],
    );
    assert.ok(
      await exists(path.join(evidenceDir, "bootstrap-state", "state-bootstrap-evidence.json")),
    );
    const evidence = JSON.parse(
      await fsp.readFile(
        path.join(evidenceDir, "bootstrap-state", "state-bootstrap-evidence.json"),
        "utf8",
      ),
    );
    assert.equal(
      evidence.backendHcl.bucket,
      "deployment-control-plane-control-example-com-tofu-state",
    );
  });
});

test("aws-account bootstrap does not plan state when login is blocked", async () => {
  await runInTemp("aws-account-bootstrap-blocked", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    const out: string[] = [];
    const calls: Array<{ file: string; args: string[] }> = [];
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await withControlPlaneArgv(
        [
          "aws-account",
          "bootstrap",
          "--domain",
          "example.com",
          "--evidence-dir",
          path.join(tmp, "evidence"),
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
            commandRunner: async (file, args) => {
              calls.push({ file, args });
              return {
                stdout: JSON.stringify({ Account: "123456789012" }),
                stderr: "",
              };
            },
          }),
      );
    } finally {
      process.exitCode = previousExitCode;
    }
    const payload = JSON.parse(out[0] || "{}");
    assert.equal(payload.phases["check-aws-login"].state, "blocked");
    assert.equal(payload.phases["bootstrap-state"].state, "blocked");
    assert.equal(
      calls.some((call) => call.file === "tofu"),
      false,
    );
  });
});

test("aws-account Supabase check fails closed on API mismatches", async () => {
  await runInTemp("aws-account-supabase-mismatch", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    const out: string[] = [];
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
          path.join(tmp, "evidence"),
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
            httpFetch: async (url, init) =>
              fakeSupabaseFetch(url.replace("project-ref", "wrong-ref"), init),
            stdout: (text) => out.push(text),
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
    assert.ok(out[0]?.includes("  FAILED  check-supabase"));
    assert.ok(out[0]?.includes("Problems\n  check-supabase"));
    assert.ok(out[0]?.includes("Fix the problems above, then rerun:"));
    const status = JSON.parse(
      await fsp.readFile(path.join(tmp, "evidence", "status.json"), "utf8"),
    );
    assert.equal(status.phases["check-supabase"].state, "failed");
    assert.match(status.phases["check-supabase"].message, /Supabase API validation failed/);
  });
});
