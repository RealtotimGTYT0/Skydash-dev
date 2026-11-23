import { parseMiniMessage } from "../lib/minimessage.ts";

/** Renders MiniMessage / &-code text safely (no HTML is ever injected). */
export function Rich({ text, className, animated }: { text: string; className?: string; animated?: boolean }) {
  const segs = parseMiniMessage(text);
  return (
    <span className={[className, animated ? "rank-anim" : ""].filter(Boolean).join(" ") || undefined} style={{ whiteSpace: "pre-wrap" }}>
      {segs.map((s, i) => (
        <span key={i} style={{
          color: s.color, fontWeight: s.bold ? 700 : undefined, fontStyle: s.italic ? "italic" : undefined,
          textDecoration: [s.underline ? "underline" : "", s.strike ? "line-through" : ""].filter(Boolean).join(" ") || undefined,
        }}>{s.text}</span>
      ))}
    </span>
  );
}
