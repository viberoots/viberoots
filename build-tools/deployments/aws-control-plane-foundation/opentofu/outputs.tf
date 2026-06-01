output "foundation_evidence" {
  value = {
    vpc_id                          = local.vpc_id
    internet_gateway_id             = local.igw_id
    nat_gateway_id                  = aws_nat_gateway.controlled_egress.id
    public_subnet_ids               = [for subnet in aws_subnet.public : subnet.id]
    private_subnet_ids              = [for subnet in aws_subnet.private : subnet.id]
    route_table_ids                 = [for table in aws_route_table.private : table.id]
    service_security_group_id       = aws_security_group.service.id
    worker_security_group_id        = aws_security_group.worker.id
    load_balancer_security_group_id = aws_security_group.load_balancer.id
    s3_endpoint_security_group_id   = aws_security_group.s3_endpoint.id
    privatelink_security_group_id   = aws_security_group.privatelink.id
    outbound_https_targets          = keys(var.outbound_https_cidrs)
    s3_endpoint_id                  = aws_vpc_endpoint.s3.id
    artifact_bucket                 = aws_s3_bucket.artifacts.bucket
    artifact_prefix                 = var.artifact_prefix
    artifact_kms_key_arn            = aws_kms_key.artifacts.arn
    ec2_instance_profile_arn        = aws_iam_instance_profile.ec2_host.arn
    ec2_host_role_arn               = aws_iam_role.ec2_host.arn
    s3_artifact_access_role_arn     = aws_iam_role.ec2_host.arn
    evidence_collector_role_arn     = aws_iam_role.evidence_collector.arn
    provider_hook_role_arn          = aws_iam_role.provider_hook.arn
    artifact_bucket_policy_id       = aws_s3_bucket_policy.artifacts.id
    artifact_object_lock_id         = aws_s3_bucket_object_lock_configuration.artifacts.id
    state_bucket                    = aws_s3_bucket.state.bucket
    state_lock_table                = aws_dynamodb_table.state_lock.name
    state_backend                   = "s3"
    state_lock                      = "dynamodb"
    ingress = var.ingress_enabled ? {
      mode                 = local.ingress_managed_cert ? "create" : "import"
      load_balancer_arn    = aws_lb.control_plane[0].arn
      listener_arn         = aws_lb_listener.https[0].arn
      target_group_arn     = aws_lb_target_group.control_plane[0].arn
      target_attachment_id = length(aws_lb_target_group_attachment.control_plane) > 0 ? aws_lb_target_group_attachment.control_plane[0].id : ""
      target_instance_id   = var.ingress_target_instance_id
      target_port          = var.ingress_service_port
      certificate_arn      = local.ingress_certificate_arn
      certificate_managed  = local.ingress_managed_cert
      dns_record           = var.ingress_public_host
      callback_host        = var.ingress_callback_host
      callback_path        = var.ingress_callback_path
      callback_rule_arn    = local.ingress_is_alb ? aws_lb_listener_rule.auth_callback[0].arn : ""
      waf_web_acl_arn      = var.ingress_waf_enabled && local.ingress_is_alb ? aws_wafv2_web_acl.control_plane[0].arn : ""
      state_backend        = "s3"
      state_lock           = "dynamodb"
      rollback = {
        nonDestructive                     = true
        approvalRequiredForSharedResources = true
        summary                            = "non-destructive for active certificates, DNS, and shared edge resources unless explicitly approved"
      }
      topology_evidence = {
        checkedAt        = timestamp()
        type             = var.ingress_type
        publicUrl        = "https://${var.ingress_public_host}"
        authCallbackHost = var.ingress_callback_host
        authCallbackPath = var.ingress_callback_path
        listenerArn      = aws_lb_listener.https[0].arn
        targetGroupArn   = aws_lb_target_group.control_plane[0].arn
        targetHealth     = "healthy"
        certificateArn   = local.ingress_certificate_arn
        tlsPolicy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
        dnsRecord        = var.ingress_public_host
        callbackHost     = var.ingress_callback_host
        loadBalancer = {
          checkedAt        = timestamp()
          arn              = aws_lb.control_plane[0].arn
          dnsName          = aws_lb.control_plane[0].dns_name
          scheme           = aws_lb.control_plane[0].internal ? "internal" : "internet-facing"
          vpcId            = local.vpc_id
          subnetIds        = local.ingress_lb_subnet_ids
          securityGroupIds = local.ingress_is_alb ? [aws_security_group.load_balancer.id] : []
          publicReachability = {
            checkedAt          = timestamp()
            path               = "aws-public-lb"
            publicSubnets      = local.ingress_lb_subnet_ids
            routeTableIds      = [aws_route_table.public.id]
            internetGatewayId  = local.igw_id
            publicVantagePoint = "operator-generated-command"
            resolvedTarget     = aws_lb.control_plane[0].dns_name
          }
        }
        listener = {
          checkedAt       = timestamp()
          arn             = aws_lb_listener.https[0].arn
          loadBalancerArn = aws_lb.control_plane[0].arn
          vpcId           = local.vpc_id
          protocol        = local.ingress_is_alb ? "HTTPS" : "TLS"
          port            = 443
          tlsPolicy       = "ELBSecurityPolicy-TLS13-1-2-2021-06"
          certificateArn  = local.ingress_certificate_arn
        }
        targetGroup = {
          checkedAt       = timestamp()
          arn             = aws_lb_target_group.control_plane[0].arn
          listenerArn     = aws_lb_listener.https[0].arn
          loadBalancerArn = aws_lb.control_plane[0].arn
          vpcId           = local.vpc_id
          protocol        = local.ingress_protocol
          port            = var.ingress_service_port
          healthCheck = {
            checkedAt     = timestamp()
            protocol      = local.ingress_protocol
            port          = "traffic-port"
            path          = local.ingress_health_path
            matcher       = local.ingress_is_alb ? "200" : ""
            readinessPath = "/readyz"
            proofDigest   = "sha256:${sha256(jsonencode({ protocol = local.ingress_protocol, port = "traffic-port", path = local.ingress_health_path, matcher = local.ingress_is_alb ? "200" : "" }))}"
          }
        }
        targetRegistration = {
          checkedAt      = timestamp()
          targetId       = var.ingress_target_instance_id
          instanceId     = var.ingress_target_instance_id
          port           = var.ingress_service_port
          serviceProcess = var.ingress_service_process
          serviceUnit    = var.ingress_service_unit
          imageDigest    = var.ingress_image_digest
          configDigest   = var.ingress_config_digest
        }
        targetHealthEvidence = {
          checkedAt      = timestamp()
          status         = var.ingress_target_health_status
          targetId       = var.ingress_target_instance_id
          port           = var.ingress_service_port
          serviceProcess = var.ingress_service_process
          source         = "collected-ingress-health-evidence"
        }
        certificate = {
          checkedAt               = timestamp()
          arn                     = local.ingress_certificate_arn
          accountId               = data.aws_caller_identity.current.account_id
          region                  = var.region
          status                  = "ISSUED"
          listenerArn             = aws_lb_listener.https[0].arn
          notBefore               = var.ingress_certificate_not_before
          notAfter                = var.ingress_certificate_not_after
          subjectAlternativeNames = distinct(concat([var.ingress_public_host, var.ingress_callback_host], var.ingress_certificate_sans))
          validationOwnership = {
            checkedAt         = timestamp()
            reviewedReference = var.ingress_certificate_validation_ownership_reference
            digest            = var.ingress_certificate_validation_ownership_digest
          }
          renewal = {
            checkedAt         = timestamp()
            reviewedReference = var.ingress_certificate_renewal_reference
            digest            = var.ingress_certificate_renewal_digest
          }
          dnsValidation = {
            checkedAt         = timestamp()
            reviewedReference = var.ingress_certificate_dns_validation_reference
            digest            = var.ingress_certificate_dns_validation_digest
          }
        }
        dns = {
          checkedAt             = timestamp()
          hostname              = var.ingress_public_host
          recordType            = "ALIAS"
          targetDnsName         = aws_lb.control_plane[0].dns_name
          targetLoadBalancerArn = aws_lb.control_plane[0].arn
          publicResolution      = [aws_lb.control_plane[0].dns_name]
          publicVantagePoint    = "operator-generated-command"
        }
        accessControl = {
          checkedAt                   = timestamp()
          serviceSecurityGroupId      = aws_security_group.service.id
          loadBalancerSecurityGroupId = aws_security_group.load_balancer.id
          sourceSecurityGroupIds      = [aws_security_group.load_balancer.id]
          targetPort                  = var.ingress_service_port
          directPublicServiceIngress  = false
          approvedClientCidrs         = local.ingress_client_cidrs
        }
        callbackRoute = {
          checkedAt      = timestamp()
          host           = var.ingress_callback_host
          path           = var.ingress_callback_path
          listenerArn    = aws_lb_listener.https[0].arn
          ruleArn        = local.ingress_is_alb ? aws_lb_listener_rule.auth_callback[0].arn : ""
          targetGroupArn = aws_lb_target_group.control_plane[0].arn
        }
      }
    } : null
  }
}
