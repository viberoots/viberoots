{ cfg, credentialFile }:
let
  defaults = import ./deployment-control-plane-container-defaults.nix;
  reviewedSource =
    if cfg.reviewedSourceMode == "github-app" then {
      mode = "github-app";
      githubAppIdFile = credentialFile cfg.reviewedSourceGithubAppIdCredential;
      githubAppInstallationIdFile =
        credentialFile cfg.reviewedSourceGithubAppInstallationIdCredential;
      githubAppPrivateKeyFile = credentialFile cfg.reviewedSourceGithubAppPrivateKeyCredential;
    } else {
      mode = "ssh";
      sshKeyFile = credentialFile cfg.reviewedSourceSshKeyCredential;
      sshKnownHostsFile = credentialFile cfg.reviewedSourceKnownHostsCredential;
    };
in
{
  instanceId = cfg.instanceId;
  mode = "protected-shared";
  service = {
    host = cfg.serviceHost;
    port = cfg.port;
    publicUrl = cfg.publicUrl;
    tokenFile = credentialFile cfg.controlPlaneTokenCredential;
  };
  storage = {
    recordsRoot = defaults.recordsRoot;
    artifactStagingRoot = defaults.artifactStagingRoot;
    runtimeRoot = defaults.runtimeRoot;
    artifactStore = {
      kind = cfg.artifactStore.kind;
      bucket = cfg.artifactStore.bucket;
      region = cfg.artifactStore.region;
      endpointFile = credentialFile cfg.artifactStore.endpointCredential;
      accessKeyIdFile = credentialFile cfg.artifactStore.accessKeyIdCredential;
      secretAccessKeyFile = credentialFile cfg.artifactStore.secretAccessKeyCredential;
    };
  };
  database.urlFile = credentialFile cfg.databaseUrlCredential;
  credentials = {
    directory = cfg.credentialDirectory;
    defaults = {
      infisicalClientIdFilePattern = cfg.infisicalCredentialFilePattern.clientId;
      infisicalClientSecretFilePattern = cfg.infisicalCredentialFilePattern.clientSecret;
    };
    infisicalDeployments = map
      (deploymentId: {
        inherit deploymentId;
        siteUrl = cfg.infisicalSiteUrl;
        projectId = "${deploymentId}-infisical-project";
        environment = cfg.infisicalEnvironment;
      })
      cfg.infisicalDeploymentIds;
  };
  inherit reviewedSource;
  webUi = { enabled = cfg.webUi.enable; basePath = cfg.webUi.basePath; };
  mcp = { enabled = cfg.mcp.enable; basePath = cfg.mcp.basePath; };
  miniMigrationPreflight = { enabled = cfg.miniMigrationPreflight.enable; };
}
