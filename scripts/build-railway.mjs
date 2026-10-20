import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const runner = fileURLToPath(new URL("./run-framework.mjs", import.meta.url));
const result = spawnSync(process.execPath, [runner, "build"], {
  cwd: projectRoot,
  env: { ...process.env, ANIME_RAILWAY_BUILD: "1", NODE_ENV: "production" },
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);

