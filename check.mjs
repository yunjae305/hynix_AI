// 실행: node check.mjs  (키 없이 돌아가는 요청 검사 확인)
import assert from 'node:assert';
import handler, { validate } from './api/chat.js';

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

// 키가 없으면 모델을 부르지 않고 500
const res = { status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
delete process.env.ANTHROPIC_API_KEY;
await handler({ method: 'POST', body: { messages: [u('a')] } }, res);
assert.equal(res.code, 500);
await handler({ method: 'GET' }, res);
assert.equal(res.code, 405);
console.log('api ok');

// 문제 데이터 형식 검사
import fs from 'node:fs';
const BUNDLES = new Function(fs.readFileSync(new URL('./data.js', import.meta.url), 'utf8') + '; return BUNDLES')();
assert.equal(BUNDLES.length, 5, '묶음 5개');
for (const [i, B] of BUNDLES.entries()) {
  const at = `묶음 ${i + 1}`;
  assert.ok(B.title && B.files.length, `${at}: 제목·파일`);
  assert.equal(new Set(B.files.map((f) => f.name)).size, B.files.length, `${at}: 파일명 중복`);
  for (const f of B.files) {
    assert.ok(/^[^\s@]+$/.test(f.name), `${at}: 파일명에 공백·@ 금지 (${f.name})`);
    assert.ok(f.body?.trim() || ['pdf', 'image'].includes(f.kind), `${at}: 글자 파일·엑셀은 body 필수 (${f.name})`);
    for (const p of [f.url, f.preview].filter(Boolean)) assert.ok(fs.existsSync(new URL('./' + p, import.meta.url)), `${at}: 파일 없음 ${p}`);
    assert.ok(!f.kind || f.url, `${at}: 원본 경로(url) 필수 (${f.name})`);
    assert.ok(f.tokens > 0 && f.tokens < 20_000, `${at}: 파일 하나는 2만 토큰 안에 들어가야 한다 (${f.name}: ${f.tokens})`);
  }
  assert.ok(B.files.reduce((s, f) => s + f.tokens, 0) > 20_000, `${at}: 전체 파일 합계는 2만 토큰을 넘어야 한다(한 번에 못 풀게)`);
  assert.deepEqual(B.questions.map((q) => q.type).sort(), ['mc', 'short', 'short'], `${at}: 객관식 1 + 단답형 2`);
  for (const q of B.questions) {
    assert.ok(q.text && q.why, `${at}: 문제·해설`);
    if (q.type === 'mc') assert.ok(q.options.length === 4 && q.options[q.answer] !== undefined, `${at}: 보기 4개·정답 번호`);
    else assert.ok(q.answers.length && q.answers.every((a) => String(a).trim()), `${at}: 허용 답`);
    // 문제에 언급한 파일은 그 묶음에 있어야 한다
    for (const m of q.text.match(/[\w.-]+\.(csv|md|txt|json|xlsx|pdf|png)/g) || []) assert.ok(B.files.some((f) => f.name === m), `${at}: 없는 파일 언급 ${m}`);
  }
}
console.log('data ok');
