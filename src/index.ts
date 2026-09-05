#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { stripDialectsFromToolList } from "./schemaDialect.js";
import { loadSwagger } from "./swagger.js";
import { loadConfig, TokenManager, insecureTransportWarning } from "./auth.js";
import { policyFromEnv } from "./accessPolicy.js";
import { createIvedaServer } from "./server.js";
const { createRequire } = await import("node:module");
const SERVER_VERSION = (createRequire(import.meta.url)("../package.json") as { version: string }).version;

const argv = process.argv.slice(2);
if (argv.includes("--version") || argv.includes("-v")) {
  console.log(SERVER_VERSION);
  process.exit(0);
}
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`ivedaai-mcp-server — an MCP server for the IvedaAI video analytics API

This is a stdio MCP server. It is normally launched by an MCP client rather than
by hand; running it in a terminal will simply wait for JSON-RPC on stdin.

  Add to your client's config:
    "command": "npx", "args": ["-y", "ivedaai-mcp-server"]

Required environment:
  IVEDAAI_BASE_URL                  Origin of your IvedaAI server, no path
  IVEDAAI_USERNAME                  Account username
  IVEDAAI_PASSWORD                  Account password

Optional:
  IVEDAAI_READ_ONLY=true            Serve reads only, including verified query-only POSTs
  IVEDAAI_ALLOW_COLLECTION_DELETE=true
                                    Permit DELETEs that name no record
  IVEDAAI_REDACT_SECRETS=false      Stop masking credential-shaped fields
  IVEDAAI_ALLOW_INSECURE_TLS=true   Skip TLS verification (self-signed certs)
  IVEDAAI_UPLOAD_ROOT=<dir>         Enable uploads confined to this directory
  IVEDAAI_ALLOW_UNCONFINED_UPLOADS=true
                                     Compatibility escape hatch; prefer a root
  IVEDAAI_MAX_UPLOAD_BYTES=67108864 Largest file this server will upload
  IVEDAAI_TIMEOUT_MS=30000          Per-request timeout
  IVEDAAI_MAX_RESPONSE_BYTES=28672  Response bytes read before truncating
  IVEDAAI_CLIENT_ID / IVEDAAI_CLIENT_SECRET
                                    Client credentials on the token request
  IVEDAAI_SWAGGER_PATH=<path>       Use a different OpenAPI 3 document

  --help, -h                        This message
  --version, -v                     Print the version

Docs: https://github.com/WillORepO/ivedaAI-mcp-server#readme`);
  process.exit(0);
}

const ctx = loadSwagger();

let tokenManager: TokenManager;
try {
  const config = loadConfig(ctx);
  // Said once at startup, on stderr, where an operator setting the server up
  // will see it. Not a refusal — see insecureTransportWarning.
  const transport = insecureTransportWarning(config.origin, process.env.IVEDAAI_ALLOW_INSECURE_TLS === "true");
  if (transport) console.error(`[ivedaai-mcp-server] WARNING: ${transport}`);
  tokenManager = new TokenManager(config);
} catch (err) {
  console.error(`[ivedaai-mcp-server] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const { server, resourceToolCount, handWrittenTools } = createIvedaServer(ctx, tokenManager, policyFromEnv(), { enforceLossyUpdateGuard: process.env.IVEDAAI_ALLOW_LOSSY_UPDATE !== "true", log: console.error });
const transport = new StdioServerTransport();
let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  // Abort outbound work before closing the protocol. A closed client must
  // never leave a batch continuing to create or activate cameras.
  await tokenManager.close();
  await server.close();
};
const finish = () => { void shutdown().catch(() => { process.exitCode = 1; }); };
process.stdin.once("end", finish);
process.once("SIGINT", finish);
process.once("SIGTERM", finish);
const sendUnmodified = transport.send.bind(transport);
transport.send = async (message: JSONRPCMessage): Promise<void> => {
  stripDialectsFromToolList(message);
  return sendUnmodified(message);
};
await server.connect(transport);
console.error(
  `[ivedaai-mcp-server] running, ${resourceToolCount} resource tools${handWrittenTools.length ? ` + ` + handWrittenTools.join(" + ") : ""} registered`
);
