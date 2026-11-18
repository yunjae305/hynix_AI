// 문제 데이터 생성기. data.js, files/(cs_tickets.xlsx, ai_usage_policy.pdf·preview.png, audit_flags.png), tools/plan.json 을 다시 만든다.
//
// 실행(키와 Playwright가 필요하다):
//   PLAYWRIGHT_CORE_DIR=<playwright-core 설치 폴더> PW_LIBS=<크로미움 공유 라이브러리 폴더> node --env-file=.env.local tools/gen-data.mjs
//   그다음 node check.mjs 로 형식·구조 검사.
//
// 설계 원칙(15문제 모두):
// - 한 번의 질문(1만 3천 토큰)으로는 풀리지 않는다. 답에 필요한 정보 조각을 서로 다른 큰 파일에 나눠 두고, 그 파일들을 함께 보내면 한도를 넘게 한다.
//   응시자는 질문을 나누고 중간 결과(ID 목록 등)를 다음 질문에 옮겨 적어야 한다(AI는 이전 대화를 기억하지 못한다).
// - 객관식은 2×2: 보기 4개를 (파일 A로 확인하는 조건) × (파일 B로 확인하는 조건)으로 만들어 어느 파일 하나로도 후보가 2개 남게 한다.
// - 단답은 한도 안의 어떤 파일 조합으로도 답 후보가 4개 이상 남게 미끼를 넣는다. 답은 ID·이름·날짜·금액·코드처럼 찍을 수 없는 값.
// - 정답·해설의 숫자와 ID는 데이터에서 다시 계산하고, 설계와 어긋나면 throw로 멈춘다(tools/gen/*.mjs의 need).
// - 상황마다 난수 시드가 따로라 한 상황을 고쳐도 다른 상황의 ID는 바뀌지 않는다.
//
// tools/plan.json(화면에는 보내지 않음): 문제별 needs(정보 조각마다 그 정보가 있는 파일 목록), path(의도한 풀이 단계: 파일, 질문 틀, 옮겨 적을 값, 잰 토큰),
// bypass(응시자가 할 만한 우회 질문). check.mjs가 구조를, tools/verify.mjs가 모델 풀이를 검사할 때 읽는다.
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import OpenAI from 'openai';
import { MODEL, toInput } from '../api/chat.js';
import * as s1 from './gen/s1-refund.mjs';
import * as s2 from './gen/s2-prompt.mjs';
import * as s3 from './gen/s3-rag.mjs';
import * as s4 from './gen/s4-meeting.mjs';
import * as s5 from './gen/s5-audit.mjs';
import { render, policyHtml, tableHtml } from './render-assets.mjs';

const ROOT = new URL('../', import.meta.url);
const at = (p) => new URL(p, ROOT).pathname;
export const PLAN_RULES = { limit: 13000, blockMargin: 800, stepMargin: 1500, maxTotalSteps: 45, minSteps: 2, maxSteps: 3, maxCarry: 20 };

const r1 = s1.build(), r2 = s2.build(), r3 = s3.build(), r4 = s4.build(), r5 = s5.build();
const RESULTS = [r1, r2, r3, r4, r5];
const BUNDLES = RESULTS.map((r) => r.bundle);

// 엑셀 원본을 data.js의 표 내용과 같은 값으로 만든다
const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('tickets');
r1.sheet.split('\n').forEach((l) => ws.addRow(l.split(',')));
ws.getRow(1).font = { bold: true }; ws.columns.forEach((c, i) => (c.width = i === 3 ? 60 : 16));
await wb.xlsx.writeFile(at('files/cs_tickets.xlsx'));

// 상황 5의 정책 PDF·미리보기, 감사 봇 캡처
await render([
  { html: policyHtml(r5.assets.policy), pdf: at('files/ai_usage_policy.pdf'), png: at('files/ai_usage_policy.preview.png'), selector: '.doc' },
  { html: tableHtml(r5.assets.flags), png: at('files/audit_flags.png'), selector: '.wrap' },
]);
fs.rmSync(at('files/customer_table.png'), { force: true });

// 토큰 크기: app.js의 toApi와 같은 모양으로 만들어 서버(api/chat.js)와 같은 방법으로 잰다
if (!process.env.OPENAI_API_KEY) throw new Error('토큰 크기를 재려면 키가 필요합니다: node --env-file=.env.local tools/gen-data.mjs');
const client = new OpenAI();
const blocksOf = (f) => {
  if (!f.kind || f.kind === 'sheet') return [{ type: 'text', text: `<file name="${f.name}">\n${f.body}\n</file>` }];
  const data = fs.readFileSync(at(f.url)).toString('base64');
  const block = f.kind === 'pdf' ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } } : { type: 'image', source: { type: 'base64', media_type: 'image/png', data } };
  return [{ type: 'text', text: `[첨부파일: ${f.name}]` }, block];
};
const count = async (content) => (await client.responses.inputTokens.count({ model: MODEL, input: toInput([{ role: 'user', content }]) })).input_tokens;
for (const B of BUNDLES) await Promise.all(B.files.map(async (f) => { f.tokens = await count(blocksOf(f)); }));

// 의도 경로의 각 단계: 앞 단계의 기대 결과를 옮겨 적은 질문을 실제 모양으로 만들어 잰다
export const questionWithOptions = (q) => (q.type === 'mc' ? `${q.text}\n${q.options.map((o, k) => `${'ABCD'[k]}. ${o}`).join('\n')}` : q.text);
const plan = { rules: PLAN_RULES, questions: [] };
for (const [bi, r] of RESULTS.entries()) {
  for (const [qi, p] of r.plan.entries()) {
    const B = BUNDLES[bi], q = B.questions[qi];
    let prev = '';
    for (const step of p.path) {
      const text = step.ask.replace('{{prev}}', prev).replace('{{question}}', questionWithOptions(q));
      step.tokens = await count([...step.files.flatMap((n) => blocksOf(B.files.find((f) => f.name === n))), { type: 'text', text }]);
      prev = (step.carry ?? []).join(', ');
    }
    plan.questions.push({ id: p.id, needs: p.needs, path: p.path, bypass: p.bypass, pattern: p.pattern });
  }
}

const head = `// 문제 데이터. 현업 상황 5개 × (객관식 1 + 단답형 2). scenario는 문제 위에 보여주는 상황 설명.
// 이 파일은 tools/gen-data.mjs 가 만든다. 직접 고치지 말고 생성기(tools/gen/*.mjs)를 고친 뒤 다시 만들고 \`node check.mjs\`로 검사한다.
// 첨부파일 종류(kind): 없음=글자 파일(body), 'sheet'=엑셀(body는 AI·미리보기용 표 내용),
//   'pdf'·'image'=원본을 그대로 AI에 전달(pdf는 preview 이미지로 화면 표시). 원본은 files/ 폴더.
// tokens = 그 파일을 AI에 첨부할 때 드는 토큰 수(생성기가 API로 잰 값).
// 단답형 answers는 허용 표기 목록(공백·대소문자는 채점 때 무시). 문제별 의도한 풀이 경로는 tools/plan.json(배포하지 않음)에 있다.
`;
fs.writeFileSync(at('data.js'), head + 'const BUNDLES = ' + JSON.stringify(BUNDLES, null, 1) + ';\n');
fs.writeFileSync(at('tools/plan.json'), JSON.stringify(plan, null, 1) + '\n');
for (const B of BUNDLES) console.log(B.title, '|', B.files.map((f) => `${f.name} ${f.tokens}`).join(', '));
for (const p of plan.questions) console.log(p.id, p.path.map((s) => s.tokens).join(' → '));
console.log('의도 경로 질문 수 합계:', plan.questions.reduce((s, p) => s + p.path.length, 0));
