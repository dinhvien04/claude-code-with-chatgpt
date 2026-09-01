#!/usr/bin/env node
/**
 * scripts/browser-agent.mjs
 *
 * Optional Playwright automation helper for ChatGPT Web pairing and C2C prompt handoff.
 *
 * DESIGN PRINCIPLE:
 * Mode C (Guided Manual Handoff) is the primary, 100% reliable default.
 * This script is an OPTIONAL convenience helper (Mode A).
 * If any login wall, CAPTCHA, Cloudflare Turnstile, or unexpected DOM challenge is encountered,
 * it immediately yields control and provides clear instructions for falling back to Mode C.
 *
 * Usage:
 *   node scripts/browser-agent.mjs pair <mcpUrl> <pairingCode> [connectorName]
 *   node scripts/browser-agent.mjs send <chatUrl> <promptFileOrText>
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function printModeCFallback(reason, instructions) {
  console.log("\n" + "=".repeat(60));
  console.log("⚠️  AUTOMATION NOTICE: Yielding to Mode C (Guided Manual Handoff)");
  console.log("=".repeat(60));
  console.log(`Reason: ${reason}\n`);
  console.log("Please perform the following step manually in your browser:");
  for (const [idx, step] of instructions.entries()) {
    console.log(`  ${idx + 1}. ${step}`);
  }
  console.log("\nAfter completing the step, you can resume normal Claude Code operations.");
  console.log("=".repeat(60) + "\n");
}

async function loadPlaywright() {
  try {
    const pw = await import("playwright");
    return pw.chromium;
  } catch {
    printModeCFallback(
      "Playwright is not installed in the current environment.",
      [
        "To enable optional browser automation, install playwright: pnpm add -D playwright",
        "Or use Mode C (Guided Manual Handoff) directly via copy-paste."
      ]
    );
    process.exit(0);
  }
}

async function handlePair(chromium, mcpUrl, pairingCode, connectorName = "Claude Code with ChatGPT") {
  console.log(`[browser-agent] Launching browser for connector pairing...`);
  console.log(`[browser-agent] Target connector: "${connectorName}"`);
  console.log(`[browser-agent] MCP URL: ${mcpUrl}`);

  let browser;
  try {
    // Launch browser instance. Note: Standard browser contexts launch in isolated profiles.
    // When ChatGPT authentication or Cloudflare verification is needed, the script yields immediately to Mode C.
    browser = await chromium.launch({
      headless: false,
      channel: "chrome" // Attempt using system Chrome binary if available
    }).catch(async () => {
      return await chromium.launch({ headless: false });
    });
  } catch (err) {
    printModeCFallback(
      `Could not launch browser instance: ${err.message}`,
      [
        `Open ChatGPT in your browser: https://chatgpt.com/#settings/Apps`,
        `Create a custom app/connector with Name: "${connectorName}", Server URL: "${mcpUrl}", Auth: OAuth`,
        `When the pairing page opens, enter Pairing Code: "${pairingCode}"`
      ]
    );
    return;
  }

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const connectorsUrl = "https://chatgpt.com/#settings/Apps";
    console.log(`[browser-agent] Navigating to ChatGPT apps settings...`);
    await page.goto(connectorsUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Check for login wall or Cloudflare verification
    const isLoginWall = await page.locator('button:has-text("Log in"), a[href*="/login"]').count();
    const isCloudflare = await page.locator('iframe[src*="cloudflare"], text="Verify you are human"').count();

    if (isLoginWall > 0 || isCloudflare > 0) {
      printModeCFallback(
        isCloudflare > 0 ? "Cloudflare / Human Verification encountered." : "ChatGPT authentication required.",
        [
          "Log into ChatGPT in your browser.",
          `Go to Settings -> Apps -> Add Custom App.`,
          `Set Server URL to: ${mcpUrl}`,
          `Authenticate and enter Pairing Code: ${pairingCode}`
        ]
      );
      await browser.close();
      return;
    }

    console.log(`[browser-agent] Looking for connector form fields...`);
    // Try to fill connector form if inputs are ready
    const nameInput = page.locator('input[placeholder*="Name"], input[name="name"], input[aria-label*="Name"]').first();
    const urlInput = page.locator('input[placeholder*="https://"], input[name="url"], input[type="url"]').first();

    const formVisible = await nameInput.isVisible({ timeout: 5000 }).catch(() => false);

    if (formVisible) {
      console.log(`[browser-agent] Filling connector details...`);
      await nameInput.fill(connectorName);
      if (await urlInput.isVisible()) {
        await urlInput.fill(mcpUrl);
      }
      console.log(`[browser-agent] Form filled. Waiting for user to review and authorize...`);
    } else {
      printModeCFallback(
        "Connector creation form not immediately interactable (ChatGPT UI update or navigation change).",
        [
          `Ensure Developer Mode is enabled in ChatGPT Settings -> Apps.`,
          `In ChatGPT Apps / Developer Mode, create a new custom app named "${connectorName}".`,
          `Set Server URL to: ${mcpUrl}`,
          `Authorize with Pairing Code: ${pairingCode}`
        ]
      );
    }
  } catch (err) {
    printModeCFallback(
      `Browser automation step encountered an error: ${err.message}`,
      [
        `Open: https://chatgpt.com/#settings/Apps`,
        `Create or update "${connectorName}" with URL: ${mcpUrl}`,
        `Authorize using Pairing Code: ${pairingCode}`
      ]
    );
  } finally {
    console.log(`[browser-agent] Session held open for 15 seconds for visual inspection...`);
    await new Promise((r) => setTimeout(r, 15000));
    await browser.close().catch(() => {});
  }
}

async function handleSend(chromium, chatUrl, promptInput) {
  let promptText = promptInput;
  if (existsSync(resolve(promptInput))) {
    promptText = readFileSync(resolve(promptInput), "utf8");
  }

  console.log(`[browser-agent] Sending [C2C] prompt to ChatGPT chat: ${chatUrl}`);

  let browser;
  try {
    browser = await chromium.launch({ headless: false }).catch(() => null);
  } catch {
    browser = null;
  }

  if (!browser) {
    printModeCFallback(
      "Unable to start browser for prompt handoff.",
      [
        `Open your ChatGPT chat: ${chatUrl}`,
        `Paste the following [C2C] message into the prompt box:`,
        "--------------------------------------------------",
        promptText.trim(),
        "--------------------------------------------------"
      ]
    );
    return;
  }

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(chatUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    const promptBox = page.locator('#prompt-textarea, textarea[placeholder*="Message"], div[contenteditable="true"]').first();
    if (await promptBox.isVisible({ timeout: 8000 }).catch(() => false)) {
      await promptBox.fill(promptText);
      console.log(`[browser-agent] Prompt filled into ChatGPT editor.`);
      console.log(`[browser-agent] Press Enter in the browser to submit, or let user review.`);
      await new Promise((r) => setTimeout(r, 10000));
    } else {
      printModeCFallback(
        "Could not automatically locate prompt input box.",
        [
          `Open: ${chatUrl}`,
          `Paste the prompt manually into ChatGPT.`
        ]
      );
    }
  } catch (err) {
    printModeCFallback(
      `Error during prompt send: ${err.message}`,
      [
        `Open: ${chatUrl}`,
        `Copy and paste the prompt manually.`
      ]
    );
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  const [action, ...args] = process.argv.slice(2);

  if (!action || (action !== "pair" && action !== "send")) {
    console.log("Usage:");
    console.log("  node scripts/browser-agent.mjs pair <mcpUrl> <pairingCode> [connectorName]");
    console.log("  node scripts/browser-agent.mjs send <chatUrl> <promptFileOrText>");
    process.exit(1);
  }

  const chromium = await loadPlaywright();
  if (!chromium) return;

  if (action === "pair") {
    const [mcpUrl, pairingCode, connectorName] = args;
    if (!mcpUrl || !pairingCode) {
      console.error("Error: mcpUrl and pairingCode are required for pair command.");
      process.exit(1);
    }
    await handlePair(chromium, mcpUrl, pairingCode, connectorName);
  } else if (action === "send") {
    const [chatUrl, promptInput] = args;
    if (!chatUrl || !promptInput) {
      console.error("Error: chatUrl and promptInput are required for send command.");
      process.exit(1);
    }
    await handleSend(chromium, chatUrl, promptInput);
  }
}

main().catch((err) => {
  console.error("Unexpected error in browser-agent:", err);
  process.exit(1);
});
