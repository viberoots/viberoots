#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";

test("shared-host deploy auth callback module routes public HTTPS to local PKCE listener", async () => {
  await runInTemp("shared-host-deploy-auth-callback-module-eval", async (tmp, $) => {
    const expr = `
      let
        system = import <nixpkgs/nixos> {
          configuration = {
            imports = [ ./build-tools/tools/nix/shared-host-deploy-auth-callback-module.nix ];
            system.stateVersion = "24.11";
            deploymentHost.deployAuthCallback = {
              enable = true;
              hostname = "deploy-auth.example.test";
              callbackPath = "/oidc/callback";
              localBindPort = 8765;
              manageNginx = true;
              manageAcme = true;
              acmeEmail = "ops@example.test";
              openFirewall = true;
            };
          };
        };
        host = system.config.deploymentHost.deployAuthCallback.hostname;
        vhost = system.config.services.nginx.virtualHosts.\${host};
      in {
        nginxEnabled = system.config.services.nginx.enable;
        forceSSL = vhost.forceSSL;
        enableACME = vhost.enableACME;
        proxyPass = vhost.locations."/oidc/callback".proxyPass;
        acmeEmail = system.config.security.acme.defaults.email;
        firewallPorts = system.config.networking.firewall.allowedTCPPorts;
      }
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const out = JSON.parse(String(stdout || "{}")) as {
      nginxEnabled: boolean;
      forceSSL: boolean;
      enableACME: boolean;
      proxyPass: string;
      acmeEmail: string;
      firewallPorts: number[];
    };
    assert.equal(out.nginxEnabled, true);
    assert.equal(out.forceSSL, true);
    assert.equal(out.enableACME, true);
    assert.equal(out.proxyPass, "http://127.0.0.1:8765/oidc/callback");
    assert.equal(out.acmeEmail, "ops@example.test");
    assert.deepEqual(out.firewallPorts, [80, 443]);
  });
});
