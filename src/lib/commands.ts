import { AppError } from "./errors.ts";

/** First words that must never appear in a command an admin stores. The plugin enforces its own list too (defence in depth). */
const FORBIDDEN_FIRST_WORDS = new Set([
  "op", "deop", "stop", "restart", "reload", "rl", "ban-ip", "pardon", "whitelist",
  "minecraft:op", "minecraft:deop", "minecraft:stop", "minecraft:reload",
]);

/** One command per line. Strips a leading "/", rejects newlines/control characters, over-long lines and the forbidden commands. */
export function parseCommandLines(text: string, what = "command", maxLines = 20): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    if (line.startsWith("/")) line = line.slice(1).trim();
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(line)) throw new AppError("VALIDATION", `A ${what} contains invalid characters`);
    if (line.length > 256) throw new AppError("VALIDATION", `A ${what} is too long (max 256 characters)`);
    const first = line.split(/\s+/)[0]!.toLowerCase();
    if (FORBIDDEN_FIRST_WORDS.has(first)) throw new AppError("VALIDATION", `The command "${first}" is not allowed in a ${what}`);
    out.push(line);
  }
  if (out.length > maxLines) throw new AppError("VALIDATION", `At most ${maxLines} ${what}s`);
  return out;
}

export function parseLines(text: string, max: number, maxLen: number, what: string): string[] {
  const out = text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
  if (out.length > max) throw new AppError("VALIDATION", `At most ${max} ${what} lines`);
  for (const l of out) if (l.length > maxLen) throw new AppError("VALIDATION", `A ${what} line is too long (max ${maxLen} characters)`);
  return out;
}

/** https only; used for product images, logo and background. */
export function parseHttpsUrl(value: string, what: string, max = 250): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.length > max || !/^https:\/\/[^\s"'<>\\]+$/.test(v)) throw new AppError("VALIDATION", `${what} must be a link starting with https://`);
  try { new URL(v); } catch { throw new AppError("VALIDATION", `${what} is not a valid link`); }
  return v;
}

const UPLOADED = /^\/img\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A picture reference: an https link, or the path of a picture uploaded here (/img/<id>). */
export function parseImageRef(value: string, what: string): string | null {
  const v = value.trim();
  if (UPLOADED.test(v)) return v;
  return parseHttpsUrl(v, what);
}
