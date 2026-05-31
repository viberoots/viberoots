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
  authProvider = {
    kind = cfg.authProvider.kind;
    issuer = cfg.authProvider.issuer;
    audience = cfg.authProvider.audience;
    tokenSupport = "jwt";
    cliLoginMode = cfg.authProvider.cliLoginMode;
    callback = {
      externalHost = cfg.authProvider.callback.externalHost;
      externalPath = cfg.authProvider.callback.externalPath;
    };
    claims = cfg.authProvider.claims;
    roleGroups = cfg.authProvider.roleGroups;
    servicePrincipals = cfg.authProvider.servicePrincipals;
  } // (if cfg.authProvider.jwksUrl == null then { } else { jwksUrl = cfg.authProvider.jwksUrl; });
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
      provider = cfg.artifactStore.provider;
      credentialMode = cfg.artifactStore.credentialMode;
      bucket = cfg.artifactStore.bucket;
      region = cfg.artifactStore.region;
      endpointFile = credentialFile cfg.artifactStore.endpointCredential;
    } // (if cfg.artifactStore.credentialMode == "files" then {
      accessKeyIdFile = credentialFile cfg.artifactStore.accessKeyIdCredential;
      secretAccessKeyFile = credentialFile cfg.artifactStore.secretAccessKeyCredential;
    } else { });
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
  inherit authProvider;
  webUi = { enabled = cfg.webUi.enable; basePath = cfg.webUi.basePath; };
  mcp = { enabled = cfg.mcp.enable; basePath = cfg.mcp.basePath; };
  miniMigrationPreflight = { enabled = cfg.miniMigrationPreflight.enable; };
}
