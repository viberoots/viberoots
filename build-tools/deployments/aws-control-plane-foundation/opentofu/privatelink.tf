locals {
  supabase_privatelink_endpoint_mode = (
    var.supabase_privatelink_enabled &&
    var.supabase_privatelink_connection_mode == "endpoint"
  )
  supabase_privatelink_service_network_mode = (
    var.supabase_privatelink_enabled &&
    var.supabase_privatelink_connection_mode == "service-network"
  )
  supabase_privatelink_subnet_ids = (
    length(var.supabase_privatelink_endpoint_subnet_ids) > 0 ?
    var.supabase_privatelink_endpoint_subnet_ids :
    [for subnet in aws_subnet.private : subnet.id]
  )
}

resource "aws_ram_resource_share_accepter" "supabase_privatelink" {
  count     = var.supabase_privatelink_enabled ? 1 : 0
  share_arn = var.supabase_privatelink_ram_share_arn
}

resource "aws_vpc_endpoint" "supabase_privatelink" {
  count                      = local.supabase_privatelink_endpoint_mode ? 1 : 0
  vpc_id                     = local.vpc_id
  vpc_endpoint_type          = "Resource"
  resource_configuration_arn = var.supabase_privatelink_resource_configuration_arn
  subnet_ids                 = local.supabase_privatelink_subnet_ids
  security_group_ids         = [aws_security_group.privatelink.id]
  private_dns_enabled        = var.supabase_privatelink_private_dns_enabled
  tags                       = merge(var.tags, { Name = "${var.name_prefix}-supabase-privatelink" })

  depends_on = [aws_ram_resource_share_accepter.supabase_privatelink]
}

resource "aws_vpclattice_service_network_resource_association" "supabase_privatelink" {
  count                             = local.supabase_privatelink_service_network_mode ? 1 : 0
  resource_configuration_identifier = var.supabase_privatelink_resource_configuration_arn
  service_network_identifier        = var.supabase_privatelink_service_network_identifier
  private_dns_enabled               = var.supabase_privatelink_private_dns_enabled
  tags                              = merge(var.tags, { Name = "${var.name_prefix}-supabase-privatelink" })

  depends_on = [aws_ram_resource_share_accepter.supabase_privatelink]
}

locals {
  supabase_privatelink_endpoint_id = (
    local.supabase_privatelink_endpoint_mode ?
    aws_vpc_endpoint.supabase_privatelink[0].id :
    ""
  )
  supabase_privatelink_service_network_association_id = (
    local.supabase_privatelink_service_network_mode ?
    aws_vpclattice_service_network_resource_association.supabase_privatelink[0].id :
    ""
  )
  supabase_privatelink_dns_names = (
    local.supabase_privatelink_endpoint_mode ?
    aws_vpc_endpoint.supabase_privatelink[0].dns_entry[*].dns_name :
    compact([
      try(
        aws_vpclattice_service_network_resource_association.supabase_privatelink[0].dns_entry[0].domain_name,
        "",
      ),
    ])
  )
}
