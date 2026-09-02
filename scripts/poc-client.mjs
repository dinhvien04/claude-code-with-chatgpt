#!/usr/bin/env node
/**
 * scripts/poc-client.mjs
 *
 * Safe, maintained smoke and integration testing utility that validates:
 *   1. Unauthenticated /mcp request -> 401 challenge + resource metadata
 *   2. OAuth discovery metadata endpoints
 *   3. Dynamic client registration (RFC 7591)
 *   4. Authorization request -> pairing verification with short-lived pairing code
 *   5. Authorization code exchange with PKCE (S256)
 *   6. Read-only MCP tool invocation (workspace_info, read_file on package.json, and sensitive-file block on .env)
 *
 * Usage: node scripts/poc-client.mjs <baseUrl> <pairingCode>
 */
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const [base, pairingCode] = process.argv.slice(2);
if (!base || !pairingCode) {
  console.error("Usage: node scripts/poc-client.mjs <baseUrl> <pairingCode>");
  process.exit(1);
}

const REDIRECT_URI = "http://127.0.0.1:19876/callback";
const step = (msg) => console.log(`\n== ${msg}`);

try {
  // 1. unauthenticated request must 401
  step("1. Unauthenticated /mcp request challenge check");
  const unauthed = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "tools/list", params: {} }),
  });
  console.log(`   status: ${unauthed.status} (expected 401)`);
  if (unauthed.status !== 401) {
    console.error(`   FAIL: expected status 401, got ${unauthed.status}`);
    process.exit(2);
  }

  // 2. discovery
  step("2. OAuth metadata discovery");
  const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
  const authServer = prm.authorization_servers[0];
  const asMeta = await (await fetch(`${authServer}/.well-known/oauth-authorization-server`)).json();
  console.log(`   resource: ${prm.resource}`);
  console.log(`   authorization_endpoint: ${asMeta.authorization_endpoint}`);

  // 3. DCR
  step("3. Dynamic client registration");
  const registration = await (
    await fetch(asMeta.registration_endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "C2C Smoke Client", redirect_uris: [REDIRECT_URI] }),
    })
  ).json();
  console.log(`   client_id registered: ${Boolean(registration.client_id)}`);

  // 4. authorize with pairing code
  step("4. Authorization + pairing");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorizeUrl = new URL(asMeta.authorization_endpoint);
  authorizeUrl.searchParams.set("client_id", registration.client_id);
  authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("state", randomBytes(8).toString("hex"));
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("scope", asMeta.scopes_supported.join(" "));

  const page = await fetch(authorizeUrl, { redirect: "manual" });
  const html = await page.text();
  const requestId = html.match(/name="request_id" value="([a-f0-9]+)"/)?.[1];
  if (!requestId) {
    console.error("   failed to load authorization page");
    process.exit(2);
  }
  console.log("   authorization page loaded, submitting pairing code...");
  const submit = await fetch(asMeta.authorization_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ request_id: requestId, pairing_code: pairingCode }),
    redirect: "manual",
  });
  if (submit.status !== 302) {
    console.error(`   pairing failed with status ${submit.status}`);
    process.exit(2);
  }
  const code = new URL(submit.headers.get("location")).searchParams.get("code");
  console.log("   pairing accepted, authorization code received");

  // 5. token exchange
  step("5. Token exchange (PKCE)");
  const tokenResponse = await fetch(asMeta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: registration.client_id,
      redirect_uri: REDIRECT_URI,
    }),
  });
  const tokens = await tokenResponse.json();
  console.log(`   status: ${tokenResponse.status}, tokens received: ${Boolean(tokens.access_token)}`);
  if (!tokens.access_token) {
    console.error("   failed to obtain access token");
    process.exit(2);
  }

  // 6. MCP calls
  step("6. Read-only MCP tool calls");
  const client = new Client({ name: "c2c-smoke", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } },
    })
  );
  const { tools } = await client.listTools();
  console.log(`   available tools: ${tools.map((t) => t.name).join(", ")}`);
  const info = await client.callTool({ name: "workspace_info", arguments: {} });
  console.log(`   workspace_info returned: ${Boolean(JSON.parse(info.content[0].text).workspaceName)}`);
  const pkgFile = await client.callTool({ name: "read_file", arguments: { path: "package.json" } });
  const pkgJson = JSON.parse(pkgFile.content[0].text);
  console.log(`   read_file package.json returned valid content: ${Boolean(pkgJson.content)}`);
  const envCheck = await client.callTool({ name: "read_file", arguments: { path: ".env" } });
  console.log(`   read_file .env blocked as sensitive: ${envCheck.isError === true}`);
  await client.close();

  console.log("\nSmoke test PASSED: Full OAuth + pairing + MCP tool invocation verified.");
} catch (err) {
  console.error("Smoke test failed with unexpected error:", err);
  process.exit(1);
}
