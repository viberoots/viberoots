import {
  NOW,
  assert,
  fakeSupabaseFetch,
  fsp,
  path,
  removeCanonicalStackConfig,
  runAwsAccountCommand,
  runInTemp,
  test,
  withControlPlaneArgv,
  withCwd,
} from "./aws-account-cli.helpers";

test("aws-account rejects stale Supabase token-ref CLI inputs", async () => {
  await runInTemp("aws-account-rejects-token-ref-flags", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    await assertStaleFlagsRejected(tmp, [
      "aws-account",
      "config-init",
      "--domain",
      "example.com",
      "--supabase-access-token-ref",
      "secret://control-plane/supabase/management-api-token",
      "--supabase-access-token-ref-category",
      "control",
    ]);
    await assertStaleFlagsRejected(tmp, [
      "aws-account",
      "check",
      "--domain",
      "example.com",
      "--supabase-access-token-ref-category",
      "control",
    ]);
  });
});

test("aws-account check resolves Supabase token from SprinkleRef ref", async () => {
  await runInTemp("aws-account-supabase-sprinkleref", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    await withCwd(tmp, async () => {
      const secretRef = "secret://control-plane/supabase/management-api-token";
      await fsp.mkdir(path.join(tmp, "projects/config"), { recursive: true });
      await fsp.mkdir(path.join(tmp, ".local"), { recursive: true });
      await fsp.writeFile(
        path.join(tmp, "projects/config/shared.json"),
        JSON.stringify(
          {
            schemaVersion: "viberoots-project-config@1",
            sprinkleref: {
              version: 1,
              defaultCategory: "control",
              categories: {
                main: { backend: "local-file", file: ".local/main-secrets.json" },
                control: { backend: "local-file", file: ".local/secrets.json" },
              },
            },
          },
          null,
          2,
        ),
      );
      await fsp.writeFile(
        path.join(tmp, ".local/secrets.json"),
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
            "buck-out/aws-account/control-example.com/check-supabase/supabase-readiness.json",
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

async function assertStaleFlagsRejected(tmp: string, argv: string[]): Promise<void> {
  await withControlPlaneArgv(argv, async () => {
    await assert.rejects(
      () => runAwsAccountCommand({ cwd: tmp, stdout: () => undefined }),
      /supabaseAccessTokenRef CLI inputs are no longer supported/,
    );
  });
}
