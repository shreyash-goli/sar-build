/**
 * The fictional sample-repo manifests as text, for the "Import sample repository" demo action.
 * Embedded as strings so nothing reads the file system at runtime; tests/unit/manifest-import.test.ts
 * asserts these stay byte-identical to the files in ./incident-monitoring/.
 */
export const SAMPLE_REPO_SERVICE_NODE_ID = "node-service-incident-monitoring";

export const SAMPLE_REPO_FILES: readonly { filename: string; content: string }[] = [
  { filename: "package.json", content: "{\n  \"name\": \"incident-monitoring\",\n  \"version\": \"1.4.0\",\n  \"private\": true,\n  \"description\": \"FICTIONAL sample service for the FailSafe demo. Not executed.\",\n  \"scripts\": {\n    \"start\": \"node server.js\"\n  },\n  \"dependencies\": {\n    \"@cloudcomms/sdk\": \"^3.2.0\",\n    \"express\": \"^4.19.2\",\n    \"pino\": \"^9.0.0\",\n    \"twilio\": \"^5.0.0\"\n  },\n  \"devDependencies\": {\n    \"@webhookworks/client\": \"^1.0.0\"\n  }\n}\n" },
  { filename: "docker-compose.yml", content: "# FICTIONAL sample for the FailSafe demo. Parsed as text only.\nservices:\n  monitor:\n    build: .\n    ports:\n      - \"8080:8080\"\n  status-agent:\n    image: webhookworks/agent:2.1\n  db:\n    image: \"postgres:16\"\n" },
  { filename: "main.tf", content: "# FICTIONAL sample for the FailSafe demo. Parsed as text only; never planned or applied.\nterraform {\n  required_providers {\n    computeharbor = {\n      source  = \"computeharbor/computeharbor\"\n      version = \"~> 2.0\"\n    }\n  }\n}\n\nprovider \"computeharbor\" {\n  region = \"us-east\"\n}\n" },
];
