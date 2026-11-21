import type { Db } from "../lib/db.ts";
import { writeAudit } from "../lib/audit.ts";
import { AppError } from "../lib/errors.ts";

type Actor = { actorUserId?: string | null; actorLabel?: string | null };

/** Makes the website account linked to a Minecraft player an admin (or removes that). Used by /tokens admin addadmin|removeadmin. */
export async function setWebAdmin(db: Db, p: { mcAccountId: string; admin: boolean }, actor: Actor) {
  return db.$transaction(async (tx) => {
    const acct = await tx.minecraftAccount.findUnique({ where: { id: p.mcAccountId }, include: { user: true } });
    if (!acct) throw new AppError("NOT_FOUND", "Unknown player");
    const user = acct.user;
    if (!user || user.status !== "ACTIVE") throw new AppError("INVALID_STATE", `${acct.username} has no linked website account yet. They must register on the website and confirm with /rconfirmt first.`);
    const target = p.admin ? "ADMIN" : "PLAYER";
    if (user.role === target) return { changed: false, username: acct.username };
    if (!p.admin) {
      const admins = await tx.user.count({ where: { role: "ADMIN", status: "ACTIVE" } });
      if (admins <= 1) throw new AppError("INVALID_STATE", "That is the last admin. Make someone else an admin first.");
    }
    await tx.user.update({ where: { id: user.id }, data: { role: target } });
    await writeAudit(tx, { ...actor, action: p.admin ? "web-admin.add" : "web-admin.remove", targetType: "user", targetId: user.id, details: { username: acct.username } });
    return { changed: true, username: acct.username };
  });
}

export async function listWebAdmins(db: Db) {
  const users = await db.user.findMany({ where: { role: "ADMIN" }, select: { minecraftUsername: true }, orderBy: { minecraftUsername: "asc" } });
  return users.map((u) => u.minecraftUsername);
}
