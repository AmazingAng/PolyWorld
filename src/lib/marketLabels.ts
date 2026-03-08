const STOP_WORDS = new Set(["the", "of", "and", "in", "a", "an", "to", "for", "by", "on", "at"]);
const ORG_WORDS = new Set(["party", "congress", "council", "committee", "union", "league", "association", "club", "team", "united", "city", "republic", "democratic", "communist", "national", "workers", "people", "socialist", "liberal", "conservative", "federal", "reserve", "corporation", "company", "group", "foundation", "institute", "movement", "front", "alliance", "coalition"]);

/** Abbreviate an entity/label string Polymarket-style */
export function makeAbbrev(entity: string): string {
  const paren = entity.match(/\(([^)]+)\)/);
  if (paren) return paren[1];
  if (entity.length <= 8) return entity;
  const words = entity.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 1) return entity.slice(0, 6);
  const hasOrgWord = words.some(w => ORG_WORDS.has(w.toLowerCase()));
  const looksLikePerson = !hasOrgWord && words.length <= 3 && words.every(w => /^[A-Z]/.test(w) && !STOP_WORDS.has(w.toLowerCase()));
  if (looksLikePerson) {
    if (words.length === 2) return words[0][0] + ". " + words[1];
    return words.slice(0, -1).map(w => w.length <= 2 ? w : w[0] + ".").join("") + " " + words[words.length - 1];
  }
  const sig = words.filter(w => !STOP_WORDS.has(w.toLowerCase()));
  if (sig.length >= 2) {
    const initials = sig.map(w => w[0].toUpperCase()).join("");
    if (initials.length <= 5) return initials;
  }
  return words[0].slice(0, 5);
}

/** Find the longest common prefix of an array of strings */
export function commonPrefix(strs: string[]): string {
  if (strs.length === 0) return "";
  let prefix = strs[0];
  for (let i = 1; i < strs.length; i++) {
    while (!strs[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return "";
    }
  }
  return prefix;
}

/** Find the longest common suffix of an array of strings */
export function commonSuffix(strs: string[]): string {
  const rev = strs.map(s => [...s].reverse().join(""));
  const p = commonPrefix(rev);
  return [...p].reverse().join("");
}

/**
 * For an array of multi-binary questions, extract a short label for each.
 * 1. Extract entity from each question.
 * 2. If all entities are the same -> extract the differing part instead.
 * 3. Abbreviate the result.
 */
export function extractLabels(questions: string[]): { label: string; full: string }[] {
  if (questions.length === 0) return [];

  const entities = questions.map(q => {
    const m = q.match(/^Will\s+(?:the\s+)?(.+?)\s+(?:win|be |become |get |have |receive |reach |finish |place |make |qualify|decrease|increase|remain|stay|announce|sign|join|leave|pass|drop|exceed|hit|go |land |crash|end |start|launch|release|achieve|clinch|secure|earn|take )/i);
    if (m) return m[1].trim();
    const m2 = q.match(/^Will there be\s+(.+?)(?:\?|$)/i);
    if (m2) return m2[1].trim();
    return q.replace(/^Will\s+/i, "").replace(/\?$/, "").trim();
  });

  const allSame = entities.every(e => e === entities[0]);

  if (!allSame) {
    return entities.map(e => ({ label: makeAbbrev(e), full: e }));
  }

  const pre = commonPrefix(questions);
  const suf = commonSuffix(questions);
  const diffs = questions.map(q => {
    let d = q.slice(pre.length, q.length - suf.length).trim();
    d = d.replace(/^(?:between\s+)?/i, "").replace(/\s+seats?$/i, "");
    return d;
  });

  const labels = diffs.map(d => {
    const range = d.match(/^(\d+)\s+and\s+(\d+)$/);
    if (range) return `${range[1]}-${range[2]}`;
    const lt = d.match(/^less than\s+(\d+)$/i);
    if (lt) return `<${lt[1]}`;
    const gt = d.match(/^(?:more than|over|above)\s+(\d+)$/i);
    if (gt) return `>${gt[1]}`;
    const gte = d.match(/^(\d+)\s+or\s+more$/i);
    if (gte) return `${gte[1]}+`;
    const lte = d.match(/^(\d+)\s+or\s+(?:less|fewer)$/i);
    if (lte) return `\u2264${lte[1]}`;
    const noChange = d.match(/^no\s+/i);
    if (noChange) return d.slice(0, 10);
    if (d.length <= 10) return d;
    return makeAbbrev(d);
  });

  return labels.map((label, i) => ({ label, full: diffs[i] || questions[i] }));
}
