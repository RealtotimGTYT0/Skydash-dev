import type { Db } from "../lib/db.ts";
import { writeAudit } from "../lib/audit.ts";
import { AppError } from "../lib/errors.ts";
import { parseCommandLines } from "../lib/commands.ts";

type Actor = { actorUserId?: string | null; actorLabel?: string | null };
const NAME = /^[a-z0-9_-]{1,32}$/;

const norm = (name: string) => {
  const n = name.trim().toLowerCase();
  if (!NAME.test(n)) throw new AppError("VALIDATION", "Rank id must be 1 to 32 letters, digits, _ or - (example: vip)");
  return n;
};
const checkDisplay = (d: string) => {
  const v = d.trim();
  if (!v || v.length > 120) throw new AppError("VALIDATION", "Display name must be 1 to 120 characters");
  return v;
};

const LP_GROUP = /^[A-Za-z0-9_.-]{1,64}$/;
/** "" / "none" = no link. Anything else must look like a LuckPerms group name (so nothing odd can reach the console command). */
export function checkLpGroup(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  if (t === "" || t.toLowerCase() === "none") return null;
  if (!LP_GROUP.test(t)) throw new AppError("VALIDATION", "LuckPerms group names use letters, digits, _ - . only (max 64)");
  return t;
}
type RankCmds = { grantCommands: string[]; revokeCommands: string[]; lpGroup: string | null };
/** What the server runs when the rank is given: its own commands, then the LuckPerms link. {uuid} is filled in by the website/plugin. */
export const grantCommandsOf = (r: RankCmds): string[] => [...r.grantCommands, ...(r.lpGroup ? [`lp user {uuid} parent add ${r.lpGroup}`] : [])];
export const revokeCommandsOf = (r: RankCmds): string[] => [...r.revokeCommands, ...(r.lpGroup ? [`lp user {uuid} parent remove ${r.lpGroup}`] : [])];

export async function createRank(db: Db, p: { name: string; displayName?: string; priority?: number; animated?: boolean; lpGroup?: string }, actor: Actor) {
  const name = norm(p.name);
  const displayName = checkDisplay(p.displayName ?? name);
  const priority = p.priority ?? 0;
  if (!Number.isInteger(priority) || priority < -1000 || priority > 1000) throw new AppError("VALIDATION", "Priority must be -1000 to 1000");
  if (await db.rank.findUnique({ where: { name } })) throw new AppError("INVALID_STATE", `Rank "${name}" already exists`);
  if ((await db.rank.count()) >= 100) throw new AppError("VALIDATION", "At most 100 ranks");
  return db.$transaction(async (tx) => {
    const r = await tx.rank.create({ data: { name, displayName, priority, animated: p.animated ?? false, lpGroup: checkLpGroup(p.lpGroup) } });
    await writeAudit(tx, { ...actor, action: "rank.create", targetType: "rank", targetId: r.id, details: { name } });
    return r;
  });
}

export async function updateRank(db: Db, p: { name: string; displayName?: string; priority?: number; animated?: boolean; lpGroup?: string }, actor: Actor) {
  const name = norm(p.name);
  const r = await db.rank.findUnique({ where: { name } });
  if (!r) throw new AppError("NOT_FOUND", `No rank called "${name}"`);
  const data: { displayName?: string; priority?: number; animated?: boolean; lpGroup?: string | null } = {};
  if (p.animated !== undefined) data.animated = p.animated;
  if (p.lpGroup !== undefined) data.lpGroup = checkLpGroup(p.lpGroup);
  if (p.displayName !== undefined) data.displayName = checkDisplay(p.displayName);
  if (p.priority !== undefined) {
    if (!Number.isInteger(p.priority) || p.priority < -1000 || p.priority > 1000) throw new AppError("VALIDATION", "Priority must be -1000 to 1000");
    data.priority = p.priority;
  }
  return db.$transaction(async (tx) => {
    const u = await tx.rank.update({ where: { id: r.id }, data });
    await writeAudit(tx, { ...actor, action: "rank.update", targetType: "rank", targetId: r.id, details: data });
    return u;
  });
}

export async function setRankCommands(db: Db, p: { name: string; kind: "grant" | "revoke"; commands: string[] }, actor: Actor) {
  const name = norm(p.name);
  const r = await db.rank.findUnique({ where: { name } });
  if (!r) throw new AppError("NOT_FOUND", `No rank called "${name}"`);
  const commands = parseCommandLines(p.commands.join("\n"), "command", 10);
  await db.$transaction(async (tx) => {
    await tx.rank.update({ where: { id: r.id }, data: p.kind === "grant" ? { grantCommands: commands } : { revokeCommands: commands } });
    await writeAudit(tx, { ...actor, action: "rank.commands", targetType: "rank", targetId: r.id, details: { kind: p.kind, count: commands.length } });
  });
  return commands;
}

export async function deleteRank(db: Db, nameIn: string, actor: Actor) {
  const name = norm(nameIn);
  const r = await db.rank.findUnique({ where: { name }, include: { _count: { select: { holders: true } } } });
  if (!r) throw new AppError("NOT_FOUND", `No rank called "${name}"`);
  await db.$transaction(async (tx) => {
    await tx.rank.delete({ where: { id: r.id } });
    await writeAudit(tx, { ...actor, action: "rank.delete", targetType: "rank", targetId: r.id, details: { name, holders: r._count.holders } });
  });
  return { holders: r._count.holders };
}

export async function listRanks(db: Db) {
  const rows = await db.rank.findMany({ orderBy: [{ priority: "desc" }, { name: "asc" }], include: { _count: { select: { holders: true } } } });
  return rows.map((r) => ({ name: r.name, displayName: r.displayName, priority: r.priority, holders: r._count.holders,
    animated: r.animated, lpGroup: r.lpGroup, grantCommands: r.grantCommands, revokeCommands: r.revokeCommands }));
}

/** Gives a player a rank. Returns the grant commands (with {player}/{uuid} left in) so the plugin can run them. */
export async function grantRank(db: Db, p: { name: string; mcAccountId: string }, actor: Actor & { grantedBy?: string }) {
  const name = norm(p.name);
  const r = await db.rank.findUnique({ where: { name } });
  if (!r) throw new AppError("NOT_FOUND", `No rank called "${name}"`);
  return db.$transaction(async (tx) => {
    const had = await tx.accountRank.findUnique({ where: { mcAccountId_rankId: { mcAccountId: p.mcAccountId, rankId: r.id } } });
    if (!had) {
      await tx.accountRank.create({ data: { mcAccountId: p.mcAccountId, rankId: r.id, grantedBy: actor.grantedBy ?? actor.actorLabel ?? null } });
      await writeAudit(tx, { ...actor, action: "rank.grant", targetType: "account", targetId: p.mcAccountId, details: { rank: name } });
    }
    return { already: Boolean(had), commands: had ? [] : grantCommandsOf(r), displayName: r.displayName };
  });
}

export async function revokeRank(db: Db, p: { name: string; mcAccountId: string }, actor: Actor) {
  const name = norm(p.name);
  const r = await db.rank.findUnique({ where: { name } });
  if (!r) throw new AppError("NOT_FOUND", `No rank called "${name}"`);
  return db.$transaction(async (tx) => {
    const had = await tx.accountRank.findUnique({ where: { mcAccountId_rankId: { mcAccountId: p.mcAccountId, rankId: r.id } } });
    if (had) {
      await tx.accountRank.delete({ where: { mcAccountId_rankId: { mcAccountId: p.mcAccountId, rankId: r.id } } });
      await writeAudit(tx, { ...actor, action: "rank.revoke", targetType: "account", targetId: p.mcAccountId, details: { rank: name } });
    }
    return { had: Boolean(had), commands: had ? revokeCommandsOf(r) : [] };
  });
}

export async function ranksOf(db: Db, mcAccountId: string) {
  const rows = await db.accountRank.findMany({ where: { mcAccountId }, include: { rank: true }, orderBy: [{ rank: { priority: "desc" } }, { createdAt: "asc" }] });
  return rows.map((r) => ({ name: r.rank.name, displayName: r.rank.displayName, priority: r.rank.priority, animated: r.rank.animated }));
}

/** Highest-priority rank display name for each of the given accounts (one query). */
export async function topRankNames(db: Db, mcAccountIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (mcAccountIds.length === 0) return out;
  const rows = await db.accountRank.findMany({ where: { mcAccountId: { in: mcAccountIds } }, include: { rank: true }, orderBy: [{ rank: { priority: "desc" } }, { createdAt: "asc" }] });
  for (const r of rows) if (!out.has(r.mcAccountId)) out.set(r.mcAccountId, r.rank.displayName);
  return out;
}
