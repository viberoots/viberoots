# 3. Kubernetes Cluster Provisioning

**Tier:** Foundation
**Priority:** 3 of 44
**Depends on:** none
**Estimated effort:** S
**Date:** 2026-05-25
**Summary:** Provision a Kubernetes cluster and prepare it with the namespaces, RBAC, and cluster add-ons required to host the containerized control plane.

## What

Stand up a Kubernetes cluster that task #7 (Simple Kubernetes / OpenTofu Deployment) can target, and configure it to the minimum viable state required by the control plane's deployment contract.

Concrete steps:

- Select a cloud provider and cluster topology (see Trade-offs) and provision the cluster via OpenTofu or the provider's CLI.
- Create a dedicated namespace for the control plane (`control-plane` or equivalent).
- Configure RBAC: a service account for the control plane deployment, roles scoped to that namespace, and a kubeconfig that CI and the deploy tooling can use.
- Install required cluster add-ons: an ingress controller (nginx or cloud-native), a storage class for PersistentVolumeClaims if the control plane needs persistent volumes, and cert-manager if TLS certificate provisioning is managed in-cluster.
- Verify that the deploy tooling (`kubectl`, `helm`) can reach the cluster from both a developer workstation and a CI context.
- Register the kubeconfig and any cluster-scoped credentials in Infisical using the canonical SprinkleRef path so task #7 can resolve them through the credential contract.
- Document the cluster topology, add-on versions, and RBAC model in a runbook.

## Why Now

Task #7 (Simple Kubernetes / OpenTofu Deployment to Bundle Control Plane) describes deploying the containerized control plane to a Kubernetes cluster using the existing Helm-based provider. That task assumes a cluster exists and is reachable. Without a provisioned cluster and a registered kubeconfig, task #7 cannot begin. Provisioning the cluster separately keeps task #7 focused on the deployment automation rather than cluster bootstrapping.

## Risks

- **Cloud provider lock-in.** Choosing EKS, GKE, or AKS at provisioning time creates an implicit dependency on that provider's networking, storage, and IAM model. The control plane's credential contract uses file mounts rather than cloud-provider IAM injection, which reduces this lock-in, but the ingress and storage class selections may not be portable.
- **Networking for ingress.** The control plane service endpoint must be reachable by the deploy CLI and by CI. If the cluster is provisioned in a VPC without a public load balancer, additional networking configuration (NAT, VPN, or a tunneling solution) is required before the deploy tooling can reach it.
- **kubeconfig credential rotation.** Long-lived kubeconfig credentials are a security risk. If the cluster uses short-lived tokens (IRSA on EKS, Workload Identity on GKE), the credential resolution path must be tested end-to-end before task #7 relies on it.

## Trade-offs

- **Managed cluster (EKS, GKE, AKS) vs. lightweight self-managed (k3s, k0s).** A managed cluster offloads control-plane upgrades and node pool scaling but costs more and adds cloud-provider dependencies. A lightweight self-managed cluster (k3s on a VPS) is cheaper and faster to provision but requires manual upgrades and has a smaller community of operators. Given that the Kubernetes cluster is the control plane host rather than a production workload substrate, a managed cluster is the more operationally sustainable choice.
- **Single cluster for all environments vs. separate dev/staging/prod clusters.** A single cluster with per-environment namespaces is simpler to operate and cheaper, but namespace isolation is weaker than cluster isolation. Separate clusters provide stronger boundaries but multiply provisioning and credential management overhead. A single cluster with namespace-scoped RBAC is a reasonable starting point; cluster separation can be introduced later if isolation requirements tighten.

## Considerations

- The Infisical Kubernetes Operator can sync Infisical secrets directly into Kubernetes `Secret` objects, eliminating the need for file-mount workarounds when running inside the cluster. Evaluate whether to install it as part of this provisioning task or defer to task #7.
- The control plane's NixOS container module uses `virtualisation.oci-containers` (Podman), which is not the Kubernetes runtime model. When deploying to Kubernetes via the Helm provider, the image is pulled by containerd or Docker, not Podman. Confirm the OCI image produced by task #6 (Containerize Control Plane) is compatible with the cluster's container runtime before task #7 begins.
- The cluster's ingress controller must be configured to terminate TLS for the control plane service endpoint. If cert-manager is used, register the ACME issuer and confirm DNS ownership before task #7 provisions the ingress resource.
- OpenTofu resources for the cluster itself (node pools, networking, IAM) should live under `projects/infra/kubernetes/` so they are tracked alongside the control plane deployment resources that task #7 will add.
