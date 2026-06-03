import {
  assert,
  fakeSupabaseFetch,
  fsp,
  path,
  parseStackField,
  readAwsAccountConfig,
  readSupabaseEvidence,
  resolveStackRef,
  runAwsAccountCommand,
  runInTemp,
  runSprinkleRefCli,
  test,
  withControlPlaneArgv,
  writeJson,
  writeLocalValues,
  writeRemote,
  writeStack,
} from "./aws-account-local-sprinkleref.helpers";

test("aws-account resolver handles remote fallback and unknown redirect categories", async () => {
  await runInTemp("aws-account-remote-fallback", async (tmp) => {
    const ref = "secret://control-plane/aws/account-id";
    const orgRef = "secret://control-plane/aws/organization-id";
    await writeRemote(tmp, "control", { [ref]: "remote-id" });
    await writeStack(tmp, { domain: "example.com", awsAccountId: { ref } });
    let config = await readAwsAccountConfig(tmp);
    assert.equal(config.awsAccountId, "remote-id");
    assert.equal(config.inputSources.awsAccountId.source, "sprinkleref");
    await writeLocalValues(tmp, { "control-plane": { aws: { "account-id": "local-id" } } });
    config = await readAwsAccountConfig(tmp);
    assert.equal(config.awsAccountId, "local-id");
    await writeLocalValues(tmp, {
      "control-plane": { aws: { "account-id": { ref, category: "unknown" } } },
    });
    const unresolved = await resolveStackRef(tmp, ref);
    assert.match(unresolved.error || "", /category unknown/);
    await writeLocalValues(tmp, {
      "control-plane": { aws: { "account-id": { ref } } },
    });
    const redirected = await resolveStackRef(tmp, ref);
    assert.equal(redirected.value, "remote-id");
    assert.equal(redirected.source.source, "sprinkleref");
    assert.equal(redirected.category, "control");
    await writeLocalValues(tmp, {
      "control-plane": { aws: { "account-id": { ref: orgRef }, "organization-id": "local-org" } },
    });
    const chained = await resolveStackRef(tmp, ref);
    assert.equal(chained.value, "local-org");
    assert.equal(chained.source.source, "local-values");
  });
});

test("aws-account source precedence favors cli and inline over resolvers", async () => {
  await runInTemp("aws-account-source-precedence", async (tmp) => {
    const ref = "secret://control-plane/supabase/management-api-token";
    const accountRef = "secret://control-plane/aws/account-id";
    await writeRemote(tmp, "control", { [ref]: "remote-token", [accountRef]: "remote-id" });
    await writeLocalValues(tmp, {
      "control-plane": {
        aws: { "account-id": "local-id" },
        supabase: { "management-api-token": "plain-local-token" },
      },
    });
    await writeStack(tmp, {
      domain: "example.com",
      awsAccountId: "stack-id",
      supabaseOrgId: "supabase-org",
      supabaseProjectRef: "project-ref",
      supabaseAccessToken: { ref },
    });
    await withControlPlaneArgv(["aws-account", "check", "--aws-account-id", "cli-id"], async () => {
      const config = await readAwsAccountConfig(tmp);
      assert.equal(config.awsAccountId, "cli-id");
      assert.equal(config.inputSources.awsAccountId.source, "cli");
    });
    await withControlPlaneArgv(["aws-account", "check"], async () => {
      const config = await readAwsAccountConfig(tmp);
      assert.equal(config.awsAccountId, "stack-id");
      assert.equal(config.inputSources.awsAccountId.source, "inline");
    });
    await assert.rejects(
      () => resolveStackRef(tmp, ref, { secret: true }),
      /must not be plaintext/,
    );
    const out: string[] = [];
    await withControlPlaneArgv(["aws-account", "check"], () =>
      runAwsAccountCommand({
        cwd: tmp,
        env: { SUPABASE_ACCESS_TOKEN: "env-token" },
        now: () => new Date("2026-06-02T12:00:00.000Z"),
        httpFetch: fakeSupabaseFetch,
        stdout: (text) => out.push(text),
        toolResolver: (tool) => `/nix/store/fake-${tool}/bin/${tool}`,
        commandRunner: async () => ({
          stdout: JSON.stringify({ Account: "stack-id" }),
          stderr: "",
        }),
      }),
    );
    assert.match(
      out.join("\n"),
      /supabaseAccessToken: environment \(redacted\)\n    env: SUPABASE_ACCESS_TOKEN/,
    );
  });
});

test("sprinkleref --init-local preserves values and writes no plaintext token", async () => {
  await runInTemp("sprinkleref-init-local", async (tmp) => {
    const cwd = process.cwd();
    process.chdir(tmp);
    try {
      await writeLocalValues(tmp, { "control-plane": { aws: { "account-id": "kept" } } });
      const out: string[] = [];
      await runSprinkleRefCli({ argv: ["--init-local"], stdout: (text) => out.push(text) });
      const values = JSON.parse(
        await fsp.readFile(path.join(tmp, "config/sprinkleref/local/values.json"), "utf8"),
      );
      assert.match(out[0] || "", /config\/sprinkleref\/local\/values\.json/);
      assert.equal(values.values["control-plane"].aws["account-id"], "kept");
      assert.equal(
        values.values["control-plane"].supabase["management-api-token"].category,
        "bootstrap",
      );
      assert.doesNotMatch(JSON.stringify(values), /token-value|plain-token/);
    } finally {
      process.chdir(cwd);
    }
  });
});
