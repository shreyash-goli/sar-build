# FICTIONAL sample for the FailSafe demo. Parsed as text only; never planned or applied.
terraform {
  required_providers {
    computeharbor = {
      source  = "computeharbor/computeharbor"
      version = "~> 2.0"
    }
  }
}

provider "computeharbor" {
  region = "us-east"
}
