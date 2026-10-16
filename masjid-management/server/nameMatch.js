// Finding a member by name for the AI assistant (/api/ai/* search). Member
// names are written in Malayalam ("സിനു ടി കെ"), but people type them in
// English letters ("Sinu TK") - a plain substring test never matches across
// scripts, and the assistant answered "no such member". So:
//   - Malayalam names are turned into English letters (an approximate,
//     Manglish-style spelling: "സിനു ടി കെ" -> "sinu ti ke")
//   - both sides are simplified the way people spell loosely (th/t, aa/a,
//     doubled letters, ng/n before k...), then compared word by word, allowing
//     a letter or two off in longer words
//   - initials match words: "TK" matches "ടി കെ" (ti ke)
//   - a member id matches too: "MR#001", "MR1", "001"
// Malayalam typed as Malayalam still matches directly.

const VOWELS = { 'അ': 'a', 'ആ': 'aa', 'ഇ': 'i', 'ഈ': 'ii', 'ഉ': 'u', 'ഊ': 'uu', 'ഋ': 'ru', 'എ': 'e', 'ഏ': 'ee', 'ഐ': 'ai', 'ഒ': 'o', 'ഓ': 'oo', 'ഔ': 'au' };
const SIGNS = { 'ാ': 'aa', 'ി': 'i', 'ീ': 'ii', 'ു': 'u', 'ൂ': 'uu', 'ൃ': 'ru', 'െ': 'e', 'േ': 'ee', 'ൈ': 'ai', 'ൊ': 'o', 'ോ': 'oo', 'ൌ': 'au', 'ൗ': 'au' };
const CONSONANTS = {
  'ക': 'k', 'ഖ': 'kh', 'ഗ': 'g', 'ഘ': 'gh', 'ങ': 'ng', 'ച': 'ch', 'ഛ': 'chh', 'ജ': 'j', 'ഝ': 'jh', 'ഞ': 'nj',
  'ട': 't', 'ഠ': 'th', 'ഡ': 'd', 'ഢ': 'dh', 'ണ': 'n', 'ത': 'th', 'ഥ': 'th', 'ദ': 'd', 'ധ': 'dh', 'ന': 'n',
  'പ': 'p', 'ഫ': 'f', 'ബ': 'b', 'ഭ': 'bh', 'മ': 'm', 'യ': 'y', 'ര': 'r', 'റ': 'r', 'ല': 'l', 'ള': 'l',
  'ഴ': 'zh', 'വ': 'v', 'ശ': 'sh', 'ഷ': 'sh', 'സ': 's', 'ഹ': 'h', 'ഩ': 'n', 'ഺ': 't',
};
const CHILLU = { 'ൺ': 'n', 'ൻ': 'n', 'ർ': 'r', 'ൽ': 'l', 'ൾ': 'l', 'ൿ': 'k' };
const VIRAMA = '്';
const MALAYALAM = /[ഀ-ൿ]/;

// "സിനു ടി കെ" -> "sinu ti ke"
export function toLatin(text) {
  // റ്റ is said "tt" and ന്റ "nt" ("മാസ്റ്റർ" = master, "എന്റെ" = ente).
  const chars = [
    ...String(text)
      .normalize('NFC')
      .replace(/[\u200c\u200d]/g, '')
      .replace(/റ്റ/g, 'ട്ട')
      .replace(/ന്റ/g, 'ന്ട'),
  ];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (VOWELS[c]) out += VOWELS[c];
    else if (CHILLU[c]) out += CHILLU[c];
    else if (c === 'ം') out += 'm';
    else if (c === 'ഃ') out += 'h';
    else if (CONSONANTS[c]) {
      out += CONSONANTS[c];
      const next = chars[i + 1];
      if (SIGNS[next]) {
        out += SIGNS[next];
        i++;
      } else if (next === VIRAMA) {
        i++; // no vowel
      } else {
        out += 'a'; // the inherent vowel
      }
    } else if (!SIGNS[c] && c !== VIRAMA) out += c;
  }
  return out;
}

// How people spell loosely in English letters: one form for each.
function simplify(word) {
  return word
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/(th|dh|kh|gh|ph|bh|jh|chh)/g, (m) => m[0])
    .replace(/ch/g, 'c')
    .replace(/sh/g, 's')
    .replace(/zh/g, 'l')
    .replace(/w/g, 'v')
    .replace(/ee|ii|ie/g, 'i')
    .replace(/oo|uu|ou/g, 'u')
    .replace(/aa/g, 'a')
    .replace(/ng(?=[kg])/g, 'n')
    .replace(/y(?=[aeiou])/g, 'y')
    .replace(/(.)\1+/g, '$1');
}

const words = (text) => (MALAYALAM.test(text) ? toLatin(text) : String(text)).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

// 0 = no match; higher = better (1 per query word matched, a little less when spelled differently).
function similar(q, n) {
  if (q === n) return 1;
  if (n.startsWith(q) && q.length >= 3) return 0.9;
  // A single letter or two is an initial: "T" in "Sinu T K" is "ti".
  if (q.length <= 2 && n.startsWith(q)) return 0.6;
  const allowed = q.length >= 7 ? 2 : q.length >= 4 ? 1 : 0;
  return allowed && distance(q, n) <= allowed ? 0.8 : 0;
}

const memberIdNumber = (s) => {
  const m = String(s).toUpperCase().replace(/\s/g, '').match(/^(?:MR#?)?0*(\d{1,4})$/);
  return m ? Number(m[1]) : null;
};

// How well `query` names this member: 0 = not at all.
export function nameScore(query, name, uniqueId = '') {
  const q = String(query ?? '').trim();
  if (!q) return 1;
  const qId = memberIdNumber(q);
  if (qId !== null && qId === memberIdNumber(uniqueId)) return 10;
  // Malayalam typed as Malayalam: the plain comparison, without spaces.
  const flat = (s) => String(s).normalize('NFC').replace(/[\s‌‍]/g, '');
  if (MALAYALAM.test(q) && flat(name).includes(flat(q))) return 5;

  const nameWords = words(name).map(simplify).filter(Boolean);
  const queryWords = words(q).map(simplify).filter(Boolean);
  if (!queryWords.length || !nameWords.length) return 0;
  let score = 0;
  for (const qw of queryWords) {
    let best = Math.max(...nameWords.map((nw) => similar(qw, nw)));
    // Initials: "tk" = consecutive words starting with t and k ("ti ke").
    if (!best && qw.length >= 2 && qw.length <= 4 && /^[a-z]+$/.test(qw)) {
      const firsts = nameWords.map((w) => w[0]).join('');
      if (firsts.includes(qw)) best = 0.7;
    }
    if (!best) return 0; // every word typed must be in the name
    score += best;
  }
  return score;
}

// The members a search means, best first (none: an empty list).
export function findMembers(query, members, { nameOf = (m) => m.name, idOf = (m) => m.unique_id } = {}) {
  if (!String(query ?? '').trim()) return members;
  const scored = members.map((m) => ({ m, score: nameScore(query, nameOf(m), idOf(m)) })).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score);
  const top = scored.length ? scored[0].score : 0;
  // Only the best: "sinu" finds Sinu, not also Sifu (one letter off).
  return scored.filter((x) => x.score >= top - 0.1).map((x) => x.m);
}
