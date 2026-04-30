#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";

test("shared-host deployment service module routes hosted HTTPS to a private service bind", async () => {
  await runInTemp("shared-host-deployment-service-module-eval", async (tmp, $) => {
    const expr = `
      let
        targetMessage = "deploymentHost.deploymentService.localBindHost must be private.";
        system = import <nixpkgs/nixos> {
          configuration = {
            imports = [ ./build-tools/tools/nix/shared-host-deployment-service-module.nix ];
            system.stateVersion = "24.11";
            deploymentHost.deploymentService = {
              enable = true;
              hostname = "deploy.example.test";
              localBindHost = "127.0.0.1";
              localBindPort = 7780;
              manageNginx = true;
              manageAcme = true;
              acmeEmail = "ops@example.test";
              openFirewall = true;
              reviewedSourceSsh.privateKeyFile = "/run/secrets/github-reviewed-source-key";
            };
          };
        };
        host = system.config.deploymentHost.deploymentService.hostname;
        vhost = system.config.services.nginx.virtualHosts.\${host};
      in {
        nginxEnabled = system.config.services.nginx.enable;
        forceSSL = vhost.forceSSL;
        enableACME = vhost.enableACME;
        proxyPass = vhost.locations."/".proxyPass;
        hasArtifactAlias = builtins.hasAttr "/artifacts" vhost.locations;
        acmeEmail = system.config.security.acme.defaults.email;
        firewallPorts = system.config.networking.firewall.allowedTCPPorts;
        reviewedSourceEnv =
          system.config.environment.etc."deployment-host/reviewed-source-ssh.env".text;
        githubKnownHosts =
          system.config.environment.etc."deployment-host/github-known-hosts".text;
      }
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const out = JSON.parse(String(stdout || "{}")) as {
      nginxEnabled: boolean;
      forceSSL: boolean;
      enableACME: boolean;
      proxyPass: string;
      hasArtifactAlias: boolean;
      acmeEmail: string;
      firewallPorts: number[];
      reviewedSourceEnv: string;
      githubKnownHosts: string;
    };
    assert.equal(out.nginxEnabled, true);
    assert.equal(out.forceSSL, true);
    assert.equal(out.enableACME, true);
    assert.equal(out.proxyPass, "http://127.0.0.1:7780");
    assert.equal(out.hasArtifactAlias, false);
    assert.equal(out.acmeEmail, "ops@example.test");
    assert.deepEqual(out.firewallPorts, [80, 443]);
    assert.match(
      out.reviewedSourceEnv,
      /BNX_DEPLOY_REVIEWED_SOURCE_SSH_KEY_FILE=\/run\/secrets\/github-reviewed-source-key/,
    );
    assert.match(
      out.reviewedSourceEnv,
      /BNX_DEPLOY_REVIEWED_SOURCE_SSH_KNOWN_HOSTS_FILE=\/etc\/deployment-host\/github-known-hosts/,
    );
    assert.match(out.githubKnownHosts, /github\.com ssh-ed25519 /);
  });
});

test("shared-host deployment service module points the worker at repo-managed Wrangler", async () => {
  await runInTemp("shared-host-deployment-service-module-wrangler", async (tmp, $) => {
    const expr = `
      let
        lib = import <nixpkgs/lib>;
        pkgs = {
          nodejs_22 = "/nix/store/test-nodejs-22";
          writeShellScript = name: text: "/nix/store/test-\${name}";
        };
        module = import ./build-tools/tools/nix/shared-host-deployment-service-module.nix {
          inherit lib pkgs;
          config = {
            deploymentHost.deploymentService = {
              enable = true;
              hostname = "deploy.example.test";
              localBindHost = "127.0.0.1";
              localBindPort = 7780;
              manageNginx = false;
              manageAcme = false;
              acmeEmail = null;
              openFirewall = false;
              reviewedSourceSsh = {
                privateKeyFile = null;
                knownHostsFile = null;
                environmentFile = "/etc/deployment-host/reviewed-source-ssh.env";
              };
            };
          };
        };
      in module.config.content.systemd.services.deployment-host-control-plane-worker.environment
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const out = JSON.parse(String(stdout || "{}")) as Record<string, string>;
    assert.deepEqual(out, {
      BNX_CLOUDFLARE_PAGES_WRANGLER_BIN: "/nix/store/test-bnx-cloudflare-pages-wrangler",
    });
  });
});

test("shared-host deployment service module rejects wildcard backend binds", async () => {
  await runInTemp("shared-host-deployment-service-module-private-bind", async (tmp, $) => {
    const expr = `
      let
        lib = import <nixpkgs/lib>;
        pkgs = {
          nodejs_22 = "/nix/store/test-nodejs-22";
          writeShellScript = name: text: "/nix/store/test-\${name}";
        };
        module = import ./build-tools/tools/nix/shared-host-deployment-service-module.nix {
          inherit lib pkgs;
          config = {
            deploymentHost.deploymentService = {
              enable = true;
              hostname = "deploy.example.test";
              localBindHost = "0.0.0.0";
              localBindPort = 7780;
              manageNginx = false;
              manageAcme = false;
              acmeEmail = null;
              openFirewall = false;
            };
          };
        };
      in builtins.elemAt module.config.content.assertions 1
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const assertion = JSON.parse(String(stdout || "{}")) as {
      assertion: boolean;
      message: string;
    };
    assert.deepEqual(assertion, {
      assertion: false,
      message: "deploymentHost.deploymentService.localBindHost must be private.",
    });
  });
});
