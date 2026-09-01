import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { AuthStore } from "../src/auth/store.js";
import { makeTmpDir, cleanup } from "./helpers.js";

describe("RFC 6819 Token Family Rotation & Replay Detection", () => {
  let tmpDir: string;
  let authFile: string;
  let store: AuthStore;

  beforeEach(() => {
    tmpDir = makeTmpDir("token-family-test");
    authFile = path.join(tmpDir, "auth.json");
    store = new AuthStore("ws-test", { file: authFile });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it("assigns matching familyId and generation 0 on initial token grant", () => {
    const initial = store.issueTokens({
      clientId: "client_1",
      scopes: ["workspace.read", "offline_access"],
    });

    expect(initial.refreshToken).toBeTruthy();
    const atVerify = store.verifyAccessToken(initial.accessToken);
    expect(atVerify.ok).toBe(true);
    if (atVerify.ok) {
      expect(atVerify.record.familyId).toMatch(/^c2c_fam_/);
      expect(atVerify.record.generation).toBe(0);
      expect(atVerify.record.status).toBe("active");
    }
  });

  it("rotates refresh token, increments generation, and tombstones used token", () => {
    const initial = store.issueTokens({
      clientId: "client_1",
      scopes: ["workspace.read", "offline_access"],
    });

    const rotated1 = store.refresh(initial.refreshToken!, "client_1");
    expect(rotated1.ok).toBe(true);
    if (!rotated1.ok) return;

    expect(rotated1.tokens.refreshToken).not.toBe(initial.refreshToken);
    const at1Verify = store.verifyAccessToken(rotated1.tokens.accessToken);
    expect(at1Verify.ok).toBe(true);
    if (at1Verify.ok) {
      expect(at1Verify.record.generation).toBe(1);
    }

    // Subsequent rotation
    const rotated2 = store.refresh(rotated1.tokens.refreshToken!, "client_1");
    expect(rotated2.ok).toBe(true);
    if (!rotated2.ok) return;

    const at2Verify = store.verifyAccessToken(rotated2.tokens.accessToken);
    expect(at2Verify.ok).toBe(true);
    if (at2Verify.ok) {
      expect(at2Verify.record.generation).toBe(2);
    }
  });

  it("detects replay attack of rotated token and revokes entire family (RFC 6819)", () => {
    // Initial token issuance (Gen 0)
    const initial = store.issueTokens({
      clientId: "client_1",
      scopes: ["workspace.read", "offline_access"],
    });
    const rt0 = initial.refreshToken!;
    const at0 = initial.accessToken;

    // Legitimate rotation to Gen 1
    const rot1 = store.refresh(rt0, "client_1");
    expect(rot1.ok).toBe(true);
    if (!rot1.ok) return;
    const rt1 = rot1.tokens.refreshToken!;
    const at1 = rot1.tokens.accessToken;

    // Legitimate rotation to Gen 2
    const rot2 = store.refresh(rt1, "client_1");
    expect(rot2.ok).toBe(true);
    if (!rot2.ok) return;
    const rt2 = rot2.tokens.refreshToken!;
    const at2 = rot2.tokens.accessToken;

    // Active tokens should be valid
    expect(store.verifyAccessToken(at2).ok).toBe(true);

    // ATTACK: Adversary replays old rt0 (Gen 0)
    const replayResult = store.refresh(rt0, "client_1");
    expect(replayResult.ok).toBe(false);
    if (!replayResult.ok) {
      expect(replayResult.reason).toBe("invalid_grant");
      expect(replayResult.replayDetected).toBe(true);
    }

    // SECURITY INVARIANT: All tokens in the family must now be revoked
    expect(store.verifyAccessToken(at0).ok).toBe(false);
    expect(store.verifyAccessToken(at1).ok).toBe(false);
    expect(store.verifyAccessToken(at2).ok).toBe(false);

    // Further attempts to refresh with the latest valid token (rt2) must fail
    const subsequentRefresh = store.refresh(rt2, "client_1");
    expect(subsequentRefresh.ok).toBe(false);
    expect(subsequentRefresh.reason).toBe("invalid_grant");
  });

  it("preserves tombstones and replay detection across store reloads", () => {
    const initial = store.issueTokens({
      clientId: "client_1",
      scopes: ["workspace.read", "offline_access"],
    });
    const rt0 = initial.refreshToken!;

    const rot1 = store.refresh(rt0, "client_1");
    expect(rot1.ok).toBe(true);
    if (!rot1.ok) return;
    const at1 = rot1.tokens.accessToken;

    // Simulate daemon restart with fresh AuthStore reading same file
    const restartedStore = new AuthStore("ws-test", { file: authFile });
    expect(restartedStore.verifyAccessToken(at1).ok).toBe(true);

    // Replay rt0 against restarted store
    const replayResult = restartedStore.refresh(rt0, "client_1");
    expect(replayResult.ok).toBe(false);
    if (!replayResult.ok) {
      expect(replayResult.replayDetected).toBe(true);
    }

    // Verify family revocation persisted
    expect(restartedStore.verifyAccessToken(at1).ok).toBe(false);
  });

  it("isolates token families: revoking family A does not affect family B", () => {
    const grantA = store.issueTokens({ clientId: "client_A", scopes: ["offline_access"] });
    const grantB = store.issueTokens({ clientId: "client_B", scopes: ["offline_access"] });

    const rotA = store.refresh(grantA.refreshToken!, "client_A");
    expect(rotA.ok).toBe(true);
    if (!rotA.ok) return;

    // Replay on Family A
    store.refresh(grantA.refreshToken!, "client_A");

    // Family A is revoked
    expect(store.verifyAccessToken(rotA.tokens.accessToken).ok).toBe(false);

    // Family B remains active and untouched
    expect(store.verifyAccessToken(grantB.accessToken).ok).toBe(true);
    const rotB = store.refresh(grantB.refreshToken!, "client_B");
    expect(rotB.ok).toBe(true);
  });
});
