#!/usr/bin/env zx-wrapper
import { printDeployJson } from "./deploy-front-door";
import { readResourceGraphForOperator } from "./deploy-control-plane-operator-client";
import type { SelectedDeploymentServiceClient } from "./deployment-service-client-selection";

export async function runResourceGraphForOperator(serviceClient: SelectedDeploymentServiceClient) {
  printDeployJson(
    await readResourceGraphForOperator({
      controlPlaneUrl: serviceClient.controlPlaneUrl,
      ...(serviceClient.controlPlaneToken
        ? { controlPlaneToken: serviceClient.controlPlaneToken }
        : {}),
      ...(serviceClient.requestId ? { requestId: serviceClient.requestId } : {}),
    }),
  );
}
