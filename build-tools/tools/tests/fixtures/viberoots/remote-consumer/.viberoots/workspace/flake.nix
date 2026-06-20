{
  inputs.viberoots.url = "git+ssh://git@github.com/viberoots/viberoots.git?rev=bfe42813eb6c3427d10b219ae83dccbc1b7869f1";

  outputs = inputs:
    inputs.viberoots.lib.mkWorkspace {
      workspaceSrc = ../..;
      viberootsInput = inputs.viberoots;
      workspaceName = "remote-consumer";
    };
}
