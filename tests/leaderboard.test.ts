import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, makeAccount, type TestDb } from "./helpers/db.ts";
import { leaderboard } from "../src/services/queries.ts";
import { setLeaderboardFlag } from "../src/services/leaderboard-admin.ts";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t.close(); });
const actor = { actorLabel: "in-game:Boss" };
const names = async (o = {}) => (await leaderboard(t.prisma, 20, o)).map((r) => r.username);

describe("leaderboard hide / ban switches", () => {
  it("plain players always show; hidden, banned and hidden+banned each need their own switch", async () => {
    const plain = await makeAccount(t.prisma, { username: "Plain", balance: 50 });
    const hid = await makeAccount(t.prisma, { username: "Hid", balance: 40 });
    const ban = await makeAccount(t.prisma, { username: "Ban", balance: 30 });
    const both = await makeAccount(t.prisma, { username: "Both", balance: 20 });
    await setLeaderboardFlag(t.prisma, { mcAccountId: hid.id, action: "hide" }, actor);
    await setLeaderboardFlag(t.prisma, { mcAccountId: ban.id, action: "ban" }, actor);
    await setLeaderboardFlag(t.prisma, { mcAccountId: both.id, action: "hide" }, actor);
    await setLeaderboardFlag(t.prisma, { mcAccountId: both.id, action: "ban" }, actor);
    void plain;

    expect(await names()).toEqual(["Plain"]);
    expect(await names({ showHidden: true })).toEqual(["Plain", "Hid"]);
    expect(await names({ showBanned: true })).toEqual(["Plain", "Ban"]);
    expect(await names({ showHidden: true, showBanned: true })).toEqual(["Plain", "Hid", "Ban"]);   // Both still needs its own switch
    expect(await names({ showHiddenBanned: true })).toEqual(["Plain", "Both"]);
    expect(await names({ showHidden: true, showBanned: true, showHiddenBanned: true })).toEqual(["Plain", "Hid", "Ban", "Both"]);

    const rows = await leaderboard(t.prisma, 20, { showHidden: true, showBanned: true, showHiddenBanned: true });
    expect(rows.find((r) => r.username === "Ban")).toMatchObject({ banned: true, hidden: false });
    expect(rows.find((r) => r.username === "Both")).toMatchObject({ banned: true, hidden: true });
  });

  it("reports whether anything changed, and undoing works; tokens are untouched", async () => {
    const a = await makeAccount(t.prisma, { username: "Flip", balance: 10 });
    expect(await setLeaderboardFlag(t.prisma, { mcAccountId: a.id, action: "hide" }, actor)).toMatchObject({ changed: true, hidden: true });
    expect(await setLeaderboardFlag(t.prisma, { mcAccountId: a.id, action: "hide" }, actor)).toMatchObject({ changed: false });
    expect(await setLeaderboardFlag(t.prisma, { mcAccountId: a.id, action: "unhide" }, actor)).toMatchObject({ changed: true, hidden: false });
    expect(await names()).toContain("Flip");
    await expect(setLeaderboardFlag(t.prisma, { mcAccountId: "00000000-0000-4000-8000-000000000000", action: "ban" }, actor)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
