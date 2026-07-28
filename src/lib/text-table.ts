/**
 * Monospace table rendering for Slack messages.
 *
 * Slack mrkdwn supports neither markdown tables nor headings, so tabular output
 * has to go inside a code fence and be aligned by hand. Column widths are
 * measured in display columns, counting CJK/fullwidth characters as 2 — using
 * String.length here would misalign every table with Japanese headers.
 */

/** Display width in terminal columns, counting fullwidth characters as 2. */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    const wide =
      (c >= 0x1100 && c <= 0x115f) || // Hangul Jamo
      (c >= 0x2e80 && c <= 0xa4cf) || // CJK radicals … Yi
      (c >= 0xac00 && c <= 0xd7a3) || // Hangul syllables
      (c >= 0xf900 && c <= 0xfaff) || // CJK compatibility ideographs
      (c >= 0xfe30 && c <= 0xfe6f) || // CJK compatibility forms
      (c >= 0xff00 && c <= 0xff60) || // Fullwidth forms
      (c >= 0xffe0 && c <= 0xffe6);
    w += wide ? 2 : 1;
  }
  return w;
}

export function padEndWide(s: string, target: number): string {
  return s + " ".repeat(Math.max(0, target - displayWidth(s)));
}

export function padStartWide(s: string, target: number): string {
  return " ".repeat(Math.max(0, target - displayWidth(s))) + s;
}

/**
 * Renders an aligned table. The first column is left-aligned (labels), the rest
 * right-aligned (numbers). Wrap the result in a code fence before posting.
 */
export function monoTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(displayWidth(h), ...rows.map((r) => displayWidth(r[i] ?? ""))),
  );
  const line = (cells: string[]): string =>
    cells
      .map((c, i) =>
        i === 0 ? padEndWide(c ?? "", widths[i]) : padStartWide(c ?? "", widths[i]),
      )
      .join("  ")
      .trimEnd();
  const sep = widths.map((w) => "─".repeat(w)).join("  ");
  return [line(headers), sep, ...rows.map(line)].join("\n");
}
