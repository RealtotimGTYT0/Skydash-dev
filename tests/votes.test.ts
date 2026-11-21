import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, key, makeAccount, type TestDb } from "./helpers/db.ts";
import { handleServerApi } from "../src/api/server-api.ts";
import { sign } from "../src/lib/server-auth.ts";
import { getBalance } from "../src/services/tokens.ts";
import { getVoteConfig, parseVoteSites, recordVote, replaceVoteSites, setVoteConfig, listVoteSites } from "../src/services/votes.ts";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t.close(); });

const T0 = new Date("2026-11-16T12:00:00Z");
const after = (h: number) => new Date(T0.getTime() + h * 3600_000);

describe("vote rewards", () => {
  it("pays the configured tokens once and records a VOTE transaction", async () => {
    await setVoteConfig(t.prisma, { tokens: 3, cooldownHours: 24 });
    const a = await makeAccount(t.prisma);
    const r = await recordVote(t.prisma, { mcAccountId: a.id, serviceName: "listA", idempotencyKey: key("v"), now: T0 });
    expect(r).toMatchObject({ replayed: false, awarded: 3, balance: 3, reason: "REWARDED" });
    expect(await getBalance(t.prisma, a.id)).toBe(3);
    const tx = await t.prisma.tokenTransaction.findMany({ where: { mcAccountId: a.id } });
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ type: "VOTE", amount: 3 });
  });

  it("never pays the same vote twice, even when copies arrive at the same moment", async () => {
    await setVoteConfig(t.prisma, { tokens: 2, cooldownHours: 24 });
    const a = await makeAccount(t.prisma);
    const k = key("same");
    const results = await Promise.all(Array.from({ length: 8 }, () => recordVote(t.prisma, { mcAccountId: a.id, serviceName: "listA", idempotencyKey: k, now: T0 })));
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await getBalance(t.prisma, a.id)).toBe(2);
    expect(await t.prisma.voteRecord.count({ where: { mcAccountId: a.id } })).toBe(1);
  });

  it("pays once per site per cooldown, but separately for each site", async () => {
    await setVoteConfig(t.prisma, { tokens: 1, cooldownHours: 24 });
    const a = await makeAccount(t.prisma);
    const vote = (service: string, now: Date) => recordVote(t.prisma, { mcAccountId: a.id, serviceName: service, idempotencyKey: key("v"), now });
    expect((await vote("listA", T0)).awarded).toBe(1);
    expect(await vote("listA", after(1))).toMatchObject({ awarded: 0, reason: "COOLDOWN" });
    expect((await vote("listB", after(1))).awarded).toBe(1);
    expect(await vote("listA", after(23.9))).toMatchObject({ awarded: 0, reason: "COOLDOWN" });
    expect((await vote("listA", after(24.1))).awarded).toBe(1);
    expect(await getBalance(t.prisma, a.id)).toBe(3);
  });

  it("a replay of a cooled-down vote stays a no-op", async () => {
    await setVoteConfig(t.prisma, { tokens: 1, cooldownHours: 24 });
    const a = await makeAccount(t.prisma);
    await recordVote(t.prisma, { mcAccountId: a.id, serviceName: "x", idempotencyKey: key("v"), now: T0 });
    const k = key("again");
    const first = await recordVote(t.prisma, { mcAccountId: a.id, serviceName: "x", idempotencyKey: k, now: after(2) });
    const second = await recordVote(t.prisma, { mcAccountId: a.id, serviceName: "x", idempotencyKey: k, now: after(30) });
    expect(first.awarded).toBe(0);
    expect(second).toMatchObject({ replayed: true, awarded: 0 });
    expect(await getBalance(t.prisma, a.id)).toBe(1);
  });

  it("pays nothing when rewards are turned off (0), but still records the vote", async () => {
    await setVoteConfig(t.prisma, { tokens: 0, cooldownHours: 24 });
    const a = await makeAccount(t.prisma);
    expect(await recordVote(t.prisma, { mcAccountId: a.id, serviceName: "x", idempotencyKey: key("v"), now: T0 })).toMatchObject({ awarded: 0, reason: "DISABLED" });
    expect(await getBalance(t.prisma, a.id)).toBe(0);
    expect(await t.prisma.voteRecord.count({ where: { mcAccountId: a.id } })).toBe(1);
  });

  it("refuses a key that was already used for another player", async () => {
    await setVoteConfig(t.prisma, { tokens: 1, cooldownHours: 24 });
    const a = await makeAccount(t.prisma), b = await makeAccount(t.prisma);
    const k = key("shared");
    await recordVote(t.prisma, { mcAccountId: a.id, serviceName: "x", idempotencyKey: k, now: T0 });
    await expect(recordVote(t.prisma, { mcAccountId: b.id, serviceName: "x", idempotencyKey: k, now: T0 })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(await getBalance(t.prisma, b.id)).toBe(0);
  });
});

describe("vote settings and sites", () => {
  it("validates settings and the site list", async () => {
    await expect(setVoteConfig(t.prisma, { tokens: -1, cooldownHours: 24 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(setVoteConfig(t.prisma, { tokens: 1, cooldownHours: 0 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(setVoteConfig(t.prisma, { tokens: 1.5, cooldownHours: 24 })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(() => parseVoteSites("noseparator")).toThrow();
    expect(() => parseVoteSites("a | http://insecure.example")).toThrow();
    expect(() => parseVoteSites("a | javascript:alert(1)")).toThrow();
    expect(() => parseVoteSites("a | https://x.example\nA | https://y.example")).toThrow(/twice/);
    expect(parseVoteSites("\n listA | https://a.example/vote \n\nlistB|https://b.example\n")).toEqual([
      { serviceName: "listA", url: "https://a.example/vote" }, { serviceName: "listB", url: "https://b.example" }]);
  });

  it("stores the site list in order and replaces it wholesale", async () => {
    await replaceVoteSites(t.prisma, parseVoteSites("one | https://1.example\ntwo | https://2.example"));
    expect((await listVoteSites(t.prisma)).map((s) => s.serviceName)).toEqual(["one", "two"]);
    await replaceVoteSites(t.prisma, parseVoteSites("three | https://3.example"));
    expect((await listVoteSites(t.prisma)).map((s) => s.serviceName)).toEqual(["three"]);
    await setVoteConfig(t.prisma, { tokens: 5, cooldownHours: 12 });
    expect(await getVoteConfig(t.prisma)).toEqual({ tokens: 5, cooldownHours: 12 });
  });
});

describe("vote API routes", () => {
  const SECRET = randomBytes(32).toString("hex");
  async function call(route: string, body: unknown) {
    const raw = JSON.stringify(body), now = new Date(), nonce = randomBytes(12).toString("hex"), path = `/api/server/${route}`;
    const res = await handleServerApi(t.prisma, new Request("https://s.example" + path, {
      method: "POST", body: raw,
      headers: { "content-type": "application/json", "x-ts-server": "main", "x-ts-timestamp": String(now.getTime()), "x-ts-nonce": nonce,
        "x-ts-signature": sign({ secret: SECRET, serverName: "main", method: "POST", path, timestamp: now.getTime(), nonce, body: raw }) },
    }), { secret: SECRET, now: () => now });
    const j = await res.json();
    return { status: res.status, ...j };
  }

  it("vote credits the player by name (case-insensitive), repeats are harmless, unknown players are refused", async () => {
    await setVoteConfig(t.prisma, { tokens: 4, cooldownHours: 24 });
    const a = await makeAccount(t.prisma, { username: "VoteGuy_1" });
    const k = key("api");
    const r1 = await call("vote", { username: "voteguy_1", serviceName: "listA", idempotencyKey: k });
    expect(r1).toMatchObject({ status: 200, ok: true, data: { awarded: 4, balance: 4, replayed: false, mcUuid: a.mcUuid } });
    const r2 = await call("vote", { username: "VoteGuy_1", serviceName: "listA", idempotencyKey: k });
    expect(r2.data).toMatchObject({ replayed: true, awarded: 4, balance: 4 });
    expect(await getBalance(t.prisma, a.id)).toBe(4);
    const ghost = await call("vote", { username: "NeverJoined_9", serviceName: "listA", idempotencyKey: key("g") });
    expect(ghost).toMatchObject({ status: 404, ok: false });
    expect((await call("vote", { username: "bad name", serviceName: "x", idempotencyKey: key("b") })).status).toBe(400);
  });

  it("vote/info lists the reward and the enabled sites", async () => {
    await setVoteConfig(t.prisma, { tokens: 2, cooldownHours: 24 });
    await replaceVoteSites(t.prisma, [{ serviceName: "listZ", url: "https://z.example/vote" }]);
    const r = await call("vote/info", {});
    expect(r.data).toEqual({ tokens: 2, cooldownHours: 24, sites: [{ serviceName: "listZ", url: "https://z.example/vote" }] });
  });
});
