// 상황 5: 외부 AI 사용 로그 감사 (PDF 정책 + 캡처 이미지)
// 정보 분리: 프롬프트 원문은 ai_requests.csv에만, 부서·직급·이름은 employees.csv에만, 감사 봇 표시 행은 audit_flags.png에만 있다.
// 제5조는 인사 부서에만 적용되므로 같은 프롬프트라도 보낸 사람의 부서를 알아야 위반인지 정할 수 있다.
import { makeRng, csv, need, ymd, idAnswers, nameAnswers, assertNoCrossLeak, josa } from './common.mjs';

const SUR = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송'];
const GIV = ['민준', '서연', '도윤', '지우', '하준', '서윤', '시우', '하은', '주원', '지호', '예준', '수아', '유준', '지민', '건우', '채원', '현우', '다은', '준서', '소율', '태윤', '나연'];
const DEPTS = ['개발', '개발', '개발', '마케팅', '마케팅', 'CS', 'CS', 'CS', '재무', '영업', '영업', '디자인'];
const TITLES = ['사원', '사원', '대리', '대리', '과장', '차장', '부장'];
// 위반 아님
const OK = ['지난주에 배포한 보도자료를 세 줄로 요약해줘', '공개 채용 공고 문구를 더 자연스럽게 고쳐줘', '엑셀에서 두 시트를 비교하는 함수를 알려줘', '회의 아이스브레이킹 질문을 다섯 개 만들어줘', '공개된 제품 설명서 문장을 영어로 번역해줘',
  '파이썬에서 리스트를 정렬하는 방법을 알려줘', '사내 동호회 공지 문구를 다듬어줘', '이미 발표된 2분기 실적 보도자료를 표로 정리해줘'];
const OK_MASKED = '상담 내역을 요약해줘: 고객 홍*동(010-****-5678)이 배송 지연을 문의함';
const OK_VAR_PW = '설정 파일 오류를 봐줘: DB_PASSWORD=${VAULT_DB_PASSWORD} 로 되어 있는데 접속이 안 됨';
// 인사 부서가 보내면 제5조 위반, 다른 부서는 위반 아님(마스킹됨)
const HR_MASKED = ['지원자 김**의 면접 평가 메모를 세 줄로 요약해줘', '직원 이**의 연간 성과 평가 코멘트를 부드럽게 다듬어줘', '지원자 박**의 실무 면접 점수표를 표로 정리해줘'];
// 제1조 위반(마스킹 안 한 개인정보)
const BAD1 = ['상담 내역을 분류해줘: 고객 김민서(010-2345-6789)가 환불을 요청함', '지원자 박서준(seojun.park@example.com)의 이력서를 요약해줘', '고객 이메일 목록을 정리해줘: jiwoo.kim@example.com / haeun.lee@example.com'];
// 제2조 위반(미공개 재무 정보·비밀번호)
const BAD2 = ['설정 파일 오류를 봐줘: DB_PASSWORD=Qz7mLp2xR9 로 되어 있는데 접속이 안 됨', '아직 발표 전인 3분기 영업이익 412억 원이 들어간 문장을 다듬어줘', '미공개 인수 검토 자료에서 매수가 1200억 원의 근거를 요약해줘', 'API 키 sk-live-8f2K9xQ7 를 넣은 호출 코드가 왜 안 되는지 봐줘'];

export const POLICY_ARTICLES = [
  ['제1조 (개인정보)', '개인정보(이름, 전화번호, 이메일, 주민등록번호)는 마스킹한 뒤에만 외부 AI에 입력한다.'],
  ['제2조 (기밀 정보)', '미공개 재무 정보, 인증 키·비밀번호는 외부 AI에 입력하지 않는다.'],
  ['제3조 (공개 자료)', '이미 공개된 자료(보도자료, 공개 공고 등)는 그대로 입력해도 된다.'],
  ['제4조 (결과물 검토)', 'AI가 만든 결과물은 담당자가 검토한 뒤에만 외부로 발송한다.'],
  ['제5조 (인사 정보)', '인사 부서 직원은 지원자·직원의 면접·평가 자료를 외부 AI에 입력하지 않는다. 이름 등을 마스킹한 경우에도 같다.'],
];

export function build({ nEmp = 380, nReq = 235 } = {}) {
  const R = makeRng(20261115);
  const special = R.shuffle([...Array(nEmp).keys()]);
  const legalI = special.slice(0, 4), hrI = special.slice(4, 9), q2I = special.slice(9, 15), decoyI = special.slice(15, 17), mcOtherI = special.slice(17, 19);
  const emps = [...Array(nEmp).keys()].map((i) => ({ id: `E-${3001 + i}`, name: R.pick(SUR) + R.pick(GIV), dept: legalI.includes(i) ? '법무' : hrI.includes(i) ? '인사' : R.pick(DEPTS), title: R.pick(TITLES), office: R.pick(['본사 3층', '본사 5층', '본사 7층', '판교 2층', '부산 지사']), joined: `${R.int(2015, 2025)}-${String(R.int(1, 12)).padStart(2, '0')}` }));
  const E = (i) => emps[i];
  // 단답 1: 6월 제2조 위반자 6명 중 차장은 1명. 미끼: 6월 제1조 위반 차장, 5월 제2조 위반 차장
  const q2Titles = ['차장', '사원', '대리', '과장', '부장', '대리'];
  q2I.forEach((i, k) => { E(i).title = q2Titles[k]; });
  decoyI.forEach((i) => { E(i).title = '차장'; });
  // 차장 이름이 겹치면 이름 답이 흔들리므로 정답 이름은 명부에서 유일하게
  while (emps.filter((e) => e.name === E(q2I[0]).name).length > 1) E(q2I[0]).name = R.pick(SUR) + R.pick(GIV);

  const reqs = [];
  const add = (emp, prompt, m, d, tag) => reqs.push({ emp: emp.id, prompt, date: ymd(m, d), tag });
  q2I.forEach((i, k) => add(E(i), BAD2[k % BAD2.length], 6, 3 + k * 4, 'q2'));
  add(E(decoyI[0]), BAD1[0], 6, 15, 'decoy'); add(E(decoyI[1]), BAD2[1], 5, 20, 'decoy');
  // 단답 2: 인사 부서 요청 8건. 가장 늦은 위반은 제5조만 걸리는 6/18 건, 그 뒤 6/21·6/24 건은 위반 아님
  const hr = hrI.map(E);
  [[hr[0], OK[1], 5, 3], [hr[1], BAD1[1], 5, 14], [hr[2], HR_MASKED[0], 5, 28], [hr[3], OK[3], 6, 9], [hr[4], OK[2], 6, 12],
    [hr[0], HR_MASKED[1], 6, 18, 'q3'], [hr[1], OK_MASKED, 6, 21], [hr[2], OK[0], 6, 24]].forEach(([e, p, m, d, t]) => add(e, p, m, d, t ?? 'hr'));
  // 객관식: 법무·위반(정답) / 법무·정상(변수 비밀번호) / 다른 부서·위반 2건. 요청 파일로는 위반 3건이 남고, 명부로는 법무 2건이 남는다.
  const legal = legalI.map(E);
  add(legal[0], BAD1[2], 5, 11, 'mcA'); add(legal[1], OK_VAR_PW, 5, 19, 'mcB'); add(E(mcOtherI[0]), BAD1[0], 5, 23, 'mcC'); add(E(mcOtherI[1]), BAD1[1], 5, 27, 'mcD');
  legal.slice(2).forEach((e) => add(e, R.pick(OK), 6, R.int(1, 28)));
  // 나머지: 인사·법무·특수 직원 밖에서. 제2조 위반은 넣지 않고(단답 1의 집합을 고정), 인사 자료 프롬프트(마스킹)는 다른 부서가 보낸다(제5조 미끼)
  const pool = emps.filter((_, i) => !special.slice(0, 19).includes(i));
  HR_MASKED.forEach((p, k) => add(R.pick(pool), p, 6, 19 + k * 3, 'hrDecoy'));
  while (reqs.length < nReq) { const bad = R.rnd() < 0.2; add(R.pick(pool), bad ? R.pick(BAD1) : R.pick([...OK, OK, OK_MASKED, OK_VAR_PW].flat()), R.int(5, 6), R.int(1, 28)); }
  const rows = R.shuffle(reqs).map((x, i) => ({ id: `R-${5001 + i}`, ...x }));
  const emp = (id) => emps.find((e) => e.id === id);

  // 위반 판정(정답 재계산용): 조항 번호 목록
  const breaks = (r) => { const a = []; if (BAD1.includes(r.prompt)) a.push(1); if (BAD2.includes(r.prompt)) a.push(2); if (HR_MASKED.includes(r.prompt) && emp(r.emp).dept === '인사') a.push(5); return a; };
  const juneArt2 = rows.filter((r) => r.date.startsWith('2026-06') && breaks(r).includes(2));
  const juneIds = [...new Set(juneArt2.map((r) => r.emp))];
  const chajang = juneIds.filter((id) => emp(id).title === '차장');
  need(chajang.length === 1 && chajang[0] === E(q2I[0]).id, '상황 5: 6월 제2조 위반자 중 차장 1명');
  need(juneIds.length >= 4 && juneIds.length <= 20, '상황 5: 옮겨 적는 직원 ID 4~20개');
  need(emps.filter((e) => e.title === '차장').length >= 4, '상황 5: 명부만 볼 때 차장 후보 4명 이상');
  const q2Name = emp(chajang[0]).name;
  need(emps.filter((e) => e.name === q2Name).length === 1, '상황 5: 정답 이름 유일');
  const hrIds = emps.filter((e) => e.dept === '인사').map((e) => e.id);
  const hrBad = rows.filter((r) => hrIds.includes(r.emp) && breaks(r).length).sort((a, b) => a.date.localeCompare(b.date));
  const hrAll = rows.filter((r) => hrIds.includes(r.emp));
  need(new Set(hrAll.map((r) => r.date)).size === hrAll.length, '상황 5: 인사 요청 날짜가 겹치지 않음');
  const q3 = hrBad[hrBad.length - 1];
  need(q3.tag === 'q3' && breaks(q3).join() === '5', '상황 5: 가장 늦은 인사 위반은 제5조만 걸리는 건');
  need(hrAll.some((r) => r.date > q3.date), '상황 5: 그보다 늦은 인사 요청(위반 아님)이 있어야 한다');
  const looksBad = rows.filter((r) => BAD1.includes(r.prompt) || BAD2.includes(r.prompt) || HR_MASKED.includes(r.prompt));
  need(looksBad.filter((r) => r.date > q3.date).length >= 4, '상황 5: 요청 파일만 볼 때 더 늦은 위반 후보 4건 이상');
  const mc = ['mcA', 'mcB', 'mcC', 'mcD'].map((t) => rows.find((r) => r.tag === t));
  const truth = mc.map((r) => [emp(r.emp).dept === '법무', breaks(r).length > 0]);
  need(truth.filter(([l, b]) => l && b).length === 1 && truth[0][0] && truth[0][1] && truth.filter(([l]) => l).length === 2 && truth.filter(([, b]) => b).length === 3, '상황 5: 객관식 후보 구성');
  const flagRows = R.shuffle(mc);
  const answerIdx = flagRows.findIndex((r) => r.tag === 'mcA');
  need(rows.length >= nReq, '상황 5: 요청 수');

  const policyHtml = { title: '사내 생성형 AI 사용 정책', meta: '문서번호 SEC-2026-04 · 정보보안팀 · 시행일 2026-04-01', articles: POLICY_ARTICLES };
  const flags = { title: '감사 봇 탐지 결과 — 법무 부서 정책 위반 의심', head: ['행', 'req_id', 'employee_id', '탐지일', '봇 판정'], rows: flagRows.map((r, i) => [String(i + 1), r.id, r.emp, r.date, '법무 · 위반 의심']) };
  const legalOk = flagRows.map((r, i) => (emp(r.emp).dept === '법무' ? `${i + 1}번 행 ${r.id}` : null)).filter(Boolean);
  const files = [
    { name: 'ai_usage_policy.pdf', kind: 'pdf', url: 'files/ai_usage_policy.pdf', preview: 'files/ai_usage_policy.preview.png' },
    { name: 'ai_requests.csv', body: csv(['req_id', 'date', 'employee_id', 'prompt'], rows.map((r) => [r.id, r.date, r.emp, r.prompt])) },
    { name: 'employees.csv', body: csv(['employee_id', 'name', 'dept', 'title', 'office', 'joined'], emps.map((e) => [e.id, e.name, e.dept, e.title, e.office, e.joined])) },
    { name: 'audit_flags.png', kind: 'image', url: 'files/audit_flags.png' },
  ];
  const art = (r) => (breaks(r).length ? `제${breaks(r).join('·')}조 위반` : '위반 아님');
  const questions = [
    { type: 'mc', text: 'audit_flags.png는 감사 봇이 \'법무 부서 직원의 정책 위반 의심\'으로 표시한 요청 4건의 캡처다. 1~4번 행 가운데 실제로 법무 부서 직원이 보낸 정책 위반 요청은?', options: flagRows.map((_, i) => `${i + 1}번 행`), answer: answerIdx,
      why: `employees.csv와 ai_requests.csv를 함께 보내면 1만 3천 토큰을 넘는다. ① audit_flags.png와 employees.csv를 보내 4개 행의 employee_id 부서를 확인하면 법무는 ${josa(legalOk.join(', '), '이다/다')}. ② 그 행과 req_id를 옮겨 적어 ai_requests.csv와 정책 PDF로 원문을 판정한다. ${flagRows.map((r, i) => `${i + 1}번 행 ${r.id}(${emp(r.emp).dept}): ${art(r)}.`).join(' ')} 법무 직원의 위반은 ${answerIdx + 1}번 행뿐이다. 변수 이름만 적힌 비밀번호는 위반이 아니다.` },
    { type: 'short', text: '2026년 6월에 사용 정책 제2조(기밀 정보)를 위반한 요청을 보낸 직원 가운데 직급이 \'차장\'인 직원의 이름은?', answers: nameAnswers(q2Name, [`${q2Name} 차장`, `${q2Name}차장`]),
      why: `ai_requests.csv와 employees.csv를 함께 보내면 1만 3천 토큰을 넘는다. ① ai_requests.csv와 정책 PDF로 6월 요청 중 제2조 위반(실제 비밀번호·API 키, 발표 전 실적, 미공개 인수가)을 보낸 직원 ${juneIds.length}명을 뽑는다: ${juneIds.join(', ')}. ② 그 목록을 옮겨 적어 employees.csv에서 직급을 보면 차장은 ${chajang[0]} ${josa(q2Name, '이다/다')}. 6월에 제1조를 위반한 차장 ${E(decoyI[0]).id}, 5월에 제2조를 위반한 차장 ${E(decoyI[1]).id}도 있지만 조건에 맞지 않는다.` },
    { type: 'short', text: '\'인사\' 부서 직원이 보낸 요청 가운데 사용 정책(ai_usage_policy.pdf) 위반인 요청 중 날짜가 가장 늦은 요청의 req_id는? (R-0000 형식)', answers: idAnswers(q3.id),
      why: `employees.csv와 ai_requests.csv를 함께 보내면 1만 3천 토큰을 넘는다. ① employees.csv에서 인사 부서 직원 ${hrIds.length}명을 뽑는다: ${hrIds.join(', ')}. ② 그 목록을 옮겨 적어 ai_requests.csv와 정책 PDF로 이들의 요청 ${hrAll.length}건을 판정한다. ${[...hrAll].sort((a, b) => a.date.localeCompare(b.date)).map((r) => `${r.date} ${r.id}: ${art(r)}.`).join(' ')} 가장 늦은 위반은 ${q3.date}의 ${josa(q3.id, '이다/다')}. 마스킹했어도 인사 부서가 보냈으므로 제5조 위반이다. 같은 인사 자료 프롬프트라도 다른 부서가 보낸 것은 위반이 아니다.` },
  ];
  const plan = [
    { needs: [['employees.csv'], ['ai_requests.csv'], ['audit_flags.png'], ['ai_usage_policy.pdf']], pattern: '[1-4]번',
      path: [{ files: ['audit_flags.png', 'employees.csv'], ask: 'audit_flags.png의 1~4번 행에 있는 employee_id 가운데 employees.csv에서 부서가 \'법무\'인 사람의 행 번호와 req_id만 적어 줘.', carry: legalOk },
        { files: ['ai_usage_policy.pdf', 'ai_requests.csv', 'audit_flags.png'], ask: '법무 부서 직원이 보낸 행: {{prev}}\n\n{{question}}' }],
      bypass: [{ files: ['ai_usage_policy.pdf', 'ai_requests.csv', 'audit_flags.png'], text: 'audit_flags.png의 4개 요청이 각각 정책 위반인지 원문으로 판정해 줘. 그중 법무 직원이 보냈을 것 같은 위반 하나를 골라 줘.' },
        { files: ['ai_usage_policy.pdf', 'employees.csv', 'audit_flags.png'], text: 'audit_flags.png의 4개 행 중 법무 부서 직원의 행을 알려 주고, 그중 정책 위반일 것 같은 하나를 골라 줘.' }] },
    { needs: [['ai_requests.csv'], ['employees.csv'], ['ai_usage_policy.pdf']], pattern: '[가-힣]{3}',
      path: [{ files: ['ai_usage_policy.pdf', 'ai_requests.csv'], ask: '2026년 6월 요청 가운데 정책 제2조(기밀 정보)를 위반한 요청을 보낸 직원의 employee_id를 모두 쉼표로만 적어 줘.', carry: juneIds },
        { files: ['employees.csv'], ask: '2026년 6월에 제2조를 위반한 직원 employee_id: {{prev}}\n\n{{question}}' }],
      bypass: [{ files: ['employees.csv', 'ai_usage_policy.pdf', 'audit_flags.png'], text: '직급이 차장인 직원의 이름과 employee_id를 모두 알려 줘. 그중 6월에 기밀 정보를 입력했을 것 같은 사람은?' }] },
    { needs: [['employees.csv'], ['ai_requests.csv'], ['ai_usage_policy.pdf']], pattern: 'R-\\d{4}',
      path: [{ files: ['employees.csv'], ask: 'employees.csv에서 부서가 \'인사\'인 직원의 employee_id를 모두 쉼표로만 적어 줘.', carry: hrIds },
        { files: ['ai_usage_policy.pdf', 'ai_requests.csv'], ask: '인사 부서 직원 employee_id: {{prev}}\n\n{{question}}' }],
      bypass: [{ files: ['ai_usage_policy.pdf', 'ai_requests.csv', 'audit_flags.png'], text: '지원자·직원 평가 자료를 넣은 요청을 모두 찾아 req_id, 날짜, employee_id를 알려 줘. 그중 인사 부서가 보낸 것으로 보이는 가장 늦은 위반은?' }] },
  ];
  plan.forEach((p, i) => { p.id = `5-${i + 1}`; });
  assertNoCrossLeak('상황 5', plan, (i) => (questions[i].type === 'mc' ? [questions[i].options[answerIdx]] : questions[i].answers));
  return {
    bundle: {
      title: '외부 AI 사용 로그 감사',
      scenario: '당신은 정보보안팀 담당자입니다. 지난 두 달간 직원들이 외부 AI에 입력한 프롬프트 로그를 받았습니다.\n내일 감사에 부서별 정책 위반 현황을 보고해야 합니다. 로그에는 직원 번호와 프롬프트 원문만 있고, 부서와 직급은 직원 명부에 있습니다. 감사 봇이 표시한 의심 건 캡처도 함께 받았습니다.',
      files, questions,
    },
    plan,
    assets: { policy: policyHtml, flags },
  };
}
