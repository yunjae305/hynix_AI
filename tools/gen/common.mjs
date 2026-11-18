// 생성기 공용 도구: 상황별 난수, CSV, 구성 검사(throw), 허용 답 변형.
export function makeRng(seed0) {
  let seed = seed0;
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = (a) => a[int(0, a.length - 1)];
  const shuffle = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = int(0, i); [r[i], r[j]] = [r[j], r[i]]; } return r; };
  return { rnd, int, pick, shuffle };
}

export const csv = (head, rows) => [head, ...rows].map((r) => r.join(',')).join('\n');
export const pad2 = (n) => String(n).padStart(2, '0');
export const ymd = (m, d) => `2026-${pad2(m)}-${pad2(d)}`;
export const won = (n) => n.toLocaleString('en-US');

// 구성 검사: 조건이 틀리면 생성을 멈춘다
export function need(cond, msg) {
  if (!cond) throw new Error(`구성 검사 실패: ${msg}`);
}

// app.js 채점과 같은 정규화
export const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const dedupe = (list) => { const seen = new Set(); return list.filter((x) => { const k = norm(x); if (seen.has(k)) return false; seen.add(k); return true; }); };

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const dateKo = (m, d) => `${m}월 ${d}일`;
export const dateEn = (m, d) => `${MONTHS[m]} ${d}`;

// 날짜 답의 허용 표기
export function dateAnswers(m, d) {
  const M = pad2(m), D = pad2(d), en = MONTHS[m], ab = en.slice(0, 3);
  const th = d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th';
  return dedupe([dateKo(m, d), `${m}/${d}`, `${M}/${D}`, `${M}-${D}`, `${m}-${d}`, `${m}.${d}`, `${M}.${D}`, `${m}.${d}.`, `2026-${M}-${D}`, `2026.${M}.${D}`, `2026/${M}/${D}`, `2026.${m}.${d}`,
    `2026년 ${m}월 ${d}일`, `${en} ${d}`, `${ab} ${d}`, `${ab}. ${d}`, `${d} ${en}`, `${en} ${d}, 2026`, `${en} ${d}${th}`, `${d}${th} ${en}`]);
}

// 금액 답의 허용 표기(화면 채점이 쉼표·단위를 무시하더라도 목록만으로 충분하게)
export function wonAnswers(n) {
  const c = won(n), list = [String(n), c, `${n}원`, `${c}원`, `₩${c}`, `₩${n}`, `KRW ${c}`, `${c} KRW`];
  if (n % 10000 === 0) list.push(`${n / 10000}만원`, `${n / 10000}만 원`);
  else if (n % 1000 === 0) { const man = Math.floor(n / 10000), rest = (n % 10000) / 1000; list.push(`${man}만 ${rest}천원`, `${man}만${rest}천원`, `${man}만 ${rest}천 원`); }
  return dedupe(list);
}

// ID 답의 허용 표기: 하이픈 대신 공백·밑줄·없음
export function idAnswers(id) {
  return dedupe([id, id.replace(/-/g, ''), id.replace(/-/g, '_'), id.replace(/-/g, ' '), id.toLowerCase()]);
}

export const numAnswers = (n, units = []) => dedupe([String(n), ...units.map((u) => `${n}${u}`), ...units.map((u) => `${n} ${u}`)]);

export const nameAnswers = (name, extra = []) => dedupe([name, ...extra]);

// 같은 상황의 문제끼리: 한 문제의 정답(값)이 다른 문제의 의도 경로 중간 결과(carry)에 나오면 안 된다
export function assertNoCrossLeak(title, plans, answersOf) {
  plans.forEach((p, i) => {
    const ans = answersOf(i).map(norm).filter((a) => a.length >= 2);
    plans.forEach((o, j) => {
      if (i === j) return;
      for (const step of o.path) for (const c of step.carry ?? []) need(!ans.includes(norm(c)), `${title}: ${p.id}의 정답이 ${o.id}의 중간 결과에 나온다 (${c})`);
    });
  });
}

// 조사 고르기: josa('T-2151', '은/는') → 'T-2151은'. 숫자는 읽는 소리의 받침으로(0 영·1 일·3 삼·6 육·7 칠·8 팔은 받침, 2·4·5·9는 없음),
// '으로/로'는 ㄹ 받침(1·7·8)이면 '로'. ①~④는 숫자와 같다. 영문으로 끝나는 말에는 붙이지 않는다(문장을 바꿔 피한다).
const DIGIT_BATCHIM = { 0: true, 1: true, 2: false, 3: true, 4: false, 5: false, 6: true, 7: true, 8: true, 9: false };
const CIRCLED = { '①': '1', '②': '2', '③': '3', '④': '4' };
export function josa(word, pair) {
  const w = String(word);
  const last = CIRCLED[w.at(-1)] ?? w.at(-1);
  let has, rieul = false;
  if (/[0-9]/.test(last)) { has = DIGIT_BATCHIM[last]; rieul = '178'.includes(last); }
  else if (/[가-힣]/.test(last)) { const jong = (last.charCodeAt(0) - 0xac00) % 28; has = jong !== 0; rieul = jong === 8; }
  else throw new Error(`조사를 붙일 수 없는 끝 글자(문장을 바꿀 것): ${w} + ${pair}`);
  const [withB, without] = pair.split('/');
  if (pair === '으로/로') return w + (has && !rieul ? '으로' : '로');
  return w + (has ? withB : without);
}
