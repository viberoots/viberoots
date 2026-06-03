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

test("aws-account check supports raw json output for automation", async () => {
  await runInTemp("aws-account-check-json", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    const out: string[] = [];
    await withControlPlaneArgv(
      [
        "aws-account",
        "check",
        "--json",
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
          httpFetch: fakeSupabaseFetch,
          stdout: (text) => out.push(text),
          toolResolver: (tool) => `/nix/store/fake-${tool}/bin/${tool}`,
          commandRunner: async () => ({
            stdout: JSON.stringify({ Account: "123456789012" }),
            stderr: "",
          }),
        }),
    );
    assert.equal(JSON.parse(out[0] || "{}").schemaVersion, "aws-account-status@1");
  });
});

test("aws-account check explains where missing Supabase values belong", async () => {
  await runInTemp("aws-account-check-guidance", async (tmp) => {
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
        ],
        () =>
          runAwsAccountCommand({
            cwd: tmp,
            now: () => NOW,
            stdout: (text) => out.push(text),
            toolResolver: (tool) => `/nix/store/fake-${tool}/bin/${tool}`,
            commandRunner: async () => ({
              stdout: JSON.stringify({ Account: "123456789012" }),
              stderr: "",
            }),
            env: {},
          }),
      );
    } finally {
      process.exitCode = previousExitCode;
    }
    assert.ok(out[0]?.includes("  BLOCKED check-supabase"));
    assert.ok(out[0]?.includes("Missing Values"));
    assert.ok(out[0]?.includes("Local values or shared resolver refs:"));
    assert.ok(out[0]?.includes("action: fill local values or write the ref in SprinkleRef"));
    assert.ok(out[0]?.includes("ref: config://control-plane/supabase/org-id"));
    assert.equal(out[0]?.includes("passed with --config"), false);
    assert.ok(out[0]?.includes("ref: config://control-plane/supabase/project-ref"));
    assert.equal(out[0]?.includes("Bootstrap category:"), false);
    assert.ok(out[0]?.includes("ref: secret://control-plane/supabase/management-api-token"));
    assert.ok(out[0]?.includes("SUPABASE_ACCESS_TOKEN"));
    assert.ok(out[0]?.includes("config/sprinkleref/local/values.json"));
  });
});

test("aws-account bootstrap plans remote state and waits for explicit apply", async () => {
  await runInTemp("aws-account-bootstrap-plan", async (tmp) => {
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
            return {
              stdout: `${file} ${args.join(" ")}`,
              stderr: "",
            };
          },
        }),
    );
    const payload = JSON.parse(out[0] || "{}");
    assert.equal(payload.phases["bootstrap-state"].state, "manual");
    assert.match(payload.phases["bootstrap-state"].message, /plan is ready/);
    assert.equal(calls.filter((call) => call.file === "tofu").length, 2);
    assert.deepEqual(
      calls.filter((call) => call.file === "tofu").map((call) => call.args[0]),
      ["init", "plan"],
    );
    assert.ok(await exists(path.join(evidenceDir, "bootstrap-state", "plan.json")));
    assert.ok(
      await exists(
        path.join(evidenceDir, "bootstrap-state", "opentofu-workdir", "account.auto.tfvars.json"),
      ),
    );
  });
});
