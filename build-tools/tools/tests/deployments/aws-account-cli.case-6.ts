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

test("aws-account evidence validates schemas freshness and redaction", async () => {
  await runInTemp("aws-account-evidence", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    const evidenceDir = path.join(tmp, "evidence");
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
          stdout: () => undefined,
          toolResolver: (tool) => `/nix/store/fake-${tool}/bin/${tool}`,
          commandRunner: async () => ({
            stdout: JSON.stringify({ Account: "123456789012" }),
            stderr: "",
          }),
        }),
    );
    const okOut: string[] = [];
    await withControlPlaneArgv(
      ["aws-account", "evidence", "--evidence-dir", evidenceDir, "--max-age-minutes", "60"],
      () =>
        runAwsAccountCommand({
          cwd: tmp,
          now: () => NOW,
          stdout: (text) => okOut.push(text),
        }),
    );
    assert.equal(JSON.parse(okOut[0] || "{}").ok, true);
    const toolsEvidencePath = path.join(evidenceDir, "check-tools", "tools.json");
    const toolsEvidence = JSON.parse(await fsp.readFile(toolsEvidencePath, "utf8"));
    toolsEvidence.accessToken = "sbp_leaked";
    await fsp.writeFile(toolsEvidencePath, `${JSON.stringify(toolsEvidence, null, 2)}\n`, "utf8");
    const badOut: string[] = [];
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await withControlPlaneArgv(
        ["aws-account", "evidence", "--evidence-dir", evidenceDir, "--max-age-minutes", "60"],
        () =>
          runAwsAccountCommand({
            cwd: tmp,
            now: () => NOW,
            stdout: (text) => badOut.push(text),
          }),
      );
    } finally {
      process.exitCode = previousExitCode;
    }
    const bad = JSON.parse(badOut[0] || "{}");
    assert.equal(bad.ok, false);
    assert.ok(String(bad.redactionFindings).includes("accessToken"));
  });
});

test("aws-account resume executes the next supported phase", async () => {
  await runInTemp("aws-account-resume", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    const evidenceDir = path.join(tmp, "evidence");
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
          stdout: () => undefined,
          toolResolver: (tool) => `/nix/store/fake-${tool}/bin/${tool}`,
          commandRunner: async () => ({
            stdout: JSON.stringify({ Account: "123456789012" }),
            stderr: "",
          }),
        }),
    );
    const calls: Array<{ file: string; args: string[] }> = [];
    const out: string[] = [];
    await withControlPlaneArgv(["aws-account", "resume", "--evidence-dir", evidenceDir], () =>
      runAwsAccountCommand({
        cwd: tmp,
        now: () => NOW,
        env: { SUPABASE_ACCESS_TOKEN: "test-token" },
        httpFetch: fakeSupabaseFetch,
        stdout: (text) => out.push(text),
        toolResolver: (tool) => `/nix/store/fake-${tool}/bin/${tool}`,
        commandRunner: async (file, args) => {
          calls.push({ file, args });
          if (file === "aws")
            return { stdout: JSON.stringify({ Account: "123456789012" }), stderr: "" };
          return { stdout: `${file} ${args.join(" ")}`, stderr: "" };
        },
      }),
    );
    const payload = JSON.parse(out[0] || "{}");
    assert.equal(payload.phases["bootstrap-state"].state, "manual");
    assert.deepEqual(
      calls.filter((call) => call.file === "tofu").map((call) => call.args[0]),
      ["init", "plan"],
    );
  });
});

test("control-plane dispatcher recognizes aws-account subcommands", () => {
  const previous = process.argv;
  const previousGlobal = (globalThis as any).argv;
  try {
    delete (globalThis as any).argv;
    process.argv = [
      "node",
      "deployment-control-plane",
      "aws-account",
      "check",
      "--stack",
      "control-dr",
      "--auth-service",
      "login",
      "--domain",
      "example.com",
      "--state-bucket-name",
      "custom-state-bucket",
      "--supabase-access-token-ref",
      "secret://control-plane/supabase/management-api-token",
    ];
    assert.equal(selectedControlPlaneCommand(), "aws-account");
  } finally {
    process.argv = previous;
    (globalThis as any).argv = previousGlobal;
  }
});
