import {
  assert,
  fakeSupabaseFetch,
  fsp,
  path,
  runAwsAccountCommand,
  runInTemp,
  runSprinkleRefCli,
  test,
  withControlPlaneArgv,
  writeJson,
  writeStack,
} from "./aws-account-local-sprinkleref.helpers";

test("sprinkleref --init is idempotent when shared project config already exists", async () => {
  await runInTemp("sprinkleref-init-existing-shared", async (tmp) => {
    const cwd = process.cwd();
    process.chdir(tmp);
    try {
      await writeJson(path.join(tmp, "projects/config/shared.json"), {
        schemaVersion: "viberoots-project-config@1",
        values: { existing: true },
      });
      const out: string[] = [];
      await runSprinkleRefCli({ argv: ["--init"], stdout: (text) => out.push(text) });
      assert.deepEqual(JSON.parse(out[0] || "{}"), { written: [] });
      const shared = JSON.parse(
        await fsp.readFile(path.join(tmp, "projects/config/shared.json"), "utf8"),
      );
      assert.deepEqual(shared, {
        schemaVersion: "viberoots-project-config@1",
        values: { existing: true },
      });
    } finally {
      process.chdir(cwd);
    }
  });
});

test("aws-account check classifies missing config refs as project config with absent local config", async () => {
  await runInTemp("aws-account-clean-clone-missing-config", async (tmp) => {
    await writeStack(tmp, {
      domain: "example.com",
      awsAccountId: { ref: "config://control-plane/aws/account-id", category: "control" },
      awsOrganizationId: {
        ref: "config://control-plane/aws/organization-id",
        category: "control",
      },
      supabaseOrgId: { ref: "config://control-plane/supabase/org-id", category: "control" },
      supabaseProjectRef: {
        ref: "config://control-plane/supabase/project-ref",
        category: "control",
      },
      supabaseAccessToken: {
        ref: "secret://control-plane/supabase/management-api-token",
        category: "control",
      },
    });
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
    const out: string[] = [];
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await withControlPlaneArgv(["aws-account", "check"], () =>
        runAwsAccountCommand({
          cwd: tmp,
          env: { SUPABASE_ACCESS_TOKEN: "token-for-this-run" },
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
      assert.equal(process.exitCode, 2);
    } finally {
      process.exitCode = previousExitCode;
    }
    const text = out.join("\n");
    assert.match(text, /Missing Values\n  Shared project config:/);
    assert.match(text, /ref: config:\/\/control-plane\/aws\/account-id/);
    assert.match(text, /ref: config:\/\/control-plane\/supabase\/project-ref/);
    assert.doesNotMatch(
      text,
      /config:\/\/control-plane\/aws\/account-id is missing in SprinkleRef/,
    );
    assert.doesNotMatch(text, /category: control[\s\S]*awsAccountId/);
    assert.doesNotMatch(text, /category: control[\s\S]*supabaseProjectRef/);
  });
});
