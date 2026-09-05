#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { remoteConfigSchema } from "./remoteAuth.js";
import { createRemoteServer } from "./remoteServer.js";

if (process.argv.includes("--help")) {
  console.log("Usage: node dist/http.js /absolute/path/customer.json\nAuthenticated read-only MCP on 127.0.0.1; requires an HTTPS reverse proxy and an OAuth identity provider. See docs/REMOTE.md.");
} else {
  try {
    if (process.argv.length !== 3) throw new Error("One configuration file required");
    if (process.env.IVEDAAI_SWAGGER_PATH !== undefined) throw new Error("HTTP uses the bundled specification");
    const input = readFileSync(process.argv[2]);
    if (input.length > 1048576) throw new Error("Configuration too large");
    const config = remoteConfigSchema.parse(JSON.parse(input.toString("utf8")));
    const service = createRemoteServer(config);
    service.http.on("error", () => { console.error("[ivedaai-http] Listener failed"); process.exitCode = 1; });
    service.http.listen(config.port, "127.0.0.1", () => console.error("[ivedaai-http] Read-only MCP listening on loopback"));
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void service.close().catch(() => { process.exitCode = 1; });
    };
    process.once("SIGTERM", stop); process.once("SIGINT", stop);
  } catch {
    // Validation errors can contain operator input. Never log config values or secrets.
    console.error("[ivedaai-http] Invalid or unreadable configuration; see docs/REMOTE.md");
    process.exitCode = 1;
  }
}
