const JAPANESE_SYLLABLES: Record<string, string> = {
  キャ: "kya", キュ: "kyu", キョ: "kyo", ギャ: "gya", ギュ: "gyu", ギョ: "gyo",
  シャ: "sha", シュ: "shu", ショ: "sho", ジャ: "ja", ジュ: "ju", ジョ: "jo",
  チャ: "cha", チュ: "chu", チョ: "cho", ニャ: "nya", ニュ: "nyu", ニョ: "nyo",
  ヒャ: "hya", ヒュ: "hyu", ヒョ: "hyo", ビャ: "bya", ビュ: "byu", ビョ: "byo",
  ピャ: "pya", ピュ: "pyu", ピョ: "pyo", ミャ: "mya", ミュ: "myu", ミョ: "myo",
  リャ: "rya", リュ: "ryu", リョ: "ryo",
  きゃ: "kya", きゅ: "kyu", きょ: "kyo", ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
  しゃ: "sha", しゅ: "shu", しょ: "sho", じゃ: "ja", じゅ: "ju", じょ: "jo",
  ちゃ: "cha", ちゅ: "chu", ちょ: "cho", にゃ: "nya", にゅ: "nyu", にょ: "nyo",
  ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo", びゃ: "bya", びゅ: "byu", びょ: "byo",
  ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo", みゃ: "mya", みゅ: "myu", みょ: "myo",
  りゃ: "rya", りゅ: "ryu", りょ: "ryo",
  ア: "a", イ: "i", ウ: "u", エ: "e", オ: "o", カ: "ka", キ: "ki", ク: "ku", ケ: "ke", コ: "ko",
  サ: "sa", シ: "shi", ス: "su", セ: "se", ソ: "so", タ: "ta", チ: "chi", ツ: "tsu", テ: "te", ト: "to",
  ナ: "na", ニ: "ni", ヌ: "nu", ネ: "ne", ノ: "no", ハ: "ha", ヒ: "hi", フ: "fu", ヘ: "he", ホ: "ho",
  マ: "ma", ミ: "mi", ム: "mu", メ: "me", モ: "mo", ヤ: "ya", ユ: "yu", ヨ: "yo", ラ: "ra", リ: "ri",
  ル: "ru", レ: "re", ロ: "ro", ワ: "wa", ヲ: "o", ン: "n", ガ: "ga", ギ: "gi", グ: "gu", ゲ: "ge", ゴ: "go",
  ザ: "za", ジ: "ji", ズ: "zu", ゼ: "ze", ゾ: "zo", ダ: "da", ヂ: "ji", ヅ: "zu", デ: "de", ド: "do",
  バ: "ba", ビ: "bi", ブ: "bu", ベ: "be", ボ: "bo", パ: "pa", ピ: "pi", プ: "pu", ペ: "pe", ポ: "po",
  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o", や: "ya", ゆ: "yu", よ: "yo", つ: "tsu", ん: "n",
};

function romanizeJapanese(value: string): string {
  const katakana = value.replace(/[\u3041-\u3096]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) + 0x60),
  );
  let result = "";
  for (let index = 0; index < katakana.length; index += 1) {
    const pair = katakana.slice(index, index + 2);
    const syllable = JAPANESE_SYLLABLES[pair] ?? JAPANESE_SYLLABLES[katakana[index] ?? ""];
    if (syllable) {
      result += syllable;
      index += pair in JAPANESE_SYLLABLES ? 1 : 0;
    } else if (katakana[index] === "ッ") {
      const next = katakana[index + 1] ?? "";
      const nextSyllable = JAPANESE_SYLLABLES[next] ?? "";
      result += nextSyllable[0] ?? "";
    } else if (katakana[index] === "ー") {
      result += "";
    } else {
      result += katakana[index] ?? "";
    }
  }
  return result;
}

function normalizedVariants(value: string): string[] {
  const aliases = [...value.matchAll(/\(([^)]*)\)|\[([^\]]*)\]/g)].map(
    (match) => match[1] ?? match[2] ?? "",
  );
  const candidates = [value, ...aliases];
  return [...new Set(candidates.map((candidate) => romanizeJapanese(candidate)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(feat|ft|with|con|prod|remaster(ed)?|remix|version|edit|radio|live|deluxe|bonus|track)\b.*$/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()).filter(Boolean)];
}

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
  const x = normalizedVariants(a)[0] ?? "";
  const y = normalizedVariants(b)[0] ?? "";
  if (!x || !y) return 0;
  if (x === y) return 1;
  const max = Math.max(x.length, y.length);
  return 1 - levenshtein(x, y) / max;
}

/** True when the guess is "close enough" to the expected value. */
export function isClose(guess: string, expected: string): boolean {
  const guesses = normalizedVariants(guess);
  const expectedValues = normalizedVariants(expected);
  return guesses.some((g) => expectedValues.some((e) => {
    if (!g || !e || g.length < 2) return false;
    if (g === e) return true;
    if (e.length >= 5 && g.length >= 4 && (g.includes(e) || e.includes(g))) return true;
    const parts = e.split(/\s+(?:and|x|vs)\s+/);
    if (parts.length > 1 && parts.some((p) => p.length > 2 && g.length >= 3 && similarity(g, p) >= 0.88)) return true;
    const threshold = Math.min(g.length, e.length) <= 3 ? 0.95 : 0.88;
    return similarity(g, e) >= threshold;
  }));
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

