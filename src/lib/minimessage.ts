/**
 * A small, SAFE MiniMessage renderer for the website (colors, bold/italic/underline/strikethrough, gradients, rainbow,
 * newlines, plus the old &-codes). It only ever produces text segments with a validated colour, so nothing from an admin's
 * text can become HTML, a link, a script or arbitrary CSS. Unknown tags are shown as plain text.
 */
export interface Segment { text: string; color?: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean }

const NAMED: Record<string, string> = {
  black: "#000000", dark_blue: "#0000aa", dark_green: "#00aa00", dark_aqua: "#00aaaa", dark_red: "#aa0000", dark_purple: "#aa00aa",
  gold: "#ffaa00", gray: "#aaaaaa", grey: "#aaaaaa", dark_gray: "#555555", dark_grey: "#555555", blue: "#5555ff", green: "#55ff55",
  aqua: "#55ffff", red: "#ff5555", light_purple: "#ff55ff", yellow: "#ffff55", white: "#ffffff",
};
const LEGACY: Record<string, string> = {
  "0": "black", "1": "dark_blue", "2": "dark_green", "3": "dark_aqua", "4": "dark_red", "5": "dark_purple", "6": "gold", "7": "gray",
  "8": "dark_gray", "9": "blue", a: "green", b: "aqua", c: "red", d: "light_purple", e: "yellow", f: "white",
  l: "bold", o: "italic", n: "underlined", m: "strikethrough", r: "reset",
};
const DECOR: Record<string, "bold" | "italic" | "underline" | "strike"> = {
  bold: "bold", b: "bold", italic: "italic", i: "italic", em: "italic", underlined: "underline", u: "underline", strikethrough: "strike", st: "strike",
};
const MAX_LEN = 3000;

export function toMiniMessage(input: string): string {
  return input
    .replace(/&#([0-9a-fA-F]{6})/g, "<#$1>")
    .replace(/&([0-9a-fk-orA-FK-OR])/g, (m, c: string) => {
      const name = LEGACY[c.toLowerCase()];
      if (!name) return ""; // &k (obfuscated) is dropped
      return `<${name}>`;
    });
}

function parseColor(v: string): string | null {
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return "#" + [...s.slice(1)].map((c) => c + c).join("");
  return NAMED[s] ?? null;
}

const hexToRgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgbToHex = (r: number, g: number, b: number) => "#" + [r, g, b].map((n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0")).join("");
function lerpColors(stops: string[], t: number): string {
  if (stops.length === 1) return stops[0]!;
  const pos = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(Math.floor(pos), stops.length - 2);
  const f = pos - i;
  const a = hexToRgb(stops[i]!), b = hexToRgb(stops[i + 1]!);
  return rgbToHex(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
}
function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

interface Frame { tag: string; color?: string; deco?: "bold" | "italic" | "underline" | "strike"; grad?: { id: number; stops: string[] } ; rainbow?: { id: number } }
interface Ch { ch: string; color?: string; bold: boolean; italic: boolean; underline: boolean; strike: boolean; grad?: { id: number; stops: string[]; idx: number }; rainbow?: { id: number; idx: number } }

export function parseMiniMessage(input: string): Segment[] {
  const src = toMiniMessage(input.slice(0, MAX_LEN));
  const stack: Frame[] = [];
  const chars: Ch[] = [];
  const counts = new Map<number, number>();
  let nextId = 1;
  const style = () => {
    const st = { bold: false, italic: false, underline: false, strike: false } as Pick<Ch, "bold" | "italic" | "underline" | "strike">;
    let color: string | undefined, grad: Frame["grad"], rainbow: Frame["rainbow"];
    for (const f of stack) {
      if (f.color) { color = f.color; grad = undefined; rainbow = undefined; }
      if (f.grad) { grad = f.grad; rainbow = undefined; color = undefined; }
      if (f.rainbow) { rainbow = f.rainbow; grad = undefined; color = undefined; }
      if (f.deco) st[f.deco] = true;
    }
    return { ...st, color, grad, rainbow };
  };
  const push = (text: string) => {
    for (const ch of text) {
      const s = style();
      const item: Ch = { ch, color: s.color, bold: s.bold, italic: s.italic, underline: s.underline, strike: s.strike };
      if (s.grad) { const idx = counts.get(s.grad.id) ?? 0; counts.set(s.grad.id, idx + 1); item.grad = { ...s.grad, idx }; }
      if (s.rainbow) { const idx = counts.get(s.rainbow.id) ?? 0; counts.set(s.rainbow.id, idx + 1); item.rainbow = { id: s.rainbow.id, idx }; }
      chars.push(item);
    }
  };

  let i = 0, buf = "";
  const flush = () => { if (buf) { push(buf); buf = ""; } };
  while (i < src.length) {
    const c = src[i]!;
    if (c === "\\" && src[i + 1] === "<") { buf += "<"; i += 2; continue; }
    if (c === "<") {
      const m = /^<(\/?)([a-zA-Z_#0-9][a-zA-Z_#0-9:.,-]*)>/.exec(src.slice(i, i + 200));
      if (m) {
        const closing = m[1] === "/";
        const parts = m[2]!.split(":");
        const name = parts[0]!.toLowerCase();
        const args = parts.slice(1);
        let handled = true;
        if (closing) {
          flush();
          const key = name.startsWith("#") || NAMED[name] || name === "c" || name === "colour" ? "color" : name;
          let found = false;
          for (let k = stack.length - 1; k >= 0; k--) {
            const f = stack[k]!;
            if (f.tag === key || (DECOR[key] && f.tag === DECOR[key])) { stack.splice(k); found = true; break; }
          }
          if (!found) handled = false;   // an unknown or unmatched closing tag is shown as plain text
        } else if (name === "reset" || name === "r") { flush(); stack.length = 0; }
        else if (name === "newline" || name === "br") { flush(); push("\n"); }
        else if (name === "color" || name === "c" || name === "colour") { const col = parseColor(args[0] ?? ""); if (col) { flush(); stack.push({ tag: "color", color: col }); } else handled = false; }
        else if (name.startsWith("#")) { const col = parseColor(name); if (col) { flush(); stack.push({ tag: "color", color: col }); } else handled = false; }
        else if (NAMED[name]) { flush(); stack.push({ tag: "color", color: NAMED[name]! }); }
        else if (DECOR[name]) { flush(); stack.push({ tag: DECOR[name]!, deco: DECOR[name]! }); }
        else if (name === "gradient") {
          const stops = args.map(parseColor).filter((x): x is string => Boolean(x));
          flush(); stack.push({ tag: "gradient", grad: { id: nextId++, stops: stops.length >= 2 ? stops : ["#ffffff", "#aaaaaa"] } });
        } else if (name === "rainbow") { flush(); stack.push({ tag: "rainbow", rainbow: { id: nextId++ } }); }
        else handled = false;
        if (handled) { i += m[0].length; continue; }
      }
    }
    buf += c; i++;
  }
  flush();

  const out: Segment[] = [];
  for (const ch of chars) {
    let color = ch.color;
    if (ch.grad) { const n = counts.get(ch.grad.id)!; color = lerpColors(ch.grad.stops, n <= 1 ? 0 : ch.grad.idx / (n - 1)); }
    else if (ch.rainbow) { const n = counts.get(ch.rainbow.id)!; color = hslToHex(((n <= 1 ? 0 : ch.rainbow.idx / n) * 360) % 360, 1, 0.65); }
    const last = out[out.length - 1];
    if (last && last.color === color && !!last.bold === ch.bold && !!last.italic === ch.italic && !!last.underline === ch.underline && !!last.strike === ch.strike && !ch.grad && !ch.rainbow) last.text += ch.ch;
    else out.push({ text: ch.ch, color, bold: ch.bold || undefined, italic: ch.italic || undefined, underline: ch.underline || undefined, strike: ch.strike || undefined });
  }
  return out;
}

/** Plain text without any tags (for page titles, alt text, comparisons). */
export const stripMiniMessage = (s: string): string => parseMiniMessage(s).map((x) => x.text).join("");
