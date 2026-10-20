import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { migrateRailwayDatabase } from "../lib/railway-runtime.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const { databasePath, dataDirectory } = migrateRailwayDatabase();
console.log(`Railway data ready at ${dataDirectory}; SQLite database: ${databasePath}`);

const serverPath = fileURLToPath(new URL("../dist/standalone/server.js", import.meta.url));
const child = spawn(process.execPath, [serverPath], {
  cwd: projectRoot,
  env: { ...process.env, HOST: "0.0.0.0", PORT: process.env.PORT || "3000" },
  stdio: "inherit",
});

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    child.kill(signal);
  });
}

child.on("error", error => {
  console.error("Could not start the Railway web server.", error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});

