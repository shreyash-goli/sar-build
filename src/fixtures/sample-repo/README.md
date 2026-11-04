# Sample repository manifests (FICTIONAL)

Static example files for the FS-09 manifest import. They describe a fictional
"incident-monitoring" service in the Northstar Labs demo. They are read as text
and parsed safely; nothing here is executed, installed or fetched.

Expected suggestions when imported for `node-service-incident-monitoring`:

- `@cloudcomms/sdk` (package.json) -> SUGGESTED edge CloudComms POWERS Incident monitoring
- `computeharbor` Terraform provider (main.tf line 5) -> SUGGESTED edge ComputeHarbor POWERS Incident monitoring (the provider block on line 11 is a duplicate within the import)
- `webhookworks/agent` image (docker-compose.yml) -> duplicate of the existing CONFIRMED edge
- `twilio` -> recognized SMS provider with no vendor record: reported as unmatched
- `express`, `pino`, `postgres` -> unrecognized, ignored
