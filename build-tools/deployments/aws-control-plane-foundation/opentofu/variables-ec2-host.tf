variable "ec2_host_mode" {
  type    = string
  default = "external-reviewed-host"
  validation {
    condition     = contains(["external-reviewed-host", "repo-owned-asg"], var.ec2_host_mode)
    error_message = "ec2_host_mode must be external-reviewed-host or repo-owned-asg."
  }
}

variable "ec2_asg_name" {
  type    = string
  default = ""
}

variable "ec2_ami_id" {
  type    = string
  default = ""
}

variable "ec2_ami_build_identity" {
  type    = string
  default = ""
}

variable "ec2_ami_evidence_path" {
  type    = string
  default = ""
}

variable "ec2_instance_type" {
  type    = string
  default = ""
}

variable "ec2_instance_profile_arn" {
  type    = string
  default = ""
}

variable "ec2_private_subnet_ids" {
  type    = list(string)
  default = []
}

variable "ec2_security_group_ids" {
  type    = list(string)
  default = []
}

variable "ec2_user_data_base64" {
  type    = string
  default = ""
}

variable "ec2_user_data_path" {
  type    = string
  default = ""
}

variable "ec2_user_data_digest" {
  type    = string
  default = ""
}

variable "ec2_service_capacity" {
  type    = number
  default = 1
}

variable "ec2_worker_capacity" {
  type    = number
  default = 2
}

variable "ec2_import_adoption_metadata" {
  type = object({
    mode               = string
    reviewed_reference = string
    import_block       = string
  })
  default = {
    mode               = "managed"
    reviewed_reference = ""
    import_block       = ""
  }
}
