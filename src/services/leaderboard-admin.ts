import type { Db } from "../lib/db.ts";
import { writeAudit } from "../lib/audit.ts";
import { AppError } from "../lib/errors.ts";

type Actor = { actorUserId?: string | null; actorLabel?: string | null };

/** Disqualifies (hidden = true) or re-qualifies a player on the leaderboard. Their tokens are not touched. */
export async function setLeaderboardHidden(db: Db, p: { mcAccountId: string; hidden: boolean }, actor: Actor) {
  return db.$transaction(async (tx) => {
    const a = await tx.minecraftAccount.findUnique({ where: { id: p.mcAccountId } });
    if (!a) throw new AppError("NOT_FOUND", "Unknown player");
    if (a.leaderboardHidden === p.hidden) return { changed: false, username: a.username };
    await tx.minecraftAccount.update({ where: { id: a.id }, data: { leaderboardHidden: p.hidden } });
    await writeAudit(tx, { ...actor, action: p.hidden ? "leaderboard.disqualify" : "leaderboard.requalify", targetType: "account", targetId: a.id, details: { username: a.username } });
    return { changed: true, username: a.username };
  });
}

export async function listLeaderboardHidden(db: Db): Promise<string[]> {
  const rows = await db.minecraftAccount.findMany({ where: { leaderboardHidden: true }, select: { username: true }, orderBy: { username: "asc" } });
  return rows.map((r) => r.username);
}
