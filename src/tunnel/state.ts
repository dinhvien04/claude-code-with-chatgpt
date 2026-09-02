import path from "node:path";
import { getStateDir, readJsonIfExists, writeSecureJson } from "../config/paths.js";

export type TunnelPreference = "unset" | "quick" | "named";

export interface TunnelState {
  workspaceId: string;
  preference: TunnelPreference;
  askedAt?: string;
  provider?: "cloudflare-quick" | "cloudflare-named";
  tunnelName?: string;
  tunnelId?: string;
  hostname?: string;
  zone?: string;
  configuredAt?: string;
  fallbackReason?: string;
}

export function tunnelStateFile(workspaceId: string): string {
  return path.join(getStateDir(), "tunnels", `${workspaceId}.json`);
}

export function readTunnelState(workspaceId: string): TunnelState {
  return (
    readJsonIfExists<TunnelState>(tunnelStateFile(workspaceId)) ?? {
      workspaceId,
      preference: "unset",
    }
  );
}

export function writeTunnelState(state: TunnelState): TunnelState {
  writeSecureJson(tunnelStateFile(state.workspaceId), state);
  return state;
}

export function needsTunnelChoice(state: TunnelState): boolean {
  return state.preference === "unset" || !state.askedAt;
}

export function isNamedTunnelReady(state: TunnelState): boolean {
  return (
    state.preference === "named" &&
    Boolean(state.tunnelName?.trim()) &&
    Boolean(state.hostname?.trim())
  );
}

export function namedTunnelBinding(state: TunnelState): { tunnelName: string; hostname: string } | null {
  if (!isNamedTunnelReady(state) || !state.tunnelName || !state.hostname) return null;
  return { tunnelName: state.tunnelName, hostname: state.hostname };
}

export const TUNNEL_CHOICE_PROMPT = `Before connecting to ChatGPT, you have an optional choice:
Do you have a Cloudflare account with a domain already configured in Cloudflare?
- Yes: You can use a stable custom domain. Once configured, you won't need to reconfigure the connector across restarts. Requires a one-time Cloudflare login to add a subdomain.
- No: Use a temporary tunnel address. No registration required, full functionality. However, the address may change on restart, requiring connector re-pairing.
Both options work fully. Which do you prefer? If you have a domain, provide it (e.g. example.com).`;

export const NAMED_LOGIN_PROMPT =
  "A browser window will open. Please log in to Cloudflare and select your domain, then confirm when done.";

export const NAMED_FALLBACK_MESSAGE =
  "Falling back to a temporary tunnel address for now with full functionality. You can switch to a custom domain at any time.";

export const NAMED_REPAIR_MESSAGE =
  "Named tunnel currently unreachable. Please log in to Cloudflare in the browser window and select your domain, then confirm when done.";
