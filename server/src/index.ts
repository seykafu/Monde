import { buildApp } from "./app.js";
import { parseConfig } from "./config.js";

const config = parseConfig();
const app = buildApp(config);
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "Shutting down");
  try {
    await app.close();
  } catch (err) {
    app.log.error({ err }, "Shutdown failed");
    process.exitCode = 1;
  }
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
try {
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error({ err }, "Startup failed");
  await app.close();
  process.exitCode = 1;
}
