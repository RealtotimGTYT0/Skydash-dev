import type { Db } from "../lib/db.ts";
import { writeAudit } from "../lib/audit.ts";
import { AppError } from "../lib/errors.ts";

export const MAX_IMAGE_BYTES = 1_500_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Decides the picture type from the file's first bytes (never from the file name). SVG is refused on purpose: it can contain scripts. */
export function sniffImage(b: Uint8Array): "image/png" | "image/jpeg" | "image/gif" | "image/webp" | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (b.length >= 6 && (at(0, 0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || at(0, 0x47, 0x49, 0x46, 0x38, 0x39, 0x61))) return "image/gif";
  if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

/** Stores an uploaded picture and returns the path to use as its link (/img/<id>). */
export async function saveImage(db: Db, bytes: Uint8Array, actorLabel: string | null, actorUserId?: string | null): Promise<string> {
  if (bytes.length === 0) throw new AppError("VALIDATION", "That picture file is empty");
  if (bytes.length > MAX_IMAGE_BYTES) throw new AppError("VALIDATION", `Picture is too big (max ${Math.floor(MAX_IMAGE_BYTES / 1000)} KB). Make it smaller and try again`);
  const mime = sniffImage(bytes);
  if (!mime) throw new AppError("VALIDATION", "Pictures must be PNG, JPG, GIF or WebP");
  if ((await db.uploadedImage.count()) >= 300) throw new AppError("VALIDATION", "Too many uploaded pictures (max 300)");
  return db.$transaction(async (tx) => {
    const row = await tx.uploadedImage.create({ data: { mime, data: Buffer.from(bytes), size: bytes.length, createdBy: actorLabel } });
    await writeAudit(tx, { actorUserId: actorUserId ?? null, actorLabel, action: "image.upload", targetType: "image", targetId: row.id, details: { mime, size: bytes.length } });
    return `/img/${row.id}`;
  });
}

export async function getImage(db: Db, id: string): Promise<{ mime: string; data: Uint8Array } | null> {
  if (!UUID.test(id)) return null;
  const r = await db.uploadedImage.findUnique({ where: { id }, select: { mime: true, data: true } });
  return r ? { mime: r.mime, data: r.data } : null;
}
