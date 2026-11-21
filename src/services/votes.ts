import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { applyLocked, lockBalance } from "./tokens.ts";
import { getSetting, setSetting } from "./settings.ts";

export const VOTE_KEYS = { tokens: "vote.tokens", cooldownHours: "vote.cooldown_hours" } as const;
export const DEFAULT_VOTE_TOKENS = 1;
export const DEFAULT_COOLDOWN_HOURS = 24;
export const MAX_VOTE_TOKENS = 1000;

export interface VoteConfig { tokens: number; cooldownHours: number }
export interface VoteSiteInfo { serviceName: string; url: string }

export async function getVoteConfig(db: Db): Promise<VoteConfig> {
  const num = async (key: string, def: number) => {
    const raw = await getSetting(db, key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : def;
  };
  return { tokens: await num(VOTE_KEYS.tokens, DEFAULT_VOTE_TOKENS), cooldownHours: await num(VOTE_KEYS.cooldownHours, DEFAULT_COOLDOWN_HOURS) };
}

export async function setVoteConfig(db: Db, c: VoteConfig): Promise<void> {
  if (!Number.isInteger(c.tokens) || c.tokens < 0 || c.tokens > MAX_VOTE_TOKENS) throw new AppError("VALIDATION", `Tokens per vote must be a whole number from 0 to ${MAX_VOTE_TOKENS} (0 turns vote rewards off)`);
  if (!Number.isInteger(c.cooldownHours) || c.cooldownHours < 1 || c.cooldownHours > 168) throw new AppError("VALIDATION", "Cooldown must be 1 to 168 hours");
  await setSetting(db, VOTE_KEYS.tokens, String(c.tokens));
  await setSetting(db, VOTE_KEYS.cooldownHours, String(c.cooldownHours));
}

export async function listVoteSites(db: Db): Promise<VoteSiteInfo[]> {
  const rows = await db.voteSite.findMany({ where: { enabled: true }, orderBy: [{ sortOrder: "asc" }, { serviceName: "asc" }] });
  return rows.map((r) => ({ serviceName: r.serviceName, url: r.url }));
}

/** Admin text box: one site per line, "serviceName | https://vote-link". Replaces the whole list. */
export function parseVoteSites(text: string): VoteSiteInfo[] {
  const out: VoteSiteInfo[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const i = line.indexOf("|");
    if (i < 1) throw new AppError("VALIDATION", `Line "${line.slice(0, 40)}": use the format  name | https://link`);
    const serviceName = line.slice(0, i).trim();
    const url = line.slice(i + 1).trim();
    if (!serviceName || serviceName.length > 64) throw new AppError("VALIDATION", "Site name must be 1 to 64 characters");
    if (!/^https:\/\/[^\s]+$/.test(url) || url.length > 500) throw new AppError("VALIDATION", `"${serviceName}": the link must start with https://`);
    if (seen.has(serviceName.toLowerCase())) throw new AppError("VALIDATION", `"${serviceName}" is listed twice`);
    seen.add(serviceName.toLowerCase());
    out.push({ serviceName, url });
  }
  if (out.length > 20) throw new AppError("VALIDATION", "At most 20 vote sites");
  return out;
}

export async function replaceVoteSites(db: Db, sites: VoteSiteInfo[]): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.voteSite.deleteMany({});
    for (const [i, s] of sites.entries()) await tx.voteSite.create({ data: { serviceName: s.serviceName, url: s.url, sortOrder: i } });
  });
}

export interface VoteInput {
  mcAccountId: string;
  serviceName: string;
  /** Same vote => same key. Derived by the plugin from site + player + the vote's own timestamp. */
  idempotencyKey: string;
  now?: Date;
}
export interface VoteResult { replayed: boolean; awarded: number; balance: number; reason: "REWARDED" | "COOLDOWN" | "DISABLED" }

/**
 * Records one vote and pays out. Runs under the account's balance lock like every other money change, so two copies
 * of the same vote arriving together cannot both pay, and the cooldown check cannot be raced.
 */
export async function recordVote(db: Db, p: VoteInput): Promise<VoteResult> {
  const service = p.serviceName.trim();
  if (!service || service.length > 64) throw new AppError("VALIDATION", "Invalid vote site name");
  if (p.idempotencyKey.length < 8 || p.idempotencyKey.length > 120) throw new AppError("VALIDATION", "Invalid idempotency key");
  const now = p.now ?? new Date();
  const cfg = await getVoteConfig(db);

  return db.$transaction(async (tx) => {
    const balance = await lockBalance(tx, p.mcAccountId);
    const existing = await tx.voteRecord.findUnique({ where: { idempotencyKey: p.idempotencyKey } });
    if (existing) {
      if (existing.mcAccountId !== p.mcAccountId) throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different vote");
      return { replayed: true, awarded: existing.tokensAwarded, balance, reason: existing.tokensAwarded > 0 ? "REWARDED" : "COOLDOWN" } as VoteResult;
    }
    let awarded = 0;
    let reason: VoteResult["reason"] = "REWARDED";
    let newBalance = balance;
    if (cfg.tokens === 0) {
      reason = "DISABLED";
    } else {
      const since = new Date(now.getTime() - cfg.cooldownHours * 3600_000);
      const recent = await tx.voteRecord.findFirst({
        where: { mcAccountId: p.mcAccountId, serviceName: service, tokensAwarded: { gt: 0 }, createdAt: { gt: since } },
        select: { id: true },
      });
      if (recent) {
        reason = "COOLDOWN";
      } else {
        const r = await applyLocked(tx, { mcAccountId: p.mcAccountId, amount: cfg.tokens, type: "VOTE", idempotencyKey: `vote-tx-${p.idempotencyKey}`, reason: `Vote on ${service}` }, balance);
        awarded = cfg.tokens;
        newBalance = r.balance;
      }
    }
    await tx.voteRecord.create({ data: { mcAccountId: p.mcAccountId, serviceName: service, idempotencyKey: p.idempotencyKey, tokensAwarded: awarded, createdAt: now } });
    return { replayed: false, awarded, balance: newBalance, reason };
  });
}
