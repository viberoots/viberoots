{ lib, config, ... }:
let
  defaults = import ./deployment-control-plane-container-defaults.nix;
  cfg = config.services.viberoots.deploymentControlPlaneContainer;
  opt = type: default: description: lib.mkOption { inherit type default description; };
  nullStr = lib.types.nullOr lib.types.str;
  configFile = defaults.configFile;
  configEtcName = lib.removePrefix "/etc/" configFile;
  imageRef =
    if cfg.image != null then cfg.image
    else if cfg.imageRegistry == null || cfg.imageRepository == null || cfg.imageDigest == null then ""
    else "${cfg.imageRegistry}/${cfg.imageRepository}@${cfg.imageDigest}";
  credentialSource = name:
    if builtins.hasAttr name cfg.credentials then cfg.credentials.${name}.source else cfg.extraCredentialFiles.${name};
  configuredCredentialNames = lib.unique (builtins.attrNames cfg.credentials ++ builtins.attrNames cfg.extraCredentialFiles);
  credentialNames = lib.unique (
    [
      cfg.databaseUrlCredential
      cfg.controlPlaneTokenCredential
      cfg.reviewedSourceSshKeyCredential
      cfg.artifactStore.endpointCredential
      cfg.artifactStore.accessKeyIdCredential
      cfg.artifactStore.secretAccessKeyCredential
    ]
    ++ configuredCredentialNames
  );
  credentialMounts = map
    (name: "${credentialSource name}:${cfg.credentialDirectory}/${name}:ro")
    credentialNames;
  loadCredentials = map (name: "${name}:${credentialSource name}") credentialNames;
  requiredCredentialNames = [
    cfg.databaseUrlCredential
    cfg.controlPlaneTokenCredential
    cfg.reviewedSourceSshKeyCredential
    cfg.artifactStore.endpointCredential
    cfg.artifactStore.accessKeyIdCredential
    cfg.artifactStore.secretAccessKeyCredential
  ];
  missingCredentialNames = lib.filter
    (name: !(builtins.hasAttr name cfg.credentials) && !(builtins.hasAttr name cfg.extraCredentialFiles))
    requiredCredentialNames;
  nullCredentialNames = lib.filter (name: credentialSource name == null) configuredCredentialNames;
  credentialFile = name: "${cfg.credentialDirectory}/${name}";
  renderedConfig = {
    instanceId = cfg.instanceId;
    mode = "protected-shared";
    service = {
      host = "0.0.0.0";
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
    };
    reviewedSource = {
      sshKeyFile = credentialFile cfg.reviewedSourceSshKeyCredential;
      sshKnownHostsFile = cfg.reviewedSourceKnownHostsFile;
    };
    webUi = { enabled = cfg.webUi.enable; basePath = cfg.webUi.basePath; };
    mcp = { enabled = cfg.mcp.enable; basePath = cfg.mcp.basePath; };
  };
  baseVolumes = [
    "${configFile}:${configFile}:ro"
    "${cfg.recordsRoot}:${defaults.recordsRoot}:rw"
    "${cfg.artifactStagingRoot}:${defaults.artifactStagingRoot}:rw"
    "${cfg.runtimeRoot}:${defaults.runtimeRoot}:rw"
  ] ++ credentialMounts;
  containerFor = mode: {
    image = imageRef;
    autoStart = true;
    volumes = baseVolumes;
    environment = lib.optionalAttrs (cfg.imageDigest != null) {
      VBR_CONTROL_PLANE_IMAGE_DIGEST = cfg.imageDigest;
    };
    cmd = [ "deployment-control-plane" mode "--config" configFile ];
  };
  healthCmd =
    "node -e 'fetch(\"http://127.0.0.1:${toString cfg.port}/healthz\")"
    + ".then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'";
  serviceContainer = containerFor "service" // {
    ports = [ "${cfg.bindAddress}:${toString cfg.port}:${toString cfg.port}" ];
    extraOptions = [
      "--health-cmd=${healthCmd}"
      "--health-interval=30s"
      "--health-timeout=5s"
      "--health-retries=3"
    ];
  };
  workerIndexes = lib.range 1 cfg.workerReplicas;
  workerNames = map (index: "${defaults.workerContainerNamePrefix}-${toString index}") workerIndexes;
  workerContainers = lib.listToAttrs (
    map (name: lib.nameValuePair name (containerFor "worker")) workerNames
  );
  allContainerNames = [ defaults.serviceContainerName ] ++ workerNames;
  systemdCredentialServices = lib.listToAttrs (
    map
      (name: lib.nameValuePair "${cfg.containerRuntime}-${name}" {
        serviceConfig.LoadCredential = loadCredentials;
      })
      allContainerNames
  );
in
{
  options.services.viberoots.deploymentControlPlaneContainer = {
    enable = lib.mkEnableOption "containerized deployment control plane";
    instanceId = opt nullStr null "Control-plane instance id.";
    image = opt nullStr null "Complete reviewed image reference.";
    imageRegistry = opt nullStr null "Image registry when image is assembled from parts.";
    imageRepository = opt nullStr null "Image repository when image is assembled from parts.";
    imageDigest = opt nullStr null "Immutable image digest when image is assembled from parts.";
    publicUrl = opt nullStr null "Externally routed service URL.";
    publicHostName = opt nullStr null "Optional hostname for managed nginx.";
    bindAddress = opt lib.types.str defaults.bindAddress "Host bind address.";
    port = opt lib.types.port defaults.servicePort "Host and container service port.";
    containerRuntime = opt (lib.types.enum [ "podman" "docker" ]) defaults.containerRuntime "OCI runtime.";
    workerReplicas = opt lib.types.ints.positive defaults.workerReplicas "Worker container count.";
    webUi.enable = opt lib.types.bool true "Whether the web UI is enabled.";
    webUi.basePath = opt lib.types.str defaults.webUiBasePath "Web UI base path.";
    mcp.enable = opt lib.types.bool true "Whether HTTP MCP is enabled.";
    mcp.basePath = opt lib.types.str defaults.mcpBasePath "HTTP MCP base path.";
    recordsRoot = opt lib.types.str defaults.recordsRoot "Host records directory.";
    artifactStagingRoot = opt lib.types.str defaults.artifactStagingRoot "Host artifact scratch directory.";
    runtimeRoot = opt lib.types.str defaults.runtimeRoot "Host runtime scratch directory.";
    credentialDirectory = opt lib.types.str defaults.credentialDirectory "Container credential directory.";
    reviewedSourceKnownHostsFile = opt lib.types.str "/etc/deployment-control-plane/github-known-hosts" "Known hosts file.";
    databaseUrlCredential = opt lib.types.str defaults.databaseUrlCredential "Database credential name.";
    controlPlaneTokenCredential = opt lib.types.str defaults.controlPlaneTokenCredential "Reviewed service bearer token credential name.";
    reviewedSourceSshKeyCredential = opt lib.types.str defaults.reviewedSourceSshKeyCredential "SSH key credential name.";
    artifactStore = {
      kind = opt (lib.types.enum [ "s3-compatible" ]) defaults.artifactStoreKind "Artifact store kind.";
      bucket = opt nullStr null "Artifact store bucket.";
      endpointCredential = opt lib.types.str defaults.artifactEndpointCredential "Endpoint credential name.";
      accessKeyIdCredential = opt lib.types.str defaults.artifactAccessKeyIdCredential "Access key credential name.";
      secretAccessKeyCredential = opt lib.types.str defaults.artifactSecretAccessKeyCredential "Secret key credential name.";
    };
    infisicalCredentialFilePattern.clientId = opt lib.types.str defaults.infisicalClientIdPattern "Infisical client id pattern.";
    infisicalCredentialFilePattern.clientSecret = opt lib.types.str defaults.infisicalClientSecretPattern "Infisical client secret pattern.";
    credentials = opt (lib.types.attrsOf (lib.types.submodule {
      options.source = opt nullStr null "Host-local credential source path.";
    })) { } "Credential source files.";
    extraCredentialFiles = opt (lib.types.attrsOf lib.types.str) { } "Additional credential source files.";
    manageNginx = opt lib.types.bool false "Manage nginx for the public hostname.";
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      { assertion = cfg.instanceId != null; message = "deploymentControlPlaneContainer.instanceId is required."; }
      { assertion = cfg.publicUrl != null; message = "deploymentControlPlaneContainer.publicUrl is required."; }
      { assertion = cfg.image != null || (cfg.imageRegistry != null && cfg.imageRepository != null && cfg.imageDigest != null); message = "deploymentControlPlaneContainer requires image or imageRegistry/imageRepository/imageDigest."; }
      { assertion = cfg.artifactStore.bucket != null; message = "deploymentControlPlaneContainer.artifactStore.bucket is required."; }
      { assertion = missingCredentialNames == [ ]; message = "deploymentControlPlaneContainer missing credential sources: ${lib.concatStringsSep ", " missingCredentialNames}"; }
      { assertion = nullCredentialNames == [ ]; message = "deploymentControlPlaneContainer credential sources must not be null: ${lib.concatStringsSep ", " nullCredentialNames}"; }
      { assertion = !cfg.manageNginx || cfg.publicHostName != null; message = "deploymentControlPlaneContainer.publicHostName is required when manageNginx = true."; }
    ];
    users.groups.${defaults.group} = { };
    users.users.${defaults.user} = {
      isSystemUser = true;
      group = defaults.group;
    };
    systemd.tmpfiles.rules = map
      (path: "d ${path} 0750 ${defaults.user} ${defaults.group} -")
      [ cfg.recordsRoot cfg.artifactStagingRoot cfg.runtimeRoot ];
    environment.etc.${configEtcName}.text = builtins.toJSON renderedConfig + "\n";
    virtualisation.oci-containers.backend = cfg.containerRuntime;
    virtualisation.oci-containers.containers =
      { ${defaults.serviceContainerName} = serviceContainer; } // workerContainers;
    systemd.services = systemdCredentialServices;
    services.nginx = lib.mkIf cfg.manageNginx {
      enable = true;
      virtualHosts.${cfg.publicHostName}.locations."/".proxyPass =
        "http://${cfg.bindAddress}:${toString cfg.port}";
    };
  };
}
