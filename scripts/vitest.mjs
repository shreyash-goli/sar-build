// Runs `vitest run` with forwarded CLI args. pnpm forwards a literal "--"
// (e.g. `pnpm test -- provenance`), which vitest would otherwise treat as the
// end of its filters; strip it so blueprint verify commands filter correctly.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const vitestBin = fileURLToPath(
  new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
);
const args = process.argv.slice(2).filter((arg) => arg !== "--");
// vitest.config sets passWithNoTests for the bare suite; when a filter is
// given (e.g. `pnpm test -- fixtures`) a zero-match run must fail loudly.
const hasFilter = args.some((arg) => !arg.startsWith("-"));
if (hasFilter) args.push("--passWithNoTests=false");
const result = spawnSync(process.execPath, [vitestBin, "run", ...args], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
