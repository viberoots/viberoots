locals {
  ingress_is_alb          = var.ingress_type == "alb"
  ingress_protocol        = local.ingress_is_alb ? "HTTP" : "TCP"
  ingress_health_path     = local.ingress_is_alb ? "/readyz" : null
  ingress_client_cidrs    = length(var.ingress_allowed_client_cidrs) > 0 ? var.ingress_allowed_client_cidrs : ["127.0.0.1/32"]
  ingress_lb_subnet_ids   = [for subnet in aws_subnet.public : subnet.id]
  ingress_managed_cert    = var.ingress_enabled && trimspace(var.ingress_certificate_arn) == ""
  ingress_certificate_arn = local.ingress_managed_cert ? aws_acm_certificate.control_plane[0].arn : var.ingress_certificate_arn
}

data "aws_caller_identity" "current" {}

resource "aws_security_group_rule" "load_balancer_https_ingress" {
  for_each          = var.ingress_enabled && local.ingress_is_alb ? toset(local.ingress_client_cidrs) : []
  type              = "ingress"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = [each.value]
  security_group_id = aws_security_group.load_balancer.id
}

resource "aws_security_group_rule" "load_balancer_to_service" {
  count                    = var.ingress_enabled && local.ingress_is_alb ? 1 : 0
  type                     = "ingress"
  from_port                = var.ingress_service_port
  to_port                  = var.ingress_service_port
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.load_balancer.id
  security_group_id        = aws_security_group.service.id
}

resource "aws_lb" "control_plane" {
  count              = var.ingress_enabled ? 1 : 0
  name_prefix        = substr(replace(var.name_prefix, "-", ""), 0, 6)
  internal           = false
  load_balancer_type = local.ingress_is_alb ? "application" : "network"
  subnets            = local.ingress_lb_subnet_ids
  security_groups    = local.ingress_is_alb ? [aws_security_group.load_balancer.id] : null
}

resource "aws_acm_certificate" "control_plane" {
  count                     = local.ingress_managed_cert ? 1 : 0
  domain_name               = var.ingress_public_host
  subject_alternative_names = var.ingress_public_host == var.ingress_callback_host ? [] : [var.ingress_callback_host]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "certificate_validation" {
  for_each = local.ingress_managed_cert && trimspace(var.ingress_route53_zone_id) != "" ? {
    for option in aws_acm_certificate.control_plane[0].domain_validation_options : option.domain_name => {
      name   = option.resource_record_name
      record = option.resource_record_value
      type   = option.resource_record_type
    }
  } : {}

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = var.ingress_route53_zone_id
}

resource "aws_acm_certificate_validation" "control_plane" {
  count                   = length(aws_route53_record.certificate_validation) > 0 ? 1 : 0
  certificate_arn         = aws_acm_certificate.control_plane[0].arn
  validation_record_fqdns = [for record in aws_route53_record.certificate_validation : record.fqdn]
}

resource "aws_lb_target_group" "control_plane" {
  count       = var.ingress_enabled ? 1 : 0
  name_prefix = substr(replace(var.name_prefix, "-", ""), 0, 6)
  port        = var.ingress_service_port
  protocol    = local.ingress_protocol
  vpc_id      = local.vpc_id

  health_check {
    enabled  = true
    protocol = local.ingress_protocol
    port     = "traffic-port"
    path     = local.ingress_health_path
    matcher  = local.ingress_is_alb ? "200" : null
  }
}

resource "aws_lb_target_group_attachment" "control_plane" {
  count            = var.ingress_enabled && trimspace(var.ingress_target_instance_id) != "" ? 1 : 0
  target_group_arn = aws_lb_target_group.control_plane[0].arn
  target_id        = var.ingress_target_instance_id
  port             = var.ingress_service_port
}

resource "aws_lb_listener" "https" {
  count             = var.ingress_enabled ? 1 : 0
  load_balancer_arn = aws_lb.control_plane[0].arn
  port              = 443
  protocol          = local.ingress_is_alb ? "HTTPS" : "TLS"
  certificate_arn   = local.ingress_certificate_arn
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.control_plane[0].arn
  }

  depends_on = [aws_acm_certificate_validation.control_plane]
}

resource "aws_lb_listener_rule" "auth_callback" {
  count        = var.ingress_enabled && local.ingress_is_alb ? 1 : 0
  listener_arn = aws_lb_listener.https[0].arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.control_plane[0].arn
  }

  condition {
    host_header {
      values = [var.ingress_callback_host]
    }
  }

  condition {
    path_pattern {
      values = [var.ingress_callback_path]
    }
  }
}

resource "aws_route53_record" "public" {
  count   = var.ingress_enabled && trimspace(var.ingress_route53_zone_id) != "" ? 1 : 0
  zone_id = var.ingress_route53_zone_id
  name    = var.ingress_public_host
  type    = "A"

  alias {
    name                   = aws_lb.control_plane[0].dns_name
    zone_id                = aws_lb.control_plane[0].zone_id
    evaluate_target_health = true
  }
}

resource "aws_wafv2_web_acl" "control_plane" {
  count = var.ingress_enabled && local.ingress_is_alb && var.ingress_waf_enabled ? 1 : 0
  name  = "${var.name_prefix}-ingress"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name_prefix}-ingress"
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "control_plane" {
  count        = var.ingress_enabled && local.ingress_is_alb && var.ingress_waf_enabled ? 1 : 0
  resource_arn = aws_lb.control_plane[0].arn
  web_acl_arn  = aws_wafv2_web_acl.control_plane[0].arn
}
