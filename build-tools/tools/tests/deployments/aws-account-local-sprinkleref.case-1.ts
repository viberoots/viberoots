import {
  assert,
  assertAccountLocalValuesSource,
  fakeSupabaseFetch,
  fsp,
  path,
  parseStackField,
  readAwsAccountConfig,
  readInputsEvidence,
  runAwsAccountCheckForEvidence,
  runAwsAccountCommand,
  readSupabaseEvidence,
  resolveStackRef,
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
    await runAwsAccountCheckForEvidence(tmp, evidenceDir);
    const accountSource = (await readInputsEvidence(evidenceDir)).inputSources.awsAccountId;
    assertAccountLocalValuesSource(accountSource);
    assert.match(accountSource.localValuesPath, /projects\/config\/local\.json$/);
    await writeLocalValues(tmp, {
      "control-plane": { aws: { "account-id": { value: "object-account-id" } } },
    });
    const objectEvidenceDir = path.join(tmp, "evidence-value-object");
    await runAwsAccountCheckForEvidence(tmp, objectEvidenceDir);
    const objectSource = (await readInputsEvidence(objectEvidenceDir)).inputSources.awsAccountId;
    assertAccountLocalValuesSource(objectSource);
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
          category: "control",
          categoryExplicit: true,
          secret: true,
        }),
      /must not be plaintext/,
    );
    await writeLocalValues(tmp, {
      "control-plane": { supabase: { "management-api-token": { value: "plain-token" } } },
    });
    await assert.rejects(
      () =>
        resolveStackRef(tmp, "secret://control-plane/supabase/management-api-token", {
          category: "control",
          categoryExplicit: true,
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
    await fsp.mkdir(path.join(tmp, ".local"), { recursive: true });
    await writeJson(path.join(tmp, "projects/config/shared.json"), {
      schemaVersion: "viberoots-project-config@1",
      sprinkleref: {
        version: 1,
        defaultCategory: "control",
        categories: {
          control: { backend: "local-file", file: path.join(tmp, ".local/control.json") },
          bootstrap: { backend: "local-file", file: path.join(tmp, ".local/bootstrap.json") },
        },
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
    assert.equal(evidence.supabaseAccessToken.redirectRef, ref);
    assert.equal(evidence.supabaseAccessToken.category, "bootstrap");
    assert.match(evidence.supabaseAccessToken.localValuesPath, /projects\/config\/local\.json$/);
    assert.equal(
      evidence.supabaseAccessToken.localValuesEntryPath,
      "values.control-plane.supabase.management-api-token",
    );
    assert.match(evidence.supabaseAccessToken.backend, /local-file/);
    assert.equal(evidence.supabaseAccessToken.redirectSource.ref, ref);
    assert.equal(evidence.supabaseAccessToken.redirectSource.category, "bootstrap");
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
    await fsp.mkdir(path.join(tmp, "projects/config"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "projects/config/local.json"), "{", "utf8");
    await assert.rejects(() => resolveStackRef(tmp, ref), /invalid project config JSON/);
    await writeLocalValues(tmp, {
      "control-plane": { aws: { "account-id": { value: "1", ref: "secret://x/y" } } },
    });
    await assert.rejects(() => resolveStackRef(tmp, ref), /must not contain both value and ref/);
  });
});

test("aws-account local values fail closed on malformed JSON roots", async () => {
  await runInTemp("aws-account-local-values-malformed-root", async (tmp) => {
    const ref = "config://control-plane/aws/account-id";
    const valuesPath = path.join(tmp, "projects/config/local.json");
    await fsp.mkdir(path.dirname(valuesPath), { recursive: true });
    await fsp.writeFile(valuesPath, '"not-an-object"\n', "utf8");
    await assert.rejects(
      () => resolveStackRef(tmp, ref),
      /projects\/config\/local\.json root must be an object/,
    );
    await fsp.writeFile(valuesPath, "[]\n", "utf8");
    await assert.rejects(
      () => resolveStackRef(tmp, ref),
      /projects\/config\/local\.json root must be an object/,
    );
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
