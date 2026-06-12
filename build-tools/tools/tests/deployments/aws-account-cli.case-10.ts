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

test("aws-account check records cache readiness without failing auto-mode setup", async () => {
  await runInTemp("aws-account-cache-readiness-auto", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    await withReadyAccountConfig(tmp, async () => {
      const out: string[] = [];
      await withControlPlaneArgv(["aws-account", "check"], () =>
        runAwsAccountCommand({
          cwd: tmp,
          now: () => NOW,
          env: { SUPABASE_ACCESS_TOKEN: "test-token", VBR_NIX_CACHE_POLICY: "auto" },
          httpFetch: cacheAwareFetch,
          stdout: (text) => out.push(text),
          toolResolver: (tool) => `/nix/store/fake-${tool}/bin/${tool}`,
          commandRunner: fakeCommandRunner,
        }),
      );
      assert.ok(out.join("\n").includes("  PASS    check-supabase"));
      const evidence = await readToolsEvidence(tmp);
      assert.equal(evidence.cacheReadiness.state, "degraded");
      assert.deepEqual(evidence.cacheReadiness.optionalSubstituters, [
        "https://unreachable.dynamic.example/cache",
        "https://reachable.dynamic.example/cache",
      ]);
      assert.match(JSON.stringify(evidence), /reachable\.dynamic\.example/);
      assert.doesNotMatch(JSON.stringify(evidence), /home\.kilty|kilty\.io/);
    });
  });
});

test("aws-account check fails closed only under explicit strict cache policy", async () => {
  await runInTemp("aws-account-cache-readiness-strict", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    await withReadyAccountConfig(tmp, async () => {
      const previousExitCode = process.exitCode;
      process.exitCode = undefined;
      try {
        await withControlPlaneArgv(["aws-account", "check"], () =>
          runAwsAccountCommand({
            cwd: tmp,
            now: () => NOW,
            env: { SUPABASE_ACCESS_TOKEN: "test-token", VBR_NIX_CACHE_POLICY: "strict" },
            httpFetch: cacheAwareFetch,
            stdout: () => undefined,
            toolResolver: (tool) => `/nix/store/fake-${tool}/bin/${tool}`,
            commandRunner: fakeCommandRunner,
          }),
        );
        assert.equal(process.exitCode, 2);
      } finally {
        process.exitCode = previousExitCode;
      }
      const evidence = await readToolsEvidence(tmp);
      assert.equal(evidence.cacheReadiness.state, "failed");
      assert.match(evidence.cacheReadiness.message, /strict cache policy failed/);
    });
  });
});

async function withReadyAccountConfig(tmp: string, run: () => Promise<void>) {
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
    await run();
  });
}

async function fakeCommandRunner(file: string, args: string[] = []) {
  if (file === "nix") {
    if (args[0] === "store" && args[1] === "info") {
      const store = args[args.indexOf("--store") + 1] || "";
      if (store.includes("unreachable.dynamic.example")) {
        throw new Error(`unreachable test substituter: ${store}`);
      }
      return { stdout: "", stderr: "" };
    }
    return {
      stdout: [
        "substituters = https://cache.nixos.org/",
        "extra-substituters = https://unreachable.dynamic.example/cache https://reachable.dynamic.example/cache",
      ].join("\n"),
      stderr: "",
    };
  }
  return { stdout: JSON.stringify({ Account: "123456789012" }), stderr: "" };
}

async function cacheAwareFetch(url: string, init?: { headers?: Record<string, string> }) {
  return fakeSupabaseFetch(url, init);
}

async function readToolsEvidence(tmp: string): Promise<any> {
  return JSON.parse(
    await fsp.readFile(
      path.join(tmp, "buck-out/aws-account/control-example.com/check-tools/tools.json"),
      "utf8",
    ),
  );
}
