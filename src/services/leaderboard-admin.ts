import type { Db } from "../lib/db.ts";
import { writeAudit } from "../lib/audit.ts";
import { AppError } from "../lib/errors.ts";

type Actor = { actorUserId?: string | null; actorLabel?: string | null };
export type LbAction = "hide" | "unhide" | "ban" | "unban";

/** Hide a player from the leaderboards, or ban them from it (cheaters). Does not touch their tokens. */
export async function setLeaderboardFlag(db: Db, p: { mcAccountId: string; action: LbAction }, actor: Actor) {
  return db.$transaction(async (tx) => {
    const a = await tx.minecraftAccount.findUnique({ where: { id: p.mcAccountId }, select: { id: true, username: true, lbHidden: true, lbBanned: true } });
    if (!a) throw new AppError("NOT_FOUND", "Unknown player");
    const data = p.action === "hide" ? { lbHidden: true } : p.action === "unhide" ? { lbHidden: false } : p.action === "ban" ? { lbBanned: true } : { lbBanned: false };
    const changed = (data.lbHidden !== undefined && data.lbHidden !== a.lbHidden) || (data.lbBanned !== undefined && data.lbBanned !== a.lbBanned);
    if (changed) {
      await tx.minecraftAccount.update({ where: { id: a.id }, data });
      await writeAudit(tx, { ...actor, action: `leaderboard.${p.action}`, targetType: "minecraft_account", targetId: a.id, details: { username: a.username } });
    }
    const now = { ...{ lbHidden: a.lbHidden, lbBanned: a.lbBanned }, ...data };
    return { changed, username: a.username, hidden: now.lbHidden, banned: now.lbBanned };
  });
}
