import {
  assert,
  path,
  runAwsAccountCommand,
  runInTemp,
  test,
  withControlPlaneArgv,
  writeJson,
  writeLocalValues,
  writeStack,
} from "./aws-account-local-sprinkleref.helpers";

test("aws-account setup-plan classifies clean-clone missing setup work", async () => {
  await runInTemp("aws-account-setup-plan-clean-clone", async (tmp) => {
    await writeStackWithRefs(tmp);
    await writeSharedResolver(tmp);
    const text = await runSetupPlan(tmp);
    assert.match(text, /AWS Account Setup Plan/);
    assert.match(text, /\[local operator config initialization\] Initialize local operator config/);
    assert.match(text, /\[shared non-secret project config value\] Set awsAccountId/);
    assert.match(text, /ref: config:\/\/control-plane\/aws\/account-id/);
    assert.match(text, /\[secret backend write\] Write supabaseAccessToken/);
    assert.match(text, /ref: secret:\/\/control-plane\/supabase\/management-api-token/);
    assert.match(text, /\[AWS login\/readiness check\] Verify AWS login and tool readiness/);
    assert.match(text, /\[Supabase account\/project\/readiness check\]/);
    assert.match(text, /\[reviewed IaC\/evidence step\] Plan reviewed AWS foundation work/);
    assert.match(text, /does not mutate AWS, Supabase, Infisical, Vault, or cloud resources/);
    assert.doesNotMatch(text, /super-secret|plaintext-token|paste tokens into JSON/i);
    assert.doesNotMatch(text, /--apply|-auto-approve/);
  });
});

test("aws-account setup-plan reports initialized local placeholders as local work", async () => {
  await runInTemp("aws-account-setup-plan-local-placeholders", async (tmp) => {
    await writeStackWithRefs(tmp);
    await writeSharedResolver(tmp);
    await writeLocalValues(tmp, {
      "control-plane": {
        aws: { "account-id": "", "organization-id": "" },
        supabase: { "org-id": "", "project-ref": "" },
      },
    });
    const text = await runSetupPlan(tmp);
    assert.doesNotMatch(text, /Initialize local operator config/);
    assert.match(text, /\[local operator config initialization\] Set awsAccountId/);
    assert.match(text, /path: projects\/config\/local\.json/);
    assert.match(text, /ref: config:\/\/control-plane\/supabase\/project-ref/);
    assert.match(text, /\[secret backend write\] Write supabaseAccessToken/);
  });
});

test("aws-account setup-plan is available before stack config initialization", async () => {
  await runInTemp("aws-account-setup-plan-no-stack", async (tmp) => {
    const text = await runSetupPlan(tmp);
    assert.match(text, /control-plane aws-account config-init --domain <domain>/);
    assert.match(text, /sprinkleref --init/);
    assert.match(text, /sprinkleref --init-local/);
    assert.match(text, /path: projects\/config\/control-plane\/stack\.json/);
  });
});

test("aws-account setup-plan json redacts runtime token sources", async () => {
  await runInTemp("aws-account-setup-plan-json-runtime-token", async (tmp) => {
    await writeStackWithRefs(tmp);
    await writeSharedResolver(tmp);
    await writeLocalValues(tmp, {
      "control-plane": {
        aws: { "account-id": "123456789012", "organization-id": "o-example" },
        supabase: { "org-id": "org-example", "project-ref": "project-ref" },
      },
    });
    const raw = await runSetupPlan(tmp, ["--json"], {
      SUPABASE_ACCESS_TOKEN: "super-secret-runtime-token",
    });
    assert.doesNotMatch(raw, /super-secret-runtime-token/);
    const plan = JSON.parse(raw);
    assert.equal(plan.schemaVersion, "aws-account-setup-plan@1");
    assert.equal(plan.readOnly, true);
    const categories = plan.steps.map((step: { category: string }) => step.category);
    assert.ok(categories.includes("runtime credential source"));
    assert.ok(categories.includes("AWS login/readiness check"));
    assert.ok(categories.includes("reviewed IaC/evidence step"));
    assert.doesNotMatch(raw, /paste tokens into JSON/i);
    assert.doesNotMatch(raw, /--apply|-auto-approve/);
  });
});

async function writeStackWithRefs(tmp: string): Promise<void> {
  await writeStack(tmp, {
    domain: "deploy.example.com",
    awsAccountId: { ref: "config://control-plane/aws/account-id", category: "control" },
    awsOrganizationId: { ref: "config://control-plane/aws/organization-id" },
    supabaseOrgId: { ref: "config://control-plane/supabase/org-id" },
    supabaseProjectRef: { ref: "config://control-plane/supabase/project-ref" },
    supabaseAccessToken: {
      ref: "secret://control-plane/supabase/management-api-token",
      category: "control",
    },
  });
}

async function writeSharedResolver(tmp: string): Promise<void> {
  await writeJson(path.join(tmp, "projects/config/shared.json"), {
    schemaVersion: "viberoots-project-config@1",
    sprinkleref: {
      version: 1,
      defaultCategory: "control",
      categories: {
        control: { backend: "local-file", file: path.join(tmp, ".local/control.json") },
      },
    },
  });
}

async function runSetupPlan(
  tmp: string,
  extraArgs: string[] = [],
  env: Record<string, string> = {},
): Promise<string> {
  const out: string[] = [];
  await withControlPlaneArgv(["aws-account", "setup-plan", ...extraArgs], () =>
    runAwsAccountCommand({ cwd: tmp, env, stdout: (text) => out.push(text) }),
  );
  return out.join("\n");
}
