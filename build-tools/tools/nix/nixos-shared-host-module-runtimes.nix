{ pkgs, ... }:
let
  staticRuntime = {
    runtime = "static-app-host";
    publishRoot = "/srv/static-app/current";
    releaseRoot = "/srv/static-app/releases";
    activeReleaseLink = "/srv/static-app/live";
    serverEntry = null;
    clientDir = null;
  };

  ssrRuntime = {
    runtime = "ssr-webapp-host";
    publishRoot = "/srv/ssr-app/current";
    releaseRoot = "/srv/ssr-app/releases";
    activeReleaseLink = "/srv/ssr-app/live";
    serverEntry = "/srv/ssr-app/live/dist/server/index.js";
    clientDir = "/srv/ssr-app/live/dist/client";
  };

  staticContainerConfig = port: {
    system.stateVersion = "24.11";
    networking.firewall.allowedTCPPorts = [ port ];
    services.nginx = {
      enable = true;
      virtualHosts.localhost = {
        listen = [
          {
            addr = "0.0.0.0";
            port = port;
          }
        ];
        root = "/srv/static-app/live";
        locations."/" = {
          tryFiles = "$uri $uri/ /index.html";
        };
      };
    };
    systemd.tmpfiles.rules = [
      "d /srv/static-app 0755 root root -"
      "d /srv/static-app/releases 0755 root root -"
      "d /srv/static-app/releases/.empty 0755 root root -"
      "L+ /srv/static-app/current - - - - /srv/static-app/releases/.empty"
      "L+ /srv/static-app/live - - - - /srv/static-app/current"
    ];
  };

  ssrContainerConfig = port: {
    system.stateVersion = "24.11";
    networking.firewall.allowedTCPPorts = [ port ];
    environment.systemPackages = [ pkgs.nodejs ];
    systemd.services.nixos-shared-host-app = {
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        WorkingDirectory = "/srv/ssr-app/live";
        ExecStart = "${pkgs.nodejs}/bin/node /srv/ssr-app/live/dist/server/index.js";
        Restart = "always";
      };
      environment = {
        PORT = toString port;
        HOST = "0.0.0.0";
      };
    };
    systemd.tmpfiles.rules = [
      "d /srv/ssr-app 0755 root root -"
      "d /srv/ssr-app/releases 0755 root root -"
      "d /srv/ssr-app/releases/.empty 0755 root root -"
      "L+ /srv/ssr-app/current - - - - /srv/ssr-app/releases/.empty"
      "L+ /srv/ssr-app/live - - - - /srv/ssr-app/current"
    ];
  };
in
{
  containerRuntimeFor = deployment:
    if deployment.component.kind == "ssr-webapp" then ssrRuntime else staticRuntime;

  containerConfigFor = entry:
    if entry.deployment.component.kind == "ssr-webapp" then
      ssrContainerConfig entry.deployment.runtime.containerPort
    else
      staticContainerConfig entry.deployment.runtime.containerPort;
}
