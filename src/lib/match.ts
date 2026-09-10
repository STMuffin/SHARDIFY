export function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\b(feat|ft|with|con|prod|remaster(ed)?|remix|version|edit|radio|live|deluxe|bonus|track)\b.*$/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[b.length] ?? 0;
}

export function similarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const max = Math.max(x.length, y.length);
  return 1 - levenshtein(x, y) / max;
}

/** True when the guess is "close enough" to the expected value. */
export function isClose(guess: string, expected: string): boolean {
  const g = normalize(guess);
  const e = normalize(expected);
  if (!g || !e) return false;
  if (g === e) return true;
  if (e.length >= 5 && (g.includes(e) || e.includes(g))) return true;
  // Multiple artists: match any of them
  const parts = e.split(/\s+(?:and|x|vs)\s+/);
  if (parts.length > 1 && parts.some((p) => p.length > 2 && similarity(g, p) >= 0.85)) return true;
  return similarity(g, e) >= 0.82;
}
