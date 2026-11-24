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

function normalizedSimilarity(x: string, y: string): number {
  if (!x || !y) return 0;
  if (x === y) return 1;
  const max = Math.max(x.length, y.length);
  return 1 - levenshtein(x, y) / max;
}

export function similarity(a: string, b: string): number {
  return normalizedSimilarity(normalize(a), normalize(b));
}

function isNormalizedClose(g: string, e: string): boolean {
  if (!g || !e) return false;
  if (g === e) return true;
  if (e.length >= 5 && (g.includes(e) || e.includes(g))) return true;
  // Multiple artists: match any of them without normalizing the answer again.
  const parts = e.split(/\s+(?:and|x|vs)\s+/);
  if (parts.length > 1 && parts.some((p) => p.length > 2 && normalizedSimilarity(g, p) >= 0.85)) return true;
  // Different lengths cannot reach the threshold; skip the matrix calculation.
  if (1 - Math.abs(g.length - e.length) / Math.max(g.length, e.length) < 0.82) return false;
  return normalizedSimilarity(g, e) >= 0.82;
}

/** True when the guess is "close enough" to the expected value. */
export function isClose(guess: string, expected: string): boolean {
  return isNormalizedClose(normalize(guess), normalize(expected));
}

/**
 * Prepares a round's expected values once. Each chat attempt then normalizes only
 * the new text, rather than processing the same title and artist on every key send.
 */
export function createAnswerVerifier(title: string, artist: string) {
  const expectedTitle = normalize(title);
  const expectedArtist = normalize(artist);
  return (guess: string, titleFound: boolean, artistFound: boolean) => {
    const normalizedGuess = normalize(guess);
    return {
      titleCorrect: !titleFound && isNormalizedClose(normalizedGuess, expectedTitle),
      artistCorrect: !artistFound && isNormalizedClose(normalizedGuess, expectedArtist),
    };
  };
}

/** How close a guess is to a value, mixing whole-string and word matches. */
export function closeness(guess: string, expected: string): number {
  const g = normalize(guess);
  const e = normalize(expected);
  if (!g || !e) return 0;
  const whole = similarity(g, e);
  const gw = g.split(" ").filter((w) => w.length > 2);
  const ew = e.split(" ").filter((w) => w.length > 2);
  let word = 0;
  for (const a of gw) {
    for (const b of ew) {
      word = Math.max(word, similarity(a, b) * 0.9);
    }
  }
  return Math.max(whole, word);
}

/** A small clue: first letter and number of words. */
export function shapeHint(value: string): string {
  const clean = normalize(value);
  const words = clean.split(" ").filter(Boolean);
  const first = (words[0] ?? "?")[0]?.toUpperCase() ?? "?";
  return `empieza por «${first}» y tiene ${words.length} ${
    words.length === 1 ? "palabra" : "palabras"
  }`;
}

/** Message shown when a wrong guess is nearly right. */
export function nearMissHint(
  guess: string,
  title: string,
  artist: string,
  titleFound: boolean,
  artistFound: boolean,
): string | null {
  const st = titleFound ? 0 : closeness(guess, title);
  const sa = artistFound ? 0 : closeness(guess, artist);
  const best = Math.max(st, sa);
  if (best < 0.45) return null;
  const isTitle = st >= sa;
  const what = isTitle ? "la canción" : "el artista";
  const value = isTitle ? title : artist;
  if (best >= 0.7) return `¡Muy caliente! Casi tienes ${what}: ${shapeHint(value)}`;
  return `Vas por buen camino con ${what}: ${shapeHint(value)}`;
}

