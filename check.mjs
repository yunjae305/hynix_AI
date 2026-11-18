// 실행: node check.mjs  (키 없이 돌아가는 요청 검사 확인)
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import handler, { validate, rateLimit, toInput, replyText, MAX_INPUT_TOKENS, OPENAI_BUDGET_MS } from './api/chat.js';

const u = (content) => ({ role: 'user', content });
assert.deepEqual(validate({ messages: [u('안녕')] }).messages, [u('안녕')]);
assert.ok(validate({}).error, '빈 본문 거부');
assert.ok(validate({ messages: [{ role: 'system', content: 'x' }] }).error, '허용 안 된 role 거부');
assert.ok(validate({ messages: [{ role: 'assistant', content: 'b' }] }).error, 'assistant 메시지 거부');
assert.ok(validate({ messages: [u('x'.repeat(100_001))] }).error, '길이 상한');
// 원샷: 이전 대화를 붙여 보내면 거부
assert.ok(validate({ messages: [u('a'), { role: 'assistant', content: 'b' }, u('c')] }).error, '이전 대화 포함 거부');
assert.ok(validate({ messages: [u('a'), u('b')] }).error, '질문 2개 거부');
assert.ok(validate({ messages: [] }).error, '빈 목록 거부');
assert.deepEqual(validate({ messages: [{ ...u('a'), extra: 1 }] }).messages, [u('a')], '여분 필드 제거');

// 첨부 블록
const img = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } };
const pdf = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'AAAA', junk: 1 } };
const mixed = validate({ messages: [{ role: 'user', content: [pdf, img, { type: 'text', text: '질문' }] }] });
assert.deepEqual(mixed.messages[0].content[0], { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'AAAA' } }, '여분 필드 제거');
const withBlock = (b) => validate({ messages: [{ role: 'user', content: [b] }] }).error;
assert.ok(withBlock({ type: 'image', source: { type: 'url', url: 'http://x' } }), 'URL 이미지 거부');
assert.ok(withBlock({ type: 'image', source: { type: 'base64', media_type: 'image/svg+xml', data: 'AAAA' } }), '허용 안 된 형식 거부');
assert.ok(withBlock({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'not base64!' } }), 'base64 아님 거부');
assert.ok(withBlock({ type: 'tool_result', content: 'x' }), '다른 블록 종류 거부');
assert.ok(withBlock({ ...img, source: { ...img.source, data: 'A'.repeat(3_500_001) } }), '첨부 크기 상한');

// OpenAI 입력으로 변환
assert.deepEqual(toInput(mixed.messages)[0].content, [
  { type: 'input_file', filename: 'attachment.pdf', file_data: 'data:application/pdf;base64,AAAA' },
  { type: 'input_image', image_url: 'data:image/png;base64,AAAA', detail: 'auto' },
  { type: 'input_text', text: '질문' },
], '블록을 OpenAI 입력 파트로 변환');
assert.deepEqual(toInput([u('안녕')]), [u('안녕')], '문자열 내용은 그대로');

// 모델 응답 정리: 정상 / 잘림 / 거절
const out = (status, content, reason) => ({ status, incomplete_details: reason ? { reason } : null, output: [{ type: 'reasoning' }, { type: 'message', content }] });
const said = (text) => [{ type: 'output_text', text }];
assert.equal(replyText(out('completed', said('**답**입니다'))), '답입니다', '굵게 표시 제거');
assert.ok(replyText(out('completed', [])).includes('비어'), '빈 답 안내');
assert.ok(replyText(out('incomplete', said('앞부분'), 'max_output_tokens')).startsWith('앞부분\n\n(답변이 길어'), '잘린 답에 안내 덧붙임');
assert.ok(replyText(out('incomplete', [], 'max_output_tokens')).includes('끝까지 만들지 못했습니다'), '글자 없이 잘림');
assert.ok(replyText(out('completed', [{ type: 'refusal', refusal: 'no' }])).includes('답할 수 없습니다'), '거절');
assert.ok(replyText(out('incomplete', said('x'), 'content_filter')).includes('답할 수 없습니다'), '필터에 걸림');

// 핸들러: 메서드 → Origin → 키 → 본문 순서로 거른다. 모델은 부르지 않는다.
const call = async (req) => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler(req, res);
  return res;
};
const site = { host: 'exam.example', origin: 'https://exam.example' };
const post = (extra) => ({ method: 'POST', headers: site, body: { messages: [u('a')] }, ...extra });
delete process.env.OPENAI_API_KEY;
assert.equal((await call({ method: 'GET' })).code, 405);
assert.equal((await call(post({ headers: { host: site.host } }))).code, 403, 'Origin 없음 거부');
assert.equal((await call(post({ headers: undefined }))).code, 403, '헤더 없음 거부');
assert.equal((await call(post({ headers: { ...site, origin: 'https://evil.example' } }))).code, 403, '다른 Origin 거부');
assert.equal((await call(post({ headers: { ...site, origin: 'null' } }))).code, 403, 'Origin null 거부');
assert.equal((await call(post())).code, 500, '키가 없으면 500');
const behindProxy = { host: 'internal.local', 'x-forwarded-host': site.host };
assert.equal((await call(post({ headers: { ...behindProxy, origin: site.origin } }))).code, 500, 'x-forwarded-host 일치면 통과');
assert.equal((await call(post({ headers: { ...behindProxy, origin: 'https://evil.example' } }))).code, 403, '둘 다 불일치면 거부');
// 가짜 키: 본문 검사에서 끝나므로 API는 부르지 않는다
process.env.OPENAI_API_KEY = 'fake-key-for-check';
const broken = await call({ method: 'POST', headers: site, get body() { throw new SyntaxError('bad json'); } });
assert.deepEqual([broken.code, broken.body.error], [400, '메시지 형식이 올바르지 않습니다.'], '깨진 JSON은 400');
assert.equal((await call(post({ body: {} }))).code, 400, '빈 본문 400');
delete process.env.OPENAI_API_KEY;

// 호출 제한: 1분 10번, 1시간 120번
const T = 1_000_000_000_000;
for (let i = 0; i < 10; i++) assert.ok(rateLimit('1.1.1.1', T + i).ok, `분당 ${i + 1}번째 허용`);
const over = rateLimit('1.1.1.1', T + 10);
assert.ok(!over.ok && over.retryAfter === 60, '분당 11번째 거부');
assert.ok(rateLimit('2.2.2.2', T).ok, '다른 IP는 따로 센다');
assert.ok(rateLimit('1.1.1.1', T + 60_000).ok, '1분 뒤 다시 허용');
let t = T;
for (let i = 0; i < 120; i++, t += 6_001) assert.ok(rateLimit('3.3.3.3', t).ok, `시간당 ${i + 1}번째 허용`);
const hourOver = rateLimit('3.3.3.3', t);
assert.ok(!hourOver.ok && hourOver.retryAfter > 60, '시간당 121번째 거부');
assert.ok(rateLimit('3.3.3.3', T + 3_600_000).ok, '1시간 뒤 다시 허용');

// 화면(app.js)과 서버가 같은 값을 쓰는지. app.js는 브라우저용이라 글자로 읽는다.
const APP = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const num = (re, what) => { const m = APP.match(re); assert.ok(m, `app.js에서 ${what}를 찾지 못함`); return Number(m[1].replace(/_/g, '')); };
assert.equal(num(/const LIMIT = ([\d_]+)/, 'LIMIT'), MAX_INPUT_TOKENS, '화면 LIMIT = 서버 MAX_INPUT_TOKENS');
const label = APP.match(/원샷 · ([\d만천백 ]+) 토큰/)?.[1];
const fromKo = (s) => [...s.matchAll(/(\d+)(만|천|백)?/g)].reduce((n, [, d, u]) => n + Number(d) * ({ 만: 10_000, 천: 1_000, 백: 100 }[u] ?? 1), 0);
assert.ok(label && fromKo(label) === MAX_INPUT_TOKENS, `상태 표시줄 한도 문구(${label}) = ${MAX_INPUT_TOKENS}`);
// 시간 제한 순서: 서버의 OpenAI 호출 < Vercel 함수 제한 < 화면이 기다리는 시간 (보통은 서버가 먼저 JSON 오류로 답한다)
const maxDuration = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')).functions?.['api/chat.js']?.maxDuration;
const askTimeout = num(/const ASK_TIMEOUT_MS = ([\d_]+)/, 'ASK_TIMEOUT_MS');
assert.ok(OPENAI_BUDGET_MS < maxDuration * 1000 && maxDuration * 1000 < askTimeout, `시간 제한 순서 ${OPENAI_BUDGET_MS} < ${maxDuration}초 < ${askTimeout}`);
assert.match(APP, /signal: ctl\.signal/, '화면의 fetch에 시간 제한');
// 질문 횟수: 시험 한 번에 80회(화면에서만 센다)
assert.equal(num(/const CHAT_MAX = (\d+)/, 'CHAT_MAX'), 80, '시험 한 번에 AI 질문 80회');
assert.match(APP, /chatsLeft\(\) <= 0\) return;/, '남은 횟수가 0이면 Enter 전송도 막는다');

// 단답 채점: app.js의 채점 부분만 떼어 돌린다
const grading = APP.slice(APP.indexOf('// ───────── 채점'), APP.indexOf('// ───────── 상태'));
const isCorrect = new Function('console', `${grading}; return isCorrect;`)({ assert: (ok, msg) => assert.ok(ok, `app.js 자가 검사: ${msg}`) });
const short = (answers) => ({ type: 'short', answers });
for (const a of ['337', '337번', '337 건', '３３７개', ' 337 ']) assert.ok(isCorrect(short(['337']), a), `337 ← ${a}`);
for (const a of ['260,000원', '260000원', '260,000', '260000 원']) assert.ok(isCorrect(short(['260000']), a), `260000 ← ${a}`);
assert.ok(isCorrect(short(['5', '5건']), '5개'), '단위가 다른 숫자 답');
for (const a of ['3370', '33', '337.5', '-337', '337번 338번', '3,37', '0337', '337만', '337k', '337번째', '', '번']) assert.ok(!isCorrect(short(['337']), a), `337 ✗ ${a}`);
assert.ok(!isCorrect(short(['2']), '2만') && !isCorrect(short(['3']), '3천') && !isCorrect(short(['5']), '5k'), '배수 단위는 다른 수');
assert.ok(!isCorrect(short(['35']), '3,5') && !isCorrect(short(['12']), '1,2'), '천 단위가 아닌 쉼표');
assert.ok(!isCorrect(short(['Taeo']), 'Taeo번') && isCorrect(short(['HR-2025-03']), 'hr-2025-03'), '숫자가 아닌 답은 그대로 비교');
assert.ok(isCorrect(short(['26만원']), '26만 원') && !isCorrect(short(['260000']), '26만'), '만 단위 표기는 허용 답 목록으로만');
console.log('api ok');

// 문제 데이터 형식 검사
import fs from 'node:fs';
const BUNDLES = new Function(fs.readFileSync(new URL('./data.js', import.meta.url), 'utf8') + '; return BUNDLES')();
const normA = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
assert.equal(BUNDLES.length, 5, '상황 5개');
for (const [i, B] of BUNDLES.entries()) {
  const at = `상황 ${i + 1}`;
  assert.ok(B.title && B.scenario && B.files.length, `${at}: 제목·상황 설명·파일`);
  assert.equal(new Set(B.files.map((f) => f.name)).size, B.files.length, `${at}: 파일명 중복`);
  for (const f of B.files) {
    assert.ok(/^[^\s@]+$/.test(f.name), `${at}: 파일명에 공백·@ 금지 (${f.name})`);
    assert.ok(f.body?.trim() || ['pdf', 'image'].includes(f.kind), `${at}: 글자 파일·엑셀은 body 필수 (${f.name})`);
    for (const p of [f.url, f.preview].filter(Boolean)) assert.ok(fs.existsSync(new URL('./' + p, import.meta.url)), `${at}: 파일 없음 ${p}`);
    assert.ok(!f.kind || f.url, `${at}: 원본 경로(url) 필수 (${f.name})`);
    assert.ok(f.tokens > 0 && f.tokens < MAX_INPUT_TOKENS, `${at}: 파일 하나는 한도 안에 들어가야 한다 (${f.name}: ${f.tokens})`);
  }
  assert.ok(B.files.reduce((s, f) => s + f.tokens, 0) > MAX_INPUT_TOKENS, `${at}: 전체 파일 합계는 한도를 넘어야 한다(한 번에 못 풀게)`);
  assert.deepEqual(B.questions.map((q) => q.type).sort(), ['mc', 'short', 'short'], `${at}: 객관식 1 + 단답형 2`);
  for (const q of B.questions) {
    assert.ok(q.text && q.why, `${at}: 문제·해설`);
    if (q.type === 'mc') assert.ok(q.options.length === 4 && q.options[q.answer] !== undefined, `${at}: 보기 4개·정답 번호`);
    else assert.ok(q.answers.length && q.answers.every((a) => String(a).trim()), `${at}: 허용 답`);
    // 문제에 언급한 파일은 그 상황에 있어야 한다
    for (const m of q.text.match(/[\w.-]+\.(csv|md|txt|json|xlsx|pdf|png)/g) || []) assert.ok(B.files.some((f) => f.name === m), `${at}: 없는 파일 언급 ${m}`);
    // 문제는 각자 독립적으로 읽혀야 한다(응시자는 아무 순서로나 푼다)
    assert.ok(!/앞 문제|이전 문제|위 문제|앞에서 구한|그 현행 문서의 청크에 적힌|\d번 문제/.test(q.text), `${at}: 다른 문제를 가리키는 문제 글 (${q.text.slice(0, 30)})`);
    if (q.type === 'short') assert.ok(q.answers.some((a) => normA(q.why).includes(normA(a))), `${at}: 해설에 정답이 있어야 한다 (${q.answers[0]})`);
  }
  for (const s of [B.title, B.scenario, ...B.questions.flatMap((q) => [q.text, q.why, ...(q.options ?? [])])]) assert.ok(!s.includes('묶음'), `${at}: 화면 글에 '묶음' 금지`);
  // 숫자·원문자 뒤 조사: 읽는 소리의 받침으로 고른다(0 영·1 일·3 삼·6 육·7 칠·8 팔은 받침 있음)
  const shownText = [B.scenario, ...B.questions.flatMap((q) => [q.text, q.why, ...(q.options ?? [])]), ...B.files.filter((f) => f.body && f.tokens < 2000).map((f) => f.body)];
  const PAIRS = { 은: '는', 이: '가', 을: '를', 과: '와' };
  for (const s of shownText) {
    for (const [, d, j] of s.matchAll(/([0-9①②③④])(은|는|이|가|을|를|과|와|이다|다)(?=[\s.,)!?:]|$)/g)) {
      const digit = { '①': '1', '②': '2', '③': '3', '④': '4' }[d] ?? d, has = '013678'.includes(digit);
      const ok = j === '이다' ? has : j === '다' ? !has : PAIRS[j] ? has : !has;
      assert.ok(ok, `${at}: 조사 불일치 "${d}${j}" (${s.slice(Math.max(0, s.indexOf(d + j) - 15), s.indexOf(d + j) + 5)})`);
    }
  }
}
console.log('data ok');

// 문제 구조 검사: tools/plan.json(생성기가 만든 문제별 정보 조각·의도 경로)
const PLAN = JSON.parse(fs.readFileSync(new URL('./tools/plan.json', import.meta.url), 'utf8'));
const RULES = PLAN.rules;
assert.equal(RULES.limit, MAX_INPUT_TOKENS, 'plan.json 한도 = 서버 한도');
assert.equal(PLAN.questions.length, 15, 'plan.json 문제 15개');
let totalSteps = 0;
for (const [bi, B] of BUNDLES.entries()) {
  const tok = new Map(B.files.map((f) => [f.name, f.tokens]));
  const plans = B.questions.map((_, qi) => PLAN.questions.find((p) => p.id === `${bi + 1}-${qi + 1}`));
  for (const [qi, q] of B.questions.entries()) {
    const p = plans[qi], at = `문제 ${bi + 1}-${qi + 1}`;
    assert.ok(p, `${at}: plan.json에 없음`);
    const names = [...p.needs.flat(), ...p.path.flatMap((s) => s.files), ...p.bypass.flatMap((b) => b.files)];
    for (const n of names) assert.ok(tok.has(n), `${at}: 없는 파일 ${n}`);
    // ① 정보 조각을 모두 담는 파일 조합은 한도보다 blockMargin 이상 크다(= 한도 안의 어떤 조합으로도 한 번에 못 푼다)
    const files = B.files.map((f) => f.name);
    for (let mask = 1; mask < 1 << files.length; mask++) {
      const set = files.filter((_, k) => mask & (1 << k));
      if (!p.needs.every((alt) => alt.some((n) => set.includes(n)))) continue;
      const sum = set.reduce((s, n) => s + tok.get(n), 0);
      assert.ok(sum >= RULES.limit + RULES.blockMargin, `${at}: 정보를 다 담는 조합이 한도 여유 안에 들어간다 (${set.join('+')} = ${sum})`);
    }
    // ② 의도 경로: 단계 수, 각 단계의 실제 크기 여유, 옮겨 적는 양, 경로가 정보 조각을 모두 지나감
    assert.ok(p.path.length >= RULES.minSteps && p.path.length <= RULES.maxSteps, `${at}: 단계 수 ${p.path.length}`);
    totalSteps += p.path.length;
    p.path.forEach((s, k) => {
      assert.ok(s.tokens > 0 && s.tokens <= RULES.limit - RULES.stepMargin, `${at}: ${k + 1}단계 ${s.tokens}토큰 > ${RULES.limit - RULES.stepMargin}`);
      if (k > 0) assert.ok(s.ask.includes('{{prev}}'), `${at}: ${k + 1}단계는 앞 단계 결과를 옮겨 적는다`);
      if (k < p.path.length - 1) assert.ok(s.carry?.length > 0 && s.carry.length <= RULES.maxCarry, `${at}: ${k + 1}단계 옮겨 적는 값 1~${RULES.maxCarry}개`);
    });
    assert.ok(p.path.at(-1).ask.includes('{{question}}'), `${at}: 마지막 단계는 문제 글로 묻는다`);
    const walked = p.path.flatMap((s) => s.files);
    assert.ok(p.needs.every((alt) => alt.some((n) => walked.includes(n))), `${at}: 의도 경로가 정보 조각을 모두 지나가야 한다`);
    assert.ok(p.bypass.length >= 1, `${at}: 우회 질문 1개 이상`);
  }
  // ③ 누설: 단답의 정답이 상황 설명·다른 문제 글·보기·작은 파일(2천 토큰 미만)·경로 질문·다른 문제의 중간 결과에 나오면 안 된다
  const small = B.files.filter((f) => f.body && f.tokens < 2000).map((f) => f.body);
  for (const [qi, q] of B.questions.entries()) {
    const keys = q.type === 'short' ? q.answers.map(normA).filter((a) => a.length >= 3) : [normA(q.options[q.answer])];
    const others = B.questions.filter((_, j) => j !== qi);
    const shown = [B.scenario, ...others.flatMap((o) => [o.text, ...(o.options ?? [])]), ...PLAN.questions.filter((p) => p.id.startsWith(`${bi + 1}-`)).flatMap((p) => [...p.path.map((s) => s.ask), ...p.bypass.map((b) => b.text)])];
    if (q.type === 'short') shown.push(q.text, ...small);
    const carries = plans.filter((_, j) => j !== qi).flatMap((p) => p.path.flatMap((s) => s.carry ?? []));
    for (const k of keys) {
      for (const s of shown) assert.ok(!normA(s).includes(k), `문제 ${bi + 1}-${qi + 1}: 정답(${k})이 다른 글에 나온다: ${s.slice(0, 40)}`);
      for (const c of carries) assert.ok(normA(c) !== k, `문제 ${bi + 1}-${qi + 1}: 정답(${k})이 다른 문제의 중간 결과에 나온다`);
    }
  }
}
assert.ok(totalSteps <= RULES.maxTotalSteps, `의도 경로 질문 수 합계 ${totalSteps} > ${RULES.maxTotalSteps}`);
console.log(`plan ok (의도 경로 질문 ${totalSteps}회)`);
