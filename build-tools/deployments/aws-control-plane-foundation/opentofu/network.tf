locals {
  create_vpc = trimspace(var.existing_vpc_id) == ""
  create_igw = trimspace(var.existing_internet_gateway_id) == ""
  vpc_id     = local.create_vpc ? aws_vpc.control_plane[0].id : var.existing_vpc_id
  igw_id     = local.create_igw ? aws_internet_gateway.control_plane[0].id : var.existing_internet_gateway_id
  service_worker_security_groups = {
    service = aws_security_group.service.id
    worker  = aws_security_group.worker.id
  }
  outbound_https_rules = merge([
    for security_group_name, security_group_id in local.service_worker_security_groups : {
      for rule in flatten([
        for target, cidrs in var.outbound_https_cidrs : [
          for cidr in cidrs : {
            key               = "${security_group_name}-${target}-${replace(replace(cidr, "/", "-"), ".", "-")}"
            target            = target
            cidr              = cidr
            security_group_id = security_group_id
          }
        ]
      ]) : rule.key => rule
    }
  ]...)
}

resource "aws_vpc" "control_plane" {
  count                = local.create_vpc ? 1 : 0
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
}

resource "aws_subnet" "private" {
  for_each                = var.private_subnet_cidrs
  vpc_id                  = local.vpc_id
  cidr_block              = each.value
  availability_zone       = var.availability_zones[each.key]
  map_public_ip_on_launch = false
}

resource "aws_subnet" "public" {
  for_each                = var.public_subnet_cidrs
  vpc_id                  = local.vpc_id
  cidr_block              = each.value
  availability_zone       = var.availability_zones[each.key]
  map_public_ip_on_launch = true
}

resource "aws_internet_gateway" "control_plane" {
  count  = local.create_igw ? 1 : 0
  vpc_id = local.vpc_id
}

resource "aws_route_table" "public" {
  vpc_id = local.vpc_id
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = local.igw_id
}

resource "aws_route_table_association" "public" {
  for_each       = aws_subnet.public
  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_eip" "nat" {
  domain = "vpc"
}

resource "aws_nat_gateway" "controlled_egress" {
  allocation_id = aws_eip.nat.id
  subnet_id     = values(aws_subnet.public)[0].id
  depends_on    = [aws_internet_gateway.control_plane]
}

resource "aws_route_table" "private" {
  for_each = aws_subnet.private
  vpc_id   = local.vpc_id
}

resource "aws_route" "private_controlled_https_egress" {
  for_each               = aws_route_table.private
  route_table_id         = each.value.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.controlled_egress.id
}

resource "aws_route_table_association" "private" {
  for_each       = aws_subnet.private
  subnet_id      = each.value.id
  route_table_id = aws_route_table.private[each.key].id
}

resource "aws_security_group" "service" {
  name_prefix = "${var.name_prefix}-service-"
  vpc_id      = local.vpc_id
}

resource "aws_security_group" "worker" {
  name_prefix = "${var.name_prefix}-worker-"
  vpc_id      = local.vpc_id
}

resource "aws_security_group" "load_balancer" {
  name_prefix = "${var.name_prefix}-lb-"
  vpc_id      = local.vpc_id
}

resource "aws_security_group" "s3_endpoint" {
  name_prefix = "${var.name_prefix}-s3-endpoint-"
  vpc_id      = local.vpc_id
}

resource "aws_security_group" "privatelink" {
  name_prefix = "${var.name_prefix}-privatelink-"
  vpc_id      = local.vpc_id
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = local.vpc_id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [for table in aws_route_table.private : table.id]
  policy            = data.aws_iam_policy_document.s3_endpoint.json
}

resource "aws_security_group_rule" "controlled_https_egress" {
  for_each          = local.outbound_https_rules
  type              = "egress"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = [each.value.cidr]
  description       = "control-plane ${each.value.target} HTTPS egress"
  security_group_id = each.value.security_group_id
}

resource "aws_security_group_rule" "privatelink_postgres_ingress" {
  for_each                 = local.service_worker_security_groups
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = each.value
  security_group_id        = aws_security_group.privatelink.id
}
