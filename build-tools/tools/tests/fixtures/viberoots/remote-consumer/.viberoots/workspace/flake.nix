{
  inputs.viberoots.url = "github:viberoots/viberoots/v1.4.2";

  outputs = inputs:
    inputs.viberoots.lib.mkWorkspace {
      workspaceSrc = ../..;
      viberootsInput = inputs.viberoots;
      workspaceName = "remote-consumer";
    };
}
