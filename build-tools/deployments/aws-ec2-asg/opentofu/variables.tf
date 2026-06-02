variable "region" {
  type = string
}

variable "name_prefix" {
  type = string
}

variable "tags" {
  type = map(string)
}

variable "ec2_host_mode" {
  type = string
  validation {
    condition     = var.ec2_host_mode == "repo-owned-asg"
    error_message = "ec2_host_mode must be repo-owned-asg for the ASG bootstrap root."
  }
}

variable "ec2_asg_name" {
  type = string
}

variable "ec2_ami_id" {
  type = string
}

variable "ec2_ami_build_identity" {
  type = string
}

variable "ec2_ami_evidence_path" {
  type = string
}

variable "ec2_instance_type" {
  type = string
}

variable "ec2_instance_profile_arn" {
  type = string
}

variable "ec2_private_subnet_ids" {
  type = list(string)
}

variable "ec2_security_group_ids" {
  type = list(string)
}

variable "ec2_user_data_base64" {
  type = string
}

variable "ec2_user_data_path" {
  type = string
}

variable "ec2_user_data_digest" {
  type = string
}

variable "ec2_service_capacity" {
  type = number
}

variable "ec2_worker_capacity" {
  type = number
}

variable "ec2_import_adoption_metadata" {
  type = object({
    mode               = string
    reviewed_reference = string
    import_block       = string
  })
}
