import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, makeAccount, type TestDb } from "./helpers/db.ts";
import { makeLinkedUser } from "./helpers/users.ts";
import { handleServerApi } from "../src/api/server-api.ts";
import { sign } from "../src/lib/server-auth.ts";
import { createRank, deleteRank, grantRank, listRanks, ranksOf, revokeRank, setRankCommands } from "../src/services/ranks.ts";
import { setWebAdmin } from "../src/services/web-admins.ts";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t.close(); });
const actor = { actorLabel: "in-game:Boss" };

describe("ranks", () => {
  it("create, grant (once), revoke, delete; commands come back only when something actually changed", async () => {
    await createRank(t.prisma, { name: "VIP", displayName: "<gold>VIP</gold>", priority: 5 }, actor);
    await expect(createRank(t.prisma, { name: "vip" }, actor)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(createRank(t.prisma, { name: "bad name!" }, actor)).rejects.toMatchObject({ code: "VALIDATION" });
    await setRankCommands(t.prisma, { name: "vip", kind: "grant", commands: ["/lp user {player} parent add vip"] }, actor);
    await setRankCommands(t.prisma, { name: "vip", kind: "revoke", commands: ["lp user {player} parent remove vip"] }, actor);
    await expect(setRankCommands(t.prisma, { name: "vip", kind: "grant", commands: ["op {player}"] }, actor)).rejects.toMatchObject({ code: "VALIDATION" });

    const a = await makeAccount(t.prisma);
    const g1 = await grantRank(t.prisma, { name: "vip", mcAccountId: a.id }, actor);
    expect(g1).toMatchObject({ already: false, commands: ["lp user {player} parent add vip"] });
    const g2 = await grantRank(t.prisma, { name: "vip", mcAccountId: a.id }, actor);
    expect(g2).toMatchObject({ already: true, commands: [] });   // never run the grant commands twice
    expect(await ranksOf(t.prisma, a.id)).toEqual([{ name: "vip", displayName: "<gold>VIP</gold>", priority: 5 }]);

    const r1 = await revokeRank(t.prisma, { name: "vip", mcAccountId: a.id }, actor);
    expect(r1).toMatchObject({ had: true, commands: ["lp user {player} parent remove vip"] });
    expect(await revokeRank(t.prisma, { name: "vip", mcAccountId: a.id }, actor)).toMatchObject({ had: false, commands: [] });

    await grantRank(t.prisma, { name: "vip", mcAccountId: a.id }, actor);
    expect(await deleteRank(t.prisma, "vip", actor)).toEqual({ holders: 1 });
    expect(await listRanks(t.prisma)).toEqual([]);
    expect(await ranksOf(t.prisma, a.id)).toEqual([]);
    await expect(grantRank(t.prisma, { name: "vip", mcAccountId: a.id }, actor)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("orders a player's ranks by priority", async () => {
    await createRank(t.prisma, { name: "low", priority: 1 }, actor);
    await createRank(t.prisma, { name: "high", priority: 9 }, actor);
    const a = await makeAccount(t.prisma);
    await grantRank(t.prisma, { name: "low", mcAccountId: a.id }, actor);
    await grantRank(t.prisma, { name: "high", mcAccountId: a.id }, actor);
    expect((await ranksOf(t.prisma, a.id)).map((r) => r.name)).toEqual(["high", "low"]);
  });
});

describe("making website admins from the game", () => {
  it("promotes a linked player, refuses unlinked players, and never removes the last admin", async () => {
    const u = await makeLinkedUser(t.prisma);
    const acct = await t.prisma.minecraftAccount.findFirstOrThrow({ where: { username: u.username } });
    expect(await setWebAdmin(t.prisma, { mcAccountId: acct.id, admin: true }, actor)).toMatchObject({ changed: true });
    expect((await t.prisma.user.findFirstOrThrow({ where: { minecraftUsername: u.username } })).role).toBe("ADMIN");
    expect(await setWebAdmin(t.prisma, { mcAccountId: acct.id, admin: true }, actor)).toMatchObject({ changed: false });

    const loner = await makeAccount(t.prisma);   // joined the server but never registered
    await expect(setWebAdmin(t.prisma, { mcAccountId: loner.id, admin: true }, actor)).rejects.toMatchObject({ code: "INVALID_STATE" });

    await t.prisma.user.updateMany({ where: { NOT: { minecraftUsername: u.username }, role: "ADMIN" }, data: { role: "PLAYER" } });
    await expect(setWebAdmin(t.prisma, { mcAccountId: acct.id, admin: false }, actor)).rejects.toMatchObject({ code: "INVALID_STATE" });
    const u2 = await makeLinkedUser(t.prisma);
    const acct2 = await t.prisma.minecraftAccount.findFirstOrThrow({ where: { username: u2.username } });
    await setWebAdmin(t.prisma, { mcAccountId: acct2.id, admin: true }, actor);
    expect(await setWebAdmin(t.prisma, { mcAccountId: acct.id, admin: false }, actor)).toMatchObject({ changed: true });
    expect((await t.prisma.adminAuditLog.count({ where: { action: { in: ["web-admin.add", "web-admin.remove"] } } }))).toBeGreaterThanOrEqual(3);
  });
});

describe("rank + webadmin plugin API", () => {
  const SECRET = randomBytes(32).toString("hex");
  async function call(route: string, body: unknown) {
    const raw = JSON.stringify(body), now = new Date(), nonce = randomBytes(12).toString("hex"), path = `/api/server/${route}`;
    const res = await handleServerApi(t.prisma, new Request("https://s.example" + path, {
      method: "POST", body: raw,
      headers: { "content-type": "application/json", "x-ts-server": "main", "x-ts-timestamp": String(now.getTime()), "x-ts-nonce": nonce,
        "x-ts-signature": sign({ secret: SECRET, serverName: "main", method: "POST", path, timestamp: now.getTime(), nonce, body: raw }) },
    }), { secret: SECRET, now: () => now });
    return { status: res.status, ...(await res.json()) };
  }

  it("full rank flow with {player} and {uuid} filled in", async () => {
    const a = await makeAccount(t.prisma, { username: "Rankee_1" });
    expect((await call("rank", { action: "create", name: "gold", displayName: "<gold>Gold", actorName: "Boss" })).ok).toBe(true);
    await call("rank", { action: "setcmd", name: "gold", kind: "grant", commands: ["lp user {player} parent add gold", "say {uuid}"], actorName: "Boss" });
    const g = await call("rank", { action: "give", name: "gold", username: "rankee_1", actorName: "Boss" });
    expect(g.data.commands).toEqual(["lp user Rankee_1 parent add gold", `say ${a.mcUuid}`]);
    expect((await call("rank", { action: "give", name: "gold", username: "rankee_1", actorName: "Boss" })).data).toMatchObject({ already: true, commands: [] });
    expect((await call("rank", { action: "info", username: "Rankee_1", actorName: "Boss" })).data.ranks[0]).toMatchObject({ name: "gold" });
    expect((await call("rank", { action: "list", actorName: "Boss" })).data.ranks.find((r: { name: string }) => r.name === "gold")).toMatchObject({ holders: 1 });
    expect((await call("rank", { action: "give", name: "gold", username: "Nobody_9", actorName: "Boss" })).status).toBe(404);
    expect((await call("rank", { action: "give", name: "nope", username: "Rankee_1", actorName: "Boss" })).status).toBe(404);
    expect((await call("rank", { action: "remove", name: "gold", username: "Rankee_1", actorName: "Boss" })).data).toMatchObject({ had: true });
    expect((await call("rank", { action: "delete", name: "gold", actorName: "Boss" })).ok).toBe(true);
  });

  it("webadmin add/remove/list over the API", async () => {
    const u = await makeLinkedUser(t.prisma);
    const r = await call("webadmin", { action: "add", username: u.username, actorName: "Boss" });
    expect(r).toMatchObject({ status: 200, data: { changed: true } });
    expect((await call("webadmin", { action: "list", actorName: "Boss" })).data.admins).toContain(u.username);
    expect((await call("webadmin", { action: "add", username: "NoSuch_1", actorName: "Boss" })).status).toBe(404);
  });
});
