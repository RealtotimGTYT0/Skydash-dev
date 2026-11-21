import { describe, expect, it } from "vitest";
import { parseMiniMessage, stripMiniMessage, toMiniMessage } from "../src/lib/minimessage.ts";

describe("MiniMessage renderer", () => {
  it("colors, decorations and nesting", () => {
    expect(parseMiniMessage("plain")).toEqual([{ text: "plain", color: undefined, bold: undefined, italic: undefined, underline: undefined, strike: undefined }]);
    const s = parseMiniMessage("<red>a<bold>b</bold>c</red>d");
    expect(s.map((x) => [x.text, x.color, x.bold])).toEqual([["a", "#ff5555", undefined], ["b", "#ff5555", true], ["c", "#ff5555", undefined], ["d", undefined, undefined]]);
    expect(parseMiniMessage("<#abc>x")[0]!.color).toBe("#aabbcc");
    expect(parseMiniMessage("<color:#00ff00>x")[0]!.color).toBe("#00ff00");
  });
  it("legacy & codes still work", () => {
    expect(toMiniMessage("&6Hello &lworld &#ff0000red")).toBe("<gold>Hello <bold>world <#ff0000>red");
    const s = parseMiniMessage("&cRed&rNormal");
    expect(s[0]).toMatchObject({ text: "Red", color: "#ff5555" });
    expect(s[1]).toMatchObject({ text: "Normal", color: undefined });
  });
  it("gradient and rainbow color each character", () => {
    const g = parseMiniMessage("<gradient:#000000:#ffffff>abc</gradient>");
    expect(g.map((x) => x.color)).toEqual(["#000000", "#808080", "#ffffff"]);
    const r = parseMiniMessage("<rainbow>abcd</rainbow>");
    expect(r).toHaveLength(4);
    expect(new Set(r.map((x) => x.color)).size).toBe(4);
  });
  it("newline tags and unknown tags", () => {
    expect(stripMiniMessage("a<newline>b")).toBe("a\nb");
    expect(stripMiniMessage("1 <3 you <notatag> ok")).toBe("1 <3 you <notatag> ok");
    expect(stripMiniMessage("\\<red>not a tag")).toBe("<red>not a tag");
  });
  it("can never produce anything but validated colours and text (no HTML, links or CSS injection)", () => {
    const evil = [`<click:open_url:https://evil.example>x</click>`, `<color:red;background:url(x)>y`, `<script>alert(1)</script>`, `<hover:show_text:'<red>z'>w`, `<#12345g>q`];
    for (const e of evil) for (const seg of parseMiniMessage(e)) {
      expect(seg.color === undefined || /^#[0-9a-f]{6}$/.test(seg.color)).toBe(true);
    }
    expect(stripMiniMessage(`<script>alert(1)</script>`)).toBe("<script>alert(1)</script>");   // shown as harmless text (React escapes it)
  });
  it("is safe on huge or broken input", () => {
    expect(() => parseMiniMessage("<".repeat(5000))).not.toThrow();
    expect(stripMiniMessage("x".repeat(10000)).length).toBe(3000);
    expect(() => parseMiniMessage("</red></bold><gradient:>x")).not.toThrow();
  });
});
