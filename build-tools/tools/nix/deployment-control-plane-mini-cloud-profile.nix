{ lib, config, ... }:
let
  cfg = config.services.viberoots.miniCloudControlPlaneProfile;
  containerCfg = config.services.viberoots.deploymentControlPlaneContainer;
  opt = type: default: description: lib.mkOption { inherit type default description; };
in
{
  imports = [ ./deployment-control-plane-container-module.nix ];

  options.services.viberoots.miniCloudControlPlaneProfile = {
    enable = lib.mkEnableOption "mini cloud-shaped deployment control-plane profile";
    image = opt (lib.types.nullOr lib.types.str) null "Reviewed image reference pinned by digest.";
    publicUrl = opt (lib.types.nullOr lib.types.str) null "Mini ingress URL for the control plane.";
    publicHostName = opt (lib.types.nullOr lib.types.str) null "Mini ingress hostname.";
    artifactBucket = opt (lib.types.nullOr lib.types.str) null "External S3-compatible artifact bucket.";
    artifactRegion = opt lib.types.str "us-east-1" "S3-compatible signing region.";
    workerReplicas = opt lib.types.ints.positive 2 "Worker container count.";
    manageNginx = opt lib.types.bool true "Keep mini as ingress through nginx.";
    requireMigrationPreflight = opt lib.types.bool true "Require migration evidence during mini external database cutover.";
    credentials = opt
      (lib.types.attrsOf (lib.types.submodule {
        options.source = opt (lib.types.nullOr lib.types.str) null "Host-local credential source path.";
      }))
      { }
      "Credential sources for external Postgres, artifact storage, and deployment secrets.";
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      { assertion = cfg.image != null; message = "miniCloudControlPlaneProfile.image is required."; }
      { assertion = cfg.publicUrl != null; message = "miniCloudControlPlaneProfile.publicUrl is required."; }
      { assertion = cfg.artifactBucket != null; message = "miniCloudControlPlaneProfile.artifactBucket is required."; }
      { assertion = !(containerCfg.enable && containerCfg.instanceId != "mini"); message = "miniCloudControlPlaneProfile owns the mini instance id."; }
    ];

    services.viberoots.deploymentControlPlaneContainer = {
      enable = true;
      instanceId = "mini";
      image = lib.mkForce cfg.image;
      publicUrl = lib.mkForce cfg.publicUrl;
      publicHostName = lib.mkForce cfg.publicHostName;
      manageNginx = lib.mkForce cfg.manageNginx;
      workerReplicas = lib.mkForce cfg.workerReplicas;
      miniMigrationPreflight.enable = lib.mkForce cfg.requireMigrationPreflight;
      artifactStore = {
        bucket = lib.mkForce cfg.artifactBucket;
        region = lib.mkForce cfg.artifactRegion;
      };
      credentials = lib.mkForce cfg.credentials;
      recordsRoot = lib.mkForce "/var/lib/deployment-control-plane/external-record-cache";
      artifactStagingRoot = lib.mkForce "/var/lib/deployment-control-plane/scratch-artifacts";
      runtimeRoot = lib.mkForce "/var/lib/deployment-control-plane/runtime";
    };
  };
}
