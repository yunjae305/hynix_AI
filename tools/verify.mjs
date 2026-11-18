// 문제 검증 도구: 실제 서비스와 같은 조건(api/chat.js의 MODEL·EFFORT·MAX_TOKENS·SYSTEM·toInput, app.js의 채점)으로 모델을 직접 불러 문제를 풀려 본다.
// 서버의 호출 제한·Origin 검사는 거치지 않고 OpenAI를 바로 부른다. 호출은 OpenAI 크레딧을 쓴다.
//
// 실행: node --env-file=.env.local tools/verify.mjs --out <장부 폴더> [옵션]
//   --set base|bypass|path|guess|all  (여러 개는 쉼표로)
//     base   = 한도 안 극대 파일 조합에 문제 글을 그대로 붙여 한 번 묻는다 → 정답이 나오면 안 된다
//     bypass = tools/plan.json의 우회 질문(응시자가 바꿔 물을 만한 말) → 정답이 나오면 안 된다
//     path   = 의도한 풀이 경로를 실제로 잇는다. 앞 단계의 모델 답을 그대로 옮겨 적어 다음 단계를 묻는다 → 정답이어야 한다
//     guess  = 객관식을 SYSTEM 없이·파일 없이(상황 설명+보기만) 찍게 한다(--repeat 기본 3) → 대부분 틀려야 한다
//   --only 1-1,3-3   이 문제만    --repeat N   같은 시도를 N번    --dry   계획만 보기
//   --bypass-pick 2-2:1,3-2:1   우회 질문을 문제별로 골라서(1부터). 없으면 그 문제의 우회 질문 전부
//   --budget N       장부 기준 누적 모델 호출 상한(기본 60). 넘길 호출은 시작하지 않는다
//   --out DIR        장부(ledger.json)·기록(runs.jsonl)·결과 폴더. 같은 폴더를 넘겨야 누적 상한이 이어진다
// 판정: correct / wrong / refused(최종답 없음·확인 불가) / incomplete(출력 상한) / over(입력 한도 초과).
// 답 노출(shown): 답 글 어딘가에 정답 표기가 보임. candidates: 답 글에 나온 같은 꼴의 후보 수(4개 이상이면 후보 나열 속 포함으로 본다).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import OpenAI from 'openai';
import { MODEL, EFFORT, MAX_TOKENS, SYSTEM, MAX_INPUT_TOKENS, toInput, validate, replyText } from '../api/chat.js';

const ROOT = new URL('../', import.meta.url);
const BUNDLES = new Function(fs.readFileSync(new URL('data.js', ROOT), 'utf8') + '; return BUNDLES')();
const PLAN = JSON.parse(fs.readFileSync(new URL('tools/plan.json', ROOT), 'utf8'));
// 화면 채점(app.js)을 그대로 쓴다
const APP = fs.readFileSync(new URL('app.js', ROOT), 'utf8');
const isCorrect = new Function('console', `${APP.slice(APP.indexOf('// ───────── 채점'), APP.indexOf('// ───────── 상태'))}; return isCorrect;`)({ assert: () => {} });
const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const QUESTION_TOKEN_GUESS = 400;
const optionsOf = (q) => q.options.map((o, k) => `${'ABCD'[k]}. ${o}`).join('\n');
const withOptions = (q) => (q.type === 'mc' ? `${q.text}\n${optionsOf(q)}` : q.text);
const TAIL = { mc: '마지막 줄에 "최종답: " 뒤에 보기 기호(A~D) 하나만 적어 주세요.', short: '마지막 줄에 "최종답: " 뒤에 답만 적어 주세요.' };
const GUESS = '\n전달된 자료로 확인할 수 없는 부분은 상식으로 추측해서라도 가장 그럴듯한 답을 하나 골라 주세요.';

function parseArgs(argv) {
  const o = { dry: false, only: null, bypassPick: null, sets: ['base'], repeat: null, budget: 60, concurrency: 4, out: process.env.VERIFY_OUT || path.join(os.tmpdir(), 'ai-exam-verify') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i];
    if (a === '--dry') o.dry = true;
    else if (a === '--only') o.only = new Set(v().split(','));
    else if (a === '--set') o.sets = v().split(',');
    else if (a === '--bypass-pick') o.bypassPick = new Map(v().split(',').map((x) => x.split(':')).map(([q, k]) => [q, +k]));
    else if (a === '--repeat') o.repeat = +v();
    else if (a === '--budget') o.budget = +v();
    else if (a === '--concurrency') o.concurrency = +v();
    else if (a === '--out') o.out = v();
    else throw new Error(`모르는 옵션: ${a}`);
  }
  if (o.sets.includes('all')) o.sets = ['base', 'bypass', 'path', 'guess'];
  for (const s of o.sets) if (!['base', 'bypass', 'path', 'guess'].includes(s)) throw new Error(`--set 값이 잘못됐습니다: ${s}`);
  return o;
}

// 한도 안에 들어가는 파일 조합 중 극대인 것들
function maximalCombos(files, budget) {
  const n = files.length, fits = [];
  for (let mask = 1; mask < 1 << n; mask++) if (files.filter((_, i) => mask & (1 << i)).reduce((s, f) => s + f.tokens, 0) <= budget) fits.push(mask);
  return fits.filter((m) => !fits.some((x) => x !== m && (x & m) === m)).map((m) => files.filter((_, i) => m & (1 << i)).map((f) => f.name));
}

// 시도 하나 = 질문 하나 또는 의도 경로(단계 여러 개)
function buildPlan(o) {
  const items = [];
  BUNDLES.forEach((B, bi) => B.questions.forEach((q, qi) => {
    const id = `${bi + 1}-${qi + 1}`, p = PLAN.questions.find((x) => x.id === id);
    if (o.only && !o.only.has(id)) return;
    const one = (kind, label, files, text, extra = {}) => ({ id, bi, qi, kind, label, steps: [{ files, text }], ...extra });
    if (o.sets.includes('base')) for (const c of maximalCombos(B.files, MAX_INPUT_TOKENS - QUESTION_TOKEN_GUESS)) items.push(one('base', c.join('+'), c, `${withOptions(q)}\n\n${TAIL[q.type]}`));
    if (o.sets.includes('bypass')) p.bypass.forEach((b, k) => (o.bypassPick?.has(id) && o.bypassPick.get(id) !== k + 1) || items.push(one('bypass', `우회${k + 1}: ${b.files.join('+') || '파일 없음'}`, b.files, `${b.text}\n\n${TAIL[q.type]}`)));
    if (o.sets.includes('path')) items.push({ id, bi, qi, kind: 'path', label: `의도 경로 ${p.path.length}단계`, steps: p.path.map((s, k) => ({ files: s.files, ask: s.ask, final: k === p.path.length - 1 })) });
    // 찍기: 시도마다 보기 순서를 돌려(모델이 A로 쏠리는 것과 내용 단서를 구별) 답을 원래 번호로 되돌려 채점한다
    if (o.sets.includes('guess') && q.type === 'mc') items.push(one('guess', 'SYSTEM 없음·파일 없음(상황+보기, 보기 순서 돌림)', [], null, { noSystem: true, rotate: true }));
  }));
  return items.flatMap((p) => Array.from({ length: o.repeat ?? (p.kind === 'guess' ? 3 : 1) }, (_, r) => ({ ...p, rep: r + 1 })));
}

// app.js의 toApi와 같은 모양: 파일 블록들 다음에 질문 글 블록
function toMessages(B, files, text) {
  const blocks = [];
  for (const name of files) {
    const f = B.files.find((x) => x.name === name);
    if (!f) throw new Error(`없는 파일 ${name}`);
    if (f.kind === 'pdf' || f.kind === 'image') {
      const data = fs.readFileSync(new URL(f.url, ROOT)).toString('base64');
      const [type, media_type] = f.kind === 'pdf' ? ['document', 'application/pdf'] : ['image', 'image/png'];
      blocks.push({ type: 'text', text: `[첨부파일: ${f.name}]` }, { type, source: { type: 'base64', media_type, data } });
    } else blocks.push({ type: 'text', text: `<file name="${f.name}">\n${f.body}\n</file>` });
  }
  const { error, messages } = validate({ messages: [{ role: 'user', content: [...blocks, { type: 'text', text }] }] });
  if (error) throw new Error(`서버 검사에서 거부됨 — ${error}`);
  return messages;
}

function extract(q, reply) {
  const all = [...reply.matchAll(/최종\s*답\s*[:：]\s*(.+)/g)];
  const raw = all.length ? all[all.length - 1][1].trim() : null;
  if (raw == null) return { raw: null, answer: null };
  if (q.type !== 'mc') return { raw, answer: raw.replace(/[.。]$/, '') };
  const letter = norm(raw).match(/^[("'[]?([a-d])(?![a-z])/);
  if (letter) return { raw, answer: 'abcd'.indexOf(letter[1]) };
  const hits = q.options.map((opt, k) => (norm(raw).includes(norm(opt)) ? k : -1)).filter((k) => k >= 0);
  return { raw, answer: hits.length === 1 ? hits[0] : null };
}
const refused = (raw) => raw == null || /확인\s*불가|알\s*수\s*없|판단할\s*수\s*없|특정할\s*수\s*없/.test(raw);
const shown = (q, reply) => q.type !== 'mc' && q.answers.some((x) => norm(x).length >= 3 && norm(reply).includes(norm(x)));
const candidates = (pattern, reply) => (pattern ? new Set(reply.match(new RegExp(pattern, 'g')) ?? []).size : 0);

function readLedger(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { calls: 0, countCalls: 0, input: 0, output: 0, reasoning: 0 }; }
}
const writeLedger = (file, l) => fs.writeFileSync(file, JSON.stringify(l, null, 1));

// 모델 호출 한 번. 한도 초과면 부르지 않는다.
async function ask(client, ctx, B, files, text, noSystem) {
  const input = toInput(toMessages(B, files, text));
  const { input_tokens: used } = await client.responses.inputTokens.count({ model: MODEL, input });
  ctx.ledger.countCalls++;
  if (used > MAX_INPUT_TOKENS) return { used, status: 'over', reply: '' };
  if (ctx.ledger.calls >= ctx.budget) return { used, status: 'skipped-budget', reply: '' };
  ctx.ledger.calls++;
  writeLedger(ctx.ledgerFile, ctx.ledger);
  const res = await client.responses.create({ model: MODEL, max_output_tokens: MAX_TOKENS, reasoning: { effort: EFFORT }, ...(noSystem ? {} : { instructions: SYSTEM }), input, store: false });
  const u = res.usage ?? {}, reasoning = u.output_tokens_details?.reasoning_tokens ?? 0;
  Object.assign(ctx.ledger, { input: ctx.ledger.input + (u.input_tokens ?? 0), output: ctx.ledger.output + (u.output_tokens ?? 0), reasoning: ctx.ledger.reasoning + reasoning });
  writeLedger(ctx.ledgerFile, ctx.ledger);
  const reply = ['completed', 'incomplete'].includes(res.status) ? replyText(res) : '';
  return { used, status: res.status, incomplete: res.incomplete_details?.reason ?? null, usage: { input: u.input_tokens, output: u.output_tokens, reasoning }, reply };
}

async function runItem(client, ctx, item) {
  const B = BUNDLES[item.bi], q = B.questions[item.qi], pattern = PLAN.questions.find((x) => x.id === item.id).pattern;
  const steps = [];
  let prev = '';
  const perm = item.rotate ? [0, 1, 2, 3].map((k) => (k + item.rep) % 4) : null; // 보이는 k번 보기 = 원래 perm[k]번
  const qShown = perm ? { ...q, options: perm.map((k) => q.options[k]), answer: perm.indexOf(q.answer) } : q;
  if (perm) item.steps[0].text = `[상황] ${B.scenario}\n\n${withOptions(qShown)}${GUESS}\n\n${TAIL.mc}`;
  for (const s of item.steps) {
    const text = s.ask ? s.ask.replace('{{prev}}', prev).replace('{{question}}', withOptions(q)) + (s.final ? `\n\n${TAIL[q.type]}` : '') : s.text;
    const r = await ask(client, ctx, B, s.files, text, item.noSystem);
    steps.push({ files: s.files, asked: text, ...r });
    if (r.status !== 'completed') break;
    prev = r.reply.replace(/\n\n\(답변이 길어[\s\S]*$/, '').trim();
  }
  const last = steps.at(-1);
  const done = steps.length === item.steps.length && ['completed', 'incomplete'].includes(last.status);
  const { raw, answer } = done ? extract(qShown, last.reply) : { raw: null, answer: null };
  const ok = answer != null && isCorrect(qShown, answer);
  const anyIncomplete = steps.some((s) => s.status === 'incomplete');
  const verdict = !done ? (last.status === 'over' ? 'over' : last.status === 'skipped-budget' ? 'skipped-budget' : 'error') : anyIncomplete ? 'incomplete' : ok ? 'correct' : refused(raw) ? 'refused' : 'wrong';
  const allReplies = steps.map((s) => s.reply).join('\n');
  return { id: item.id, kind: item.kind, label: item.label, rep: item.rep, shownAnswer: perm ? 'ABCD'[qShown.answer] : undefined, noSystem: !!item.noSystem, verdict, extracted: raw, shown: kindChecksExposure(item) && shown(q, last.reply), candidates: candidates(pattern, last.reply),
    calls: steps.filter((s) => s.usage).length, used: steps.map((s) => s.used), out: steps.map((s) => s.usage?.output ?? 0), steps, at: new Date().toISOString(), allLen: allReplies.length };
}
const kindChecksExposure = (item) => item.kind !== 'path';

async function pool(items, n, fn) {
  const out = []; let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } }));
  return out;
}

function printTable(rows) {
  const w = (s, n) => { s = String(s); const len = [...s].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0); return s + ' '.repeat(Math.max(0, n - len)); };
  console.log(w('문제', 6) + w('종류', 8) + w('시도', 56) + w('판정', 16) + w('뽑은 답', 22) + '입력/출력 토큰');
  for (const r of rows) {
    const v = r.verdict + (r.shown ? (r.candidates >= 4 ? '(후보속)' : '(답노출!)') : '');
    console.log(w(r.id, 6) + w(r.kind, 8) + w(r.label.slice(0, 52) + (r.rep > 1 ? ` #${r.rep}` : ''), 56) + w(v, 16) + w((r.extracted ?? '-').slice(0, 20), 22) + `${r.used.join('→')} / ${r.out.join('→')}`);
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const plan = buildPlan(o);
  const calls = plan.reduce((s, p) => s + p.steps.length, 0);
  if (o.dry) {
    for (const p of plan) console.log(`${p.id}\t${p.kind}\t${p.label}${p.rep > 1 ? ' #' + p.rep : ''}\t${p.steps.length}회`);
    console.log(`계획 ${plan.length}건, 모델 호출 최대 ${calls}회 (모델은 부르지 않음)`);
    return;
  }
  if (!process.env.OPENAI_API_KEY) throw new Error('키가 필요합니다: node --env-file=.env.local tools/verify.mjs');
  fs.mkdirSync(o.out, { recursive: true });
  const ledgerFile = path.join(o.out, 'ledger.json'), runsFile = path.join(o.out, 'runs2.jsonl');
  const ctx = { ledger: readLedger(ledgerFile), ledgerFile, budget: o.budget };
  if (ctx.ledger.calls + calls > o.budget) console.warn(`계획 최대 ${calls}회 + 누적 ${ctx.ledger.calls}회가 상한 ${o.budget}회를 넘습니다. 상한에서 멈춥니다.`);
  const client = new OpenAI({ maxRetries: 0 });
  const rows = await pool(plan, o.concurrency, async (item) => {
    let r;
    try { r = await runItem(client, ctx, item); } catch (e) { r = { id: item.id, kind: item.kind, label: item.label, rep: item.rep, verdict: 'error', error: String(e?.message ?? e), used: [], out: [], calls: 0 }; }
    fs.appendFileSync(runsFile, JSON.stringify(r) + '\n');
    console.error(`${r.id} ${r.kind} ${r.label}: ${r.verdict}`);
    return r;
  });
  printTable(rows);
  fs.writeFileSync(path.join(o.out, `verify2-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify({ model: MODEL, effort: EFFORT, maxTokens: MAX_TOKENS, limit: MAX_INPUT_TOKENS, rows }, null, 1));
  const l = ctx.ledger;
  console.log(`\n이번 실행 모델 호출 ${rows.reduce((s, r) => s + (r.calls ?? 0), 0)}회 | 누적 ${l.calls}회, 토큰 세기 ${l.countCalls}회 | 누적 토큰 입력 ${l.input} · 출력 ${l.output}(추론 ${l.reasoning})`);
}

await main();
