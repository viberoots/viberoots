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

test("aws-account resolves structured stack refs from hierarchical local values", async () => {
  await runInTemp("aws-account-local-values", async (tmp) => {
    await writeStack(tmp, {
      domain: { value: "example.com" },
      awsAccountId: { ref: "config://control-plane/aws/account-id" },
      awsOrganizationId: { ref: "config://control-plane/aws/organization-id" },
      supabaseOrgId: { ref: "config://control-plane/supabase/org-id" },
      supabaseProjectRef: { ref: "config://control-plane/supabase/project-ref" },
      supabaseAccessToken: { ref: "secret://control-plane/supabase/management-api-token" },
    });
    await writeLocalValues(tmp, {
      "control-plane": {
        aws: { "account-id": "123456789012", "organization-id": "o-example" },
        supabase: { "org-id": "org", "project-ref": "project-ref" },
      },
    });
    const evidenceDir = path.join(tmp, "evidence-plaintext");
    await withControlPlaneArgv(
      ["aws-account", "check", "--evidence-dir", evidenceDir],
      async () => {
        const config = await readAwsAccountConfig(tmp);
        assert.equal(config.domain, "example.com");
        assert.equal(config.awsAccountId, "123456789012");
        assert.equal(config.awsOrganizationId, "o-example");
        assert.equal(config.supabaseOrgId, "org");
        assert.equal(config.supabaseProjectRef, "project-ref");
        assert.equal(config.inputSources.awsAccountId.source, "local-values");
      },
    );
  });
});

test("aws-account rejects plaintext secret-class stack and local values", async () => {
  await runInTemp("aws-account-secret-rejects-plaintext", async (tmp) => {
    await writeStack(tmp, { domain: "example.com", supabaseAccessToken: "plain-token" });
    const evidenceDir = path.join(tmp, "evidence-plaintext");
    await withControlPlaneArgv(
      ["aws-account", "check", "--evidence-dir", evidenceDir],
      async () => {
        await assert.rejects(() => readAwsAccountConfig(tmp), /supabaseAccessToken.*plaintext/);
      },
    );
    await writeStack(tmp, {
      domain: "example.com",
      awsAccountId: "123456789012",
      supabaseOrgId: "supabase-org",
      supabaseProjectRef: "project-ref",
      supabaseAccessToken: { ref: "secret://control-plane/supabase/management-api-token" },
    });
    await writeLocalValues(tmp, {
      "control-plane": { supabase: { "management-api-token": "plain-token" } },
    });
    await assert.rejects(
      () =>
        resolveStackRef(tmp, "secret://control-plane/supabase/management-api-token", {
          secret: true,
        }),
      /must not be plaintext/,
    );
  });
});

test("aws-account resolves secret local redirect through bootstrap category", async () => {
  await runInTemp("aws-account-local-redirect", async (tmp) => {
    const ref = "secret://control-plane/supabase/management-api-token";
    await writeStack(tmp, {
      domain: "example.com",
      awsAccountId: "123456789012",
      awsOrganizationId: "o-example",
      supabaseOrgId: "supabase-org",
      supabaseProjectRef: "project-ref",
      supabaseAccessToken: { ref },
    });
    await fsp.mkdir(path.join(tmp, "config/sprinkleref"), { recursive: true });
    await fsp.mkdir(path.join(tmp, ".local"), { recursive: true });
    await writeJson(path.join(tmp, "config/sprinkleref", "selected.json"), {
      version: 1,
      defaultCategory: "control",
      categories: {
        control: { backend: "local-file", file: path.join(tmp, ".local/control.json") },
        bootstrap: { backend: "local-file", file: path.join(tmp, ".local/bootstrap.json") },
      },
    });
    await writeJson(path.join(tmp, ".local", "bootstrap.json"), { [ref]: "test-token" });
    await writeLocalValues(tmp, {
      "control-plane": { supabase: { "management-api-token": { ref, category: "bootstrap" } } },
    });
    const out: string[] = [];
    const evidenceDir = path.join(tmp, "evidence-redirect");
    await withControlPlaneArgv(["aws-account", "check", "--evidence-dir", evidenceDir], () =>
      runAwsAccountCommand({
        cwd: tmp,
        env: {},
        now: () => new Date("2026-06-02T12:00:00.000Z"),
        httpFetch: fakeSupabaseFetch,
        stdout: (text) => out.push(text),
        toolResolver: (tool) => `/nix/store/fake-${tool}/bin/${tool}`,
        commandRunner: async () => ({
          stdout: JSON.stringify({ Account: "123456789012" }),
          stderr: "",
        }),
      }),
    );
    assert.match(out.join("\n"), /PASS    check-supabase/);
    assert.match(
      out.join("\n"),
      /Sources\n(?!  domain:)(?:.*\n)*  supabaseAccessToken: SprinkleRef \(redacted\)/,
    );
    assert.match(
      out.join("\n"),
      /supabaseAccessToken: SprinkleRef \(redacted\)\n(?:.*\n)*    category: bootstrap/,
    );
    const evidence = await readSupabaseEvidence(evidenceDir);
    assert.equal(evidence.supabaseAccessToken.source, "sprinkleref");
    assert.equal(evidence.supabaseAccessToken.ref, ref);
    assert.equal(evidence.supabaseAccessToken.category, "bootstrap");
    assert.match(
      evidence.supabaseAccessToken.localValuesPath,
      /config\/sprinkleref\/local\/values\.json$/,
    );
    assert.match(evidence.supabaseAccessToken.backend, /local-file/);
    assert.equal(evidence.supabaseAccessToken.valuePrinted, false);
    assert.doesNotMatch(JSON.stringify(evidence), /test-token/);
  });
});

test("aws-account parser rejects invalid stack value and ref forms", () => {
  assert.throws(
    () => parseStackField({ awsAccountId: { value: "1", ref: "secret://x/y" } }, "awsAccountId"),
    /both value and ref/,
  );
  assert.throws(
    () => parseStackField({ awsAccountId: { ref: "infisical://x/y" } }, "awsAccountId"),
    /config:\/\/ or runtime:\/\//,
  );
  assert.throws(
    () => parseStackField({ awsAccountId: { ref: "" } }, "awsAccountId", { required: true }),
    /awsAccountId is required/,
  );
  assert.throws(
    () =>
      parseStackField(
        { awsAccountId: { ref: "config://github/deployments/token" } },
        "awsAccountId",
      ),
    /backend-neutral/,
  );
  assert.throws(
    () =>
      parseStackField({ supabaseAccessToken: { value: "plain" } }, "supabaseAccessToken", {
        secret: true,
      }),
    /plaintext/,
  );
});

test("aws-account local values fail closed on malformed JSON and value objects", async () => {
  await runInTemp("aws-account-local-values-negative", async (tmp) => {
    const ref = "config://control-plane/aws/account-id";
    await fsp.mkdir(path.join(tmp, "config/sprinkleref/local"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "config/sprinkleref/local/values.json"), "{", "utf8");
    await assert.rejects(() => resolveStackRef(tmp, ref), /invalid local SprinkleRef values JSON/);
    await writeLocalValues(tmp, {
      "control-plane": { aws: { "account-id": { value: "1", ref: "secret://x/y" } } },
    });
    await assert.rejects(() => resolveStackRef(tmp, ref), /must not contain both value and ref/);
  });
});

test("aws-account local redirects detect cycles through redirect chains", async () => {
  await runInTemp("aws-account-local-redirect-cycle", async (tmp) => {
    const accountRef = "config://control-plane/aws/account-id";
    const orgRef = "config://control-plane/aws/organization-id";
    await writeLocalValues(tmp, {
      "control-plane": {
        aws: {
          "account-id": { ref: orgRef },
          "organization-id": { ref: accountRef },
        },
      },
    });
    await assert.rejects(() => resolveStackRef(tmp, accountRef), /redirect cycle/);
  });
});
