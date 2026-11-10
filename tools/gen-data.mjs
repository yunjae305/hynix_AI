// 문제 데이터 생성기.  실행: node tools/gen-data.mjs  → data.js 와 files/cs_tickets.xlsx 를 다시 만든다.
// 설계 원칙: 답에 필요한 파일들을 합치면 2만 토큰을 넘는다. 응시자는 질문을 나누고
// 중간 결과(ID 목록 등)를 다음 질문에 직접 옮겨 적어야 한다(AI는 이전 대화를 기억하지 못한다).
// 파일별 토큰 크기(tokens)를 API로 재서 넣으므로 키가 필요하다: node --env-file=.env.local tools/gen-data.mjs
// 난수 시드가 고정이라 다시 돌려도 같은 데이터가 나온다. PDF·PNG는 여기서 만들지 않는다.
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import Anthropic from '@anthropic-ai/sdk';

const ROOT = new URL('../', import.meta.url);
let seed = 20261110;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (a) => a[int(0, a.length - 1)];
const shuffle = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = int(0, i); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const csv = (head, rows) => [head, ...rows].map((r) => r.join(',')).join('\n');
const date = (m, d) => `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const SUR = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권'];
const GIV = ['민준', '서연', '도윤', '지우', '하준', '서윤', '시우', '하은', '주원', '지호', '예준', '수아', '유준', '지민', '건우', '채원', '현우', '다은', '준서', '소율'];
const person = () => pick(SUR) + pick(GIV);

// ───────────────────────── 묶음 1: 고객 문의 데이터 분석
function bundle1() {
  const N_CUST = 300, N_TICKET = 400;
  const memos = ['재구매 고객', '쿠폰 사용 이력 있음', '배송지 변경 요청 이력', '전화 상담 선호', '이메일 수신 동의', '정기 구독 이용 중', '기업 구매 담당자', '최근 3개월 구매 없음', '리뷰 작성 우수', '교환 이력 1회'];
  const vipIdx = new Set(shuffle([...Array(N_CUST).keys()]).slice(0, 10));
  const customers = [...Array(N_CUST).keys()].map((i) => ({
    id: `C-${1001 + i}`, name: person(), grade: vipIdx.has(i) ? 'VIP' : pick(['일반', '일반', '일반', '실버', '골드']),
    region: pick(['서울', '경기', '부산', '대구', '인천', '광주', '대전', '제주']), signup: date(int(1, 5), int(1, 28)).replace('2026', String(int(2021, 2025))), memo: pick(memos),
  }));
  const vips = customers.filter((c) => c.grade === 'VIP').map((c) => c.id);
  const others = customers.filter((c) => c.grade !== 'VIP').map((c) => c.id);
  const agents = ['김하늘', '박준', '이서연', '정우성', '한지민'];
  const mk = (customer_id, category, days, opened, tag) => ({ customer_id, category, agent: pick(agents), hours: int(2, 30), days, opened, received: date(int(4, 5), int(1, 28)), tag });
  const t = [];
  // VIP 환불 요청 5건: 4건은 환불 가능, 1건은 14일 이내지만 개봉이라 불가
  const v = shuffle(vips);
  t.push(mk(v[0], '환불 요청', 3, 'N'), mk(v[1], '환불 요청', 11, 'N'), mk(v[2], '환불 요청', 7, 'N'), mk(v[3], '환불 요청', 13, 'N'), mk(v[4], '환불 요청', 9, 'Y', 'vipBad'));
  // VIP의 다른 문의(헷갈리게)
  for (let i = 0; i < 7; i++) t.push(mk(pick(vips), pick(['배송 지연', '제품 불량', '사용 문의']), int(1, 25), pick(['Y', 'N'])));
  // 객관식용 일반 고객 환불 요청 4건: 1건만 불가(21일 경과)
  t.push(mk(pick(others), '환불 요청', 5, 'N', 'mc'), mk(pick(others), '환불 요청', 12, 'N', 'mc'), mk(pick(others), '환불 요청', 21, 'N', 'mcBad'), mk(pick(others), '환불 요청', 8, 'N', 'mc'));
  while (t.length < N_TICKET) t.push(mk(pick(others), pick(['환불 요청', '배송 지연', '배송 지연', '제품 불량', '사용 문의', '결제 오류']), int(1, 40), pick(['Y', 'N', 'N'])));
  const tickets = shuffle(t).map((x, i) => ({ id: `T-${2001 + i}`, ...x }));
  const mc = tickets.filter((x) => x.tag?.startsWith('mc')).map((x) => x.id).sort();
  const mcBad = tickets.find((x) => x.tag === 'mcBad').id, vipBad = tickets.find((x) => x.tag === 'vipBad').id;
  const vipRefund = tickets.filter((x) => vips.includes(x.customer_id) && x.category === '환불 요청');
  if (vipRefund.length !== 5) throw new Error('묶음 1: VIP 환불 요청 수 불일치');
  const ticketCsv = csv(['id', 'customer_id', 'category', 'agent', 'hours', 'days_since_purchase', 'opened', 'received_date'],
    tickets.map((x) => [x.id, x.customer_id, x.category, x.agent, x.hours, x.days, x.opened, x.received]));
  return {
    sheet: ticketCsv,
    bundle: {
      title: '고객 문의 데이터 분석',
      files: [
        { name: 'cs_tickets.xlsx', kind: 'sheet', url: 'files/cs_tickets.xlsx', body: ticketCsv },
        { name: 'customers.csv', body: csv(['customer_id', 'name', 'grade', 'region', 'signup_date', 'memo'], customers.map((c) => [c.id, c.name, c.grade, c.region, c.signup, c.memo])) },
        { name: 'refund_policy.md', body: `# 환불 정책 (v3)\n- 환불 요청(단순 변심): 구매 후 14일 이내이고 미개봉(opened=N)인 상품만 환불 가능\n- 제품 불량: 구매 후 30일 이내, 개봉 여부와 무관하게 환불 또는 교환\n- 배송 지연·사용 문의·결제 오류: 환불 대상 아님\n- 고객 등급(VIP 포함)에 따른 예외는 없다` },
      ],
      questions: [
        { type: 'mc', text: `다음 '환불 요청' 티켓 중 환불 정책상 환불이 불가능한 것은?`, options: mc, answer: mc.indexOf(mcBad),
          why: `${mcBad}는 구매 후 21일이 지나 14일 조건을 벗어난다. 나머지 세 건은 14일 이내·미개봉이다. 티켓 파일과 정책 파일은 함께 보내도 2만 토큰 안쪽이다.` },
        { type: 'short', text: `고객 등급이 VIP인 고객이 접수한 '환불 요청' 티켓은 몇 건인가? (숫자만)`, answers: ['5', '5건', '5개'],
          why: `등급은 customers.csv에, 티켓은 cs_tickets.xlsx에 있고 두 파일을 함께 보내면 2만 토큰을 넘는다. ① customers.csv에서 VIP인 customer_id 10개를 뽑고 ② 그 목록을 질문에 적어 cs_tickets.xlsx에서 환불 요청 티켓을 찾는다. ${vipRefund.map((x) => x.id).sort().join(', ')}로 5건.` },
        { type: 'short', text: `위 VIP 고객의 '환불 요청' 티켓 중 환불 정책상 환불이 불가능한 티켓의 id는?`, answers: [vipBad, vipBad.replace('-', ''), vipBad.replace('-', ' ')],
          why: `${vipBad}는 구매 후 9일로 14일 이내지만 개봉(opened=Y) 상품이라 환불 불가다. 정책에 VIP 예외는 없다. 앞 문제에서 찾은 5건을 정책과 함께 다시 물어봐야 한다.` },
      ],
    },
  };
}

// ───────────────────────── 묶음 2: 프롬프트 개선
function bundle2() {
  const N = 360, cats = ['배송', '품질', '가격', '환불', '서비스'];
  const ko = {
    배송: ['주문한 지 이틀 만에 도착해서 놀랐어요 포장도 꼼꼼했습니다', '배송 예정일보다 나흘이나 늦게 와서 선물 날짜를 놓쳤어요', '기사님이 문 앞에 조심히 두고 가셔서 좋았습니다', '배송 조회가 계속 멈춰 있어서 불안했는데 결국 다음 주에 왔네요'],
    품질: ['마감이 깔끔하고 사진과 색이 똑같아요 만족합니다', '두 번 썼는데 손잡이가 벌써 헐거워졌어요', '재질이 생각보다 얇지만 쓰는 데는 문제없어요', '세탁 한 번에 보풀이 잔뜩 일어나서 실망했습니다'],
    가격: ['이 가격에 이 구성이면 정말 잘 산 것 같아요', '할인 끝나자마자 가격이 더 내려가서 속상하네요', '비슷한 제품보다 조금 비싸지만 값은 합니다', '배송비까지 더하면 오프라인보다 비싸요'],
    환불: ['환불 신청하고 사흘 만에 입금돼서 편했어요', '환불 접수만 일주일째 처리 중이라 답답합니다', '반품 택배를 직접 불러야 해서 번거로웠어요', '환불 규정 안내가 친절해서 헷갈리지 않았습니다'],
    서비스: ['상담원이 끝까지 친절하게 설명해 주셨어요', '문의 답변이 복사 붙여넣기 같아서 도움이 안 됐어요', '채팅 상담 연결이 빨라서 금방 해결했습니다', '전화 연결까지 이십 분을 기다렸습니다'],
  };
  const tails = ['', ' 재구매 의사 있습니다', ' 다음에는 개선되면 좋겠어요', ' 주변에도 이야기했어요', ' 참고하세요', ' 그래도 쓸 만은 합니다'];
  const en = [['배송', 'Arrived two days early and the box was in perfect shape'], ['품질', 'The zipper broke after one week which is really disappointing'], ['가격', 'Great value for the price would buy again'],
    ['환불', 'Refund took almost three weeks and nobody answered my emails'], ['서비스', 'Support agent was kind and solved my issue quickly']];
  const enIdx = shuffle([...Array(N).keys()]).slice(0, en.length);
  const reviews = [...Array(N).keys()].map((i) => {
    const e = enIdx.indexOf(i);
    if (e >= 0) return { id: i + 1, cat: en[e][0], lang: 'en', text: en[e][1] };
    const cat = pick(cats);
    return { id: i + 1, cat, lang: 'ko', text: pick(ko[cat]) + pick(tails) };
  });
  // v2: 영어 리뷰만 형식 실패. 형식은 지켰지만 라벨이 틀린 case 9건 중 '환불' 카테고리는 정확히 1건.
  const koRefund = shuffle(reviews.filter((r) => r.lang === 'ko' && r.cat === '환불'))[0];
  const koOther = shuffle(reviews.filter((r) => r.lang === 'ko' && r.cat !== '환불')).slice(0, 8);
  const wrong = new Set([koRefund, ...koOther].map((r) => r.id));
  const rows = [];
  for (const r of reviews) rows.push([r.id, 'v1', rnd() < 0.35 ? 'Y' : 'N', rnd() < 0.8 ? 'Y' : 'N']);
  for (const r of reviews) rows.push([r.id, 'v2', r.lang === 'en' ? 'N' : 'Y', wrong.has(r.id) ? 'N' : 'Y']);
  const failIds = reviews.filter((r) => r.lang === 'en').map((r) => r.id);
  return {
    title: '프롬프트 개선',
    files: [
      { name: 'prompt_v1.txt', body: `너는 고객 리뷰 분석 전문가야.\n아래 리뷰를 읽고 감정을 분석해줘.\n\n리뷰: {review}` },
      { name: 'prompt_v2.txt', body: `너는 고객 리뷰 분석 전문가야.\n아래 리뷰의 감정을 분류해.\n\n규칙:\n- sentiment는 "긍정", "부정", "중립" 중 하나만 쓴다.\n- reason은 리뷰에서 근거가 된 표현을 20자 이내로 인용한다.\n- 다른 설명 없이 아래 JSON만 출력한다.\n\n{"sentiment": "...", "reason": "..."}\n\n예시)\n리뷰: 배송은 빨랐는데 포장이 찢어져 있었어요.\n출력: {"sentiment": "부정", "reason": "포장이 찢어져 있었어요"}\n\n리뷰: {review}` },
      { name: 'test_results.csv', body: csv(['case_id', 'prompt_version', 'format_ok', 'label_correct'], rows) },
      { name: 'reviews.csv', body: csv(['case_id', 'category', 'review'], reviews.map((r) => [r.id, r.cat, r.text])) },
    ],
    questions: [
      { type: 'mc', text: 'prompt_v2가 출력 형식을 지키지 못한(format_ok=N) 리뷰들의 공통점은?',
        options: ['모두 배송 카테고리 리뷰다', '모두 영어로 쓰인 리뷰다', '모두 100자가 넘는 긴 리뷰다', '모두 부정적인 내용의 리뷰다'], answer: 1,
        why: `결과는 test_results.csv에, 리뷰 원문은 reviews.csv에 있고 함께 보내면 2만 토큰을 넘는다. ① test_results.csv에서 v2의 format_ok=N인 case_id(${failIds.join(', ')})를 뽑고 ② 그 번호를 적어 reviews.csv에서 원문을 확인하면 모두 영어 리뷰다. v2의 규칙과 예시가 한국어만 다루기 때문이다.` },
      { type: 'short', text: 'test_results.csv에서 prompt_v2가 출력 형식을 지키지 못한(format_ok=N) case는 몇 건인가? (숫자만)', answers: [String(failIds.length), failIds.length + '건', failIds.length + '개'],
        why: `v2 행 중 format_ok가 N인 것은 case ${failIds.join(', ')}로 ${failIds.length}건. v1 행과 섞지 않도록 prompt_version=v2 조건을 분명히 줘야 한다.` },
      { type: 'short', text: `prompt_v2에서 형식은 지켰지만(format_ok=Y) 라벨이 틀린(label_correct=N) case 중, 리뷰 category가 '환불'인 case_id는? (숫자만)`, answers: [String(koRefund.id)],
        why: `① test_results.csv에서 v2이고 format_ok=Y, label_correct=N인 case_id ${wrong.size}개(${[...wrong].sort((a, b) => a - b).join(', ')})를 뽑고 ② 그 번호를 적어 reviews.csv에서 category를 확인한다. '환불'은 case ${koRefund.id} 하나다.` },
    ],
  };
}

// ───────────────────────── 묶음 3: RAG 검색 결과 검증
function bundle3() {
  const depts = ['HR', 'FIN', 'IT', 'SEC', 'OPS', 'LEG'];
  const titles = { HR: ['연차 운영 지침', '채용 절차', '근태 관리 기준', '교육비 지원 안내', '재택근무 운영 기준', '경조사 지원 기준'], FIN: ['출장비 정산 기준', '법인카드 사용 지침', '예산 편성 절차', '구매 품의 기준'], IT: ['계정 발급 절차', '장비 반납 기준', '원격 접속 가이드', '소프트웨어 설치 기준'],
    SEC: ['출입 통제 기준', '문서 반출 절차', '비밀번호 관리 기준'], OPS: ['회의실 예약 안내', '사무용품 신청 절차', '주차 등록 안내'], LEG: ['계약 검토 절차', '인장 사용 기준', '대외 공문 발송 기준'] };
  const sentences = ['신청은 사용일 기준 영업일 3일 전까지 시스템에 등록한다.', '부서장 승인 후 담당 부서가 최종 확인한다.', '증빙 서류는 전자 문서로 첨부하며 원본은 5년간 보관한다.', '기준을 초과하는 경우 사전에 품의를 받아야 한다.', '분기마다 사용 현황을 점검하고 결과를 공지한다.',
    '신규 입사자는 입사 첫 주에 안내 교육을 받는다.', '위반 시 1차 경고 후 재발하면 권한을 회수한다.', '긴급한 경우 사후 승인을 받을 수 있으나 3일 이내에 등록해야 한다.', '외부 반출이 필요한 경우 보안 담당자의 확인을 받는다.', '담당자가 바뀌면 인수인계 내용을 문서로 남긴다.',
    '비용은 건당 한도 내에서 실비로 정산한다.', '예약은 최대 2주 전부터 가능하며 미사용 시 자동 취소된다.', '장비는 퇴사일 전날까지 반납하고 확인서를 받는다.', '계약서는 서명 전에 법무 검토를 거친다.', '재택근무는 주 2회까지 가능하며 전날까지 일정을 공유한다.'];
  const ids = new Set(); const docs = [];
  const add = (id, title, status, updated, replaced = '') => { ids.add(id); docs.push({ id, title, dept: id.split('-')[0], status, updated, replaced }); };
  add('HR-2023-07', '연차 운영 지침(구)', '폐기', '2023-07-01', 'HR-2025-03'); add('HR-2025-03', '연차 운영 지침', '현행', '2025-03-01'); add('HR-2024-11', '연차 신청 절차', '현행', '2024-11-15');
  add('FIN-2024-02', '출장비 정산 기준', '현행', '2024-02-10'); add('HR-2022-01', '경조 휴가 기준', '현행', '2022-01-05');
  add('HR-2021-04', '휴가 사용 안내(구)', '폐기', '2021-04-12', 'HR-2024-11'); add('HR-2024-05', '휴직 운영 기준', '현행', '2024-05-20'); add('OPS-2025-01', '근무 일정 공유 안내', '현행', '2025-01-08');
  add('HR-2025-06', '반차·시간 단위 휴가 기준', '현행', '2025-06-02'); add('HR-2023-12', '연말 휴가 운영 안내', '현행', '2023-12-01');
  while (docs.length < 300) {
    const d = pick(depts), id = `${d}-${int(2019, 2025)}-${String(int(1, 12)).padStart(2, '0')}`;
    if (ids.has(id)) continue;
    const old = rnd() < 0.3;
    add(id, pick(titles[d]) + (old ? '(구)' : ''), old ? '폐기' : '현행', `${id.split('-')[1]}-${id.split('-')[2]}-${String(int(1, 28)).padStart(2, '0')}`, '');
  }
  for (const d of docs) if (d.status === '폐기' && !d.replaced) d.replaced = pick(docs.filter((x) => x.status === '현행' && x.dept === d.dept)).id;
  const filler = () => [pick(sentences), pick(sentences), pick(sentences)].join(' ');
  // 점수 0.75 이상 9개 청크(문서 8종, 그중 폐기 2종: HR-2023-07, HR-2021-04)
  const top = [
    ['OPS-2025-01', 0.88, '휴가 일정은 팀 캘린더에 사용일 전날까지 공유한다. ' + filler()], ['HR-2025-06', 0.85, '반차와 시간 단위 휴가는 연차에서 차감한다. ' + filler()],
    ['HR-2023-07', 0.82, '미사용 연차는 최대 5일까지 다음 해로 이월할 수 있다.'], ['HR-2021-04', 0.81, '휴가는 사용일 하루 전까지 서면으로 신청한다. ' + filler()],
    ['HR-2025-03', 0.79, '2025년 3월 개정: 미사용 연차 이월 한도는 최대 3일이며, 이월 연차는 다음 해 3월 31일까지 사용해야 한다.'], ['HR-2024-05', 0.78, '휴직 기간에는 연차가 새로 발생하지 않는다. ' + filler()],
    ['HR-2025-06', 0.77, '시간 단위 휴가는 하루 최대 4시간까지 쓸 수 있다. ' + filler()], ['HR-2024-11', 0.76, '연차 사용 신청은 사용일 3일 전까지 인사 시스템에 등록한다.'], ['HR-2023-12', 0.75, '연말 마지막 주는 전사 공동 휴가로 운영한다. ' + filler()],
  ];
  const rest = [['FIN-2024-02', 0.61, '출장비 정산은 출장 종료 후 14일 이내에 한다.'], ['HR-2022-01', 0.58, '경조 휴가는 연차와 별도로 부여한다.']];
  const pool = docs.filter((d) => !top.some((t) => t[0] === d.id));
  while (top.length + rest.length < 90) rest.push([pick(pool).id, int(30, 74) / 100, filler()]);
  const chunks = [...top, ...rest].sort((a, b) => b[1] - a[1]).map(([doc_id, score, text], i) => ({ chunk: i + 1, doc_id, score, text }));
  const hi = chunks.filter((c) => c.score >= 0.75), hiDocs = [...new Set(hi.map((c) => c.doc_id))];
  const dead = hiDocs.filter((id) => docs.find((d) => d.id === id).status === '폐기');
  if (hi.length !== 9 || dead.length !== 2) throw new Error('묶음 3: 상위 청크 구성 불일치');
  return {
    title: 'RAG 검색 결과 검증',
    files: [
      { name: 'user_question.txt', body: `[사내 규정 챗봇에 들어온 질문]\n연차 이월은 며칠까지 되고, 언제까지 써야 하나요? 신청은 어떻게 하죠?` },
      { name: 'answer_draft.md', body: `[챗봇이 생성한 답변 초안]\n① 미사용 연차는 최대 5일까지 이월할 수 있습니다. [HR-2023-07]\n② 이월한 연차는 다음 해 3월 31일까지 사용해야 합니다. [HR-2025-03]\n③ 연차 신청은 사용일 3일 전까지 인사 시스템에 등록합니다. [HR-2024-11]\n④ 기한 안에 쓰지 못한 이월 연차는 수당으로 지급됩니다. [HR-2025-03]` },
      { name: 'retrieved_chunks.json', body: '[\n' + chunks.map((c) => '  ' + JSON.stringify(c)).join(',\n') + '\n]' },
      { name: 'doc_registry.csv', body: csv(['doc_id', 'title', 'dept', 'status', 'updated', 'replaced_by'], shuffle(docs).map((d) => [d.id, d.title, d.dept, d.status, d.updated, d.replaced])) },
    ],
    questions: [
      { type: 'mc', text: 'answer_draft.md의 문장 중, 검색된 청크(retrieved_chunks.json) 어디에도 근거가 없는 문장은?',
        options: ['① 최대 5일까지 이월', '② 다음 해 3월 31일까지 사용', '③ 사용일 3일 전까지 등록', '④ 못 쓴 이월 연차는 수당 지급'], answer: 3,
        why: '수당 지급에 관한 내용은 어떤 청크에도 없다. 출처 표시([HR-2025-03])가 붙어 있어도 원문에 없으면 환각이다. ①은 청크에 근거는 있지만 폐기된 옛 문서다(3번 문제).' },
      { type: 'short', text: `retrieved_chunks.json에서 score가 0.75 이상인 청크들의 문서 가운데, doc_registry.csv에서 status가 '폐기'인 문서는 몇 개인가? (숫자만)`, answers: ['2', '2개', '2건'],
        why: `두 파일을 함께 보내면 2만 토큰을 넘는다. ① retrieved_chunks.json에서 score 0.75 이상인 청크의 doc_id(${hiDocs.join(', ')})를 뽑고 ② 그 목록을 적어 doc_registry.csv에서 status를 확인한다. 폐기는 ${dead.join(', ')}로 2개. 점수가 높다고 현행 문서인 것은 아니다.` },
      { type: 'short', text: 'answer_draft.md의 ①이 인용한 문서는 doc_registry.csv에서 폐기 상태다. 이 문서를 대체한 현행 문서의 doc_id는?', answers: ['HR-2025-03', 'HR202503', 'HR 2025 03'],
        why: '①은 HR-2023-07(이월 5일)을 인용했지만, doc_registry.csv에서 이 문서는 폐기이고 replaced_by가 HR-2025-03이다. 현행 규정의 이월 한도는 3일이다.' },
    ],
  };
}

// ───────────────────────── 묶음 4: 회의록 요약 검토
function bundle4() {
  const who = ['정민지', '오세훈', '한유라', '최도윤', '강태오', '서지안'];
  const topics = ['주간 활성 사용자', '응답 속도', '고객 문의량', '서버 비용', '신규 가입 전환율', '앱 평점', '검색 성공률', '결제 실패율', '온보딩 완료율', '푸시 알림 수신율'];
  const causes = ['지난주 배포의 영향', '마케팅 캠페인 효과', '특정 기기에서의 오류', '외부 연동 지연', '연휴로 인한 이용 패턴 변화', '신규 기능 노출 위치 변경'];
  const extra = ['대시보드에 세부 수치를 올려 두었으니 참고해 주세요.', '비슷한 흐름이 다른 지표에도 보이는지 같이 보고 있습니다.', '고객 인터뷰에서도 같은 이야기가 나왔습니다.', '경쟁 서비스도 비슷한 시기에 같은 변화를 겪었다고 합니다.', '세부 원인은 로그를 더 살펴봐야 알 수 있습니다.', '지난 분기와 비교하면 아직 안정적인 범위입니다.'];
  // 잡담·현황 공유. 기한·완료·출시일 같은 표현은 넣지 않는다(문제의 단서와 섞이지 않게).
  const filler = () => {
    const [a, b] = shuffle(who);
    return [`${a}: ${pick(topics)} 현황 공유드립니다. 이번 주 수치는 ${int(12, 980)}로 지난주보다 ${int(1, 19)}% ${pick(['올랐습니다', '내렸습니다'])}.`,
      `${b}: 원인은 ${pick(causes)}로 보고 있습니다. ${pick(extra)}`, `${a}: 네, ${pick(extra)}`];
  };
  const build = (head, keys, n) => {
    const blocks = Array.from({ length: n }, filler);
    const step = Math.floor(n / (keys.length + 1));
    keys.forEach((k, i) => blocks.splice((i + 1) * step + i, 0, k));
    return head + '\n\n' + blocks.map((b) => b.join('\n')).join('\n');
  };
  const N = 50;
  const m1 = build('[2026-06-03 주간 제품 회의] 참석: 정민지(PM), 오세훈(백엔드), 한유라(디자인), 최도윤(QA), 강태오(데이터), 서지안(마케팅)', [
    ['정민지: 챗봇 요약 기능 출시일은 6월 20일로 확정하겠습니다.', '서지안: 네, 그 날짜 기준으로 공지 일정을 잡겠습니다.'],
    ['정민지: 세훈 님, 응답 캐시 설계 문서를 6월 9일까지 부탁드립니다.', '오세훈: 네, 6월 9일까지 작성하겠습니다.'],
    ['한유라: 오류 안내 문구 시안은 제가 6월 9일까지 올리겠습니다.'],
    ['최도윤: QA 체크리스트는 제가 6월 9일까지 작성하겠습니다.'],
    ['정민지: 태오 님, 사용량 대시보드 초안도 6월 9일까지 가능할까요?', '강태오: 네, 6월 9일까지 만들어 보겠습니다.'],
  ], N);
  const m2 = build('[2026-06-10 주간 제품 회의] 참석: 정민지(PM), 오세훈(백엔드), 한유라(디자인), 최도윤(QA), 강태오(데이터), 서지안(마케팅)', [
    ['오세훈: 응답 캐시 설계 문서는 완료해서 위키에 공유했습니다.'],
    ['최도윤: QA 체크리스트 작성도 완료했습니다.'],
    ['강태오: 사용량 대시보드는 데이터 연결이 덜 돼서 아직 진행 중입니다.'],
    ['오세훈: 요약 응답이 느린 문제가 남아 있어서 캐시를 실제로 적용하려면 일주일이 더 필요합니다.', '정민지: 그럼 출시일을 6월 27일로 미루겠습니다. 세훈 님은 캐시 적용을 6월 16일까지 끝내 주세요.', '오세훈: 네, 6월 16일까지 하겠습니다.'],
    ['서지안: 출시 공지 초안은 제가 6월 16일까지 준비하겠습니다.'],
  ], N);
  const m3 = build('[2026-06-17 주간 제품 회의] 참석: 정민지(PM), 오세훈(백엔드), 한유라(디자인), 최도윤(QA), 강태오(데이터), 서지안(마케팅)', [
    ['한유라: 오류 안내 문구 시안은 완료해서 디자인 폴더에 올렸습니다.'],
    ['오세훈: 캐시 적용은 완료했고 응답 속도가 목표 안으로 들어왔습니다.'],
    ['최도윤: 보안 점검에서 확인할 항목이 더 나왔습니다. 점검을 마치려면 6월 24일까지 필요합니다.', '정민지: 알겠습니다. 출시일을 7월 4일로 한 번 더 미루겠습니다. 도윤 님은 보안 점검을 6월 24일까지 마쳐 주세요.', '최도윤: 네, 6월 24일까지 끝내겠습니다.'],
    ['최도윤: 테스트 계정이 5개 필요합니다.', '정민지: 테스트 계정은 제가 6월 18일까지 발급하겠습니다.'],
    ['한유라: 가격 정책도 오늘 정하나요?', '정민지: 가격 정책은 다음 달에 다시 논의하죠. 오늘은 결정하지 않겠습니다.'],
  ], N);
  return {
    title: '회의록 요약 검토',
    files: [
      { name: 'meeting_0603.txt', body: m1 }, { name: 'meeting_0610.txt', body: m2 }, { name: 'meeting_0617.txt', body: m3 },
      { name: 'ai_summary.md', body: `[AI가 작성한 6월 17일 회의 요약]\n## 결정 사항\n- 출시일을 7월 4일로 연기\n- 가격 정책을 인상하기로 결정\n\n## 액션아이템\n- 최도윤: 6월 24일까지 보안 점검 완료\n- 정민지: 6월 18일까지 테스트 계정 발급` },
    ],
    questions: [
      { type: 'mc', text: 'ai_summary.md의 내용 중 실제 6월 17일 회의(meeting_0617.txt) 내용과 다른 것은?',
        options: ['출시일을 7월 4일로 연기', '가격 정책을 인상하기로 결정', '최도윤: 6월 24일까지 보안 점검 완료', '정민지: 6월 18일까지 테스트 계정 발급'], answer: 1,
        why: '가격 정책은 "다음 달에 다시 논의", "오늘은 결정하지 않겠습니다"라고 했다. 요약이 없던 결정을 만들어냈다.' },
      { type: 'short', text: '세 번의 회의를 통틀어, 처음 확정된 출시일은 이후 몇 번 변경되었는가? (숫자만)', answers: ['2', '2번', '2회'],
        why: '회의록 세 개를 한 번에 보내면 2만 토큰을 넘으므로 나눠서 물어야 한다. 6/3에 6월 20일로 확정 → 6/10에 6월 27일로 변경 → 6/17에 7월 4일로 변경. 2번이다.' },
      { type: 'short', text: '6월 3일 회의에서 기한과 함께 정해진 액션아이템 중, 6월 17일 회의까지 완료 보고가 한 번도 없는 항목의 담당자 이름은?', answers: ['강태오'],
        why: '6/3 액션아이템은 오세훈(캐시 설계 문서), 한유라(문구 시안), 최도윤(QA 체크리스트), 강태오(사용량 대시보드) 4개. 6/10에 오세훈·최도윤이, 6/17에 한유라가 완료를 보고했다. 강태오는 6/10에 "아직 진행 중"이라고만 했다. 6/3의 항목 목록을 적어 두고 나머지 회의록에 차례로 물어야 한다.' },
    ],
  };
}

// ───────────────────────── 묶음 5: 보안·개인정보 점검
function bundle5() {
  const depts = ['개발', '개발', '개발', '마케팅', '마케팅', 'CS', 'CS', 'CS', '재무', '인사', '영업', '영업'];
  const N_EMP = 400, N_REQ = 300;
  const legalIdx = new Set(shuffle([...Array(N_EMP).keys()]).slice(0, 4));
  const emps = [...Array(N_EMP).keys()].map((i) => ({ id: `E-${3001 + i}`, name: person(), dept: legalIdx.has(i) ? '법무' : pick(depts), title: pick(['사원', '사원', '대리', '과장', '차장']), office: pick(['본사 3층', '본사 5층', '본사 7층', '판교 2층', '부산 지사']), joined: `${int(2015, 2025)}-${String(int(1, 12)).padStart(2, '0')}` }));
  const legal = emps.filter((e) => e.dept === '법무').map((e) => e.id), nonLegal = emps.filter((e) => e.dept !== '법무').map((e) => e.id);
  const OK = [['지난주 배포한 보도자료 요약', '해당없음'], ['공개 채용 공고 문구 교정', '해당없음'], ['공개된 제품 설명서 영문 번역', '해당없음'], ['이름·이메일을 마스킹한 상담 내역 요약', 'Y'], ['엑셀 함수 사용법 질문', '해당없음'],
    ['오픈소스 라이브러리 사용법 질문', '해당없음'], ['전화번호를 마스킹한 설문 응답 분류', 'Y'], ['공개 세미나 발표 제목 아이디어', '해당없음']];
  const BAD = [['고객 이름·전화번호가 포함된 상담 내역 원문 분류', 'N'], ['API 키가 들어 있는 설정 파일 오류 분석', '해당없음'], ['미공개 분기 실적 초안 문장 다듬기', '해당없음'], ['지원자 이름·연락처가 포함된 이력서 원문 요약', 'N'],
    ['DB 비밀번호가 적힌 접속 스크립트 수정', '해당없음'], ['고객 이메일 주소 목록 원문 정리', 'N'], ['미공개 인수 검토 자료의 재무 수치 요약', '해당없음']];
  const mk = (employee_id, [content, masked], bad, tag) => ({ employee_id, content, masked, bad, date: date(int(5, 6), int(1, 28)), tag });
  const r = [];
  // 법무 직원 요청 7건 중 위반 3건
  [BAD[2], BAD[6], BAD[0]].forEach((c) => r.push(mk(pick(legal), c, true)));
  [OK[0], OK[3], OK[4], OK[7]].forEach((c) => r.push(mk(pick(legal), c, false)));
  // 객관식용 4건(법무 외): 위반 3 + 정상 1
  r.push(mk(pick(nonLegal), BAD[1], true, 'mc'), mk(pick(nonLegal), BAD[3], true, 'mc'), mk(pick(nonLegal), OK[6], false, 'mcOk'), mk(pick(nonLegal), BAD[5], true, 'mc'));
  while (r.length < N_REQ) { const bad = rnd() < 0.3; r.push(mk(pick(nonLegal), pick(bad ? BAD : OK), bad)); }
  const reqs = shuffle(r).map((x, i) => ({ id: `R-${5001 + i}`, ...x }));
  const mc = reqs.filter((x) => x.tag?.startsWith('mc')).map((x) => x.id).sort(), mcOk = reqs.find((x) => x.tag === 'mcOk').id;
  const legalReqs = reqs.filter((x) => legal.includes(x.employee_id)), legalBad = legalReqs.filter((x) => x.bad);
  if (legalReqs.length !== 7 || legalBad.length !== 3) throw new Error('묶음 5: 법무 요청 구성 불일치');
  return {
    title: '보안·개인정보 점검',
    files: [
      { name: 'ai_usage_policy.pdf', kind: 'pdf', url: 'files/ai_usage_policy.pdf', preview: 'files/ai_usage_policy.preview.png' },
      { name: 'ai_requests.csv', body: csv(['req_id', 'date', 'employee_id', 'content', 'masked'], reqs.map((x) => [x.id, x.date, x.employee_id, x.content, x.masked])) },
      { name: 'employees.csv', body: csv(['employee_id', 'name', 'dept', 'title', 'office', 'joined'], emps.map((e) => [e.id, e.name, e.dept, e.title, e.office, e.joined])) },
      { name: 'customer_table.png', kind: 'image', url: 'files/customer_table.png' },
    ],
    questions: [
      { type: 'mc', text: 'ai_requests.csv의 다음 요청 중 사용 정책(ai_usage_policy.pdf)을 위반하지 않는 것은?', options: mc, answer: mc.indexOf(mcOk),
        why: `${mcOk}는 전화번호를 마스킹한 뒤 입력했으므로 제1조를 지켰다. 나머지는 인증 키(제2조), 마스킹하지 않은 개인정보(제1조)를 그대로 넣은 요청이다.` },
      { type: 'short', text: '동료가 고객 표를 캡처한 customer_table.png를 보냈다. 이 표를 외부 AI에 넣기 전에 정책상 마스킹해야 하는 컬럼은 몇 개인가? (숫자만)', answers: ['3', '3개'],
        why: 'name, phone, email 3개가 제1조의 개인정보에 해당한다. customer_id, plan, monthly_fee, signup_date는 해당하지 않는다. 정책 PDF와 이미지를 함께 멘션하면 AI가 둘 다 읽는다.' },
      { type: 'short', text: `'법무' 부서 직원이 보낸 요청 중 사용 정책을 위반한 것은 몇 건인가? (숫자만)`, answers: ['3', '3건', '3개'],
        why: `부서는 employees.csv에, 요청은 ai_requests.csv에 있고 함께 보내면 2만 토큰을 넘는다. ① employees.csv에서 법무 직원 employee_id 4개(${legal.join(', ')})를 뽑고 ② 그 목록을 적어 ai_requests.csv에서 이들의 요청 7건을 찾은 뒤 ③ 정책과 대조한다. 위반은 ${legalBad.map((x) => x.id).sort().join(', ')}로 3건.` },
    ],
  };
}

const b1 = bundle1();
const BUNDLES = [b1.bundle, bundle2(), bundle3(), bundle4(), bundle5()];

// 엑셀 원본을 data.js의 표 내용과 같은 값으로 만든다
const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('tickets');
b1.sheet.split('\n').forEach((l, i) => ws.addRow(l.split(',').map((v) => (i && /^\d+$/.test(v) ? +v : v))));
ws.getRow(1).font = { bold: true }; ws.columns.forEach((c) => (c.width = 18));
await wb.xlsx.writeFile(new URL('files/cs_tickets.xlsx', ROOT).pathname);

// 파일별 토큰 크기: 화면에서 첨부할 때 보여준다. index.html의 toApi와 같은 모양으로 잰다.
if (!process.env.ANTHROPIC_API_KEY) throw new Error('토큰 크기를 재려면 키가 필요합니다: node --env-file=.env.local tools/gen-data.mjs');
const client = new Anthropic();
const asBlocks = (f) => {
  if (!f.kind || f.kind === 'sheet') return [{ type: 'text', text: `<file name="${f.name}">\n${f.body}\n</file>` }];
  const data = fs.readFileSync(new URL(f.url, ROOT)).toString('base64');
  const block = f.kind === 'pdf' ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } } : { type: 'image', source: { type: 'base64', media_type: 'image/png', data } };
  return [{ type: 'text', text: `[첨부파일: ${f.name}]` }, block];
};
for (const B of BUNDLES) {
  await Promise.all(B.files.map(async (f) => {
    f.tokens = (await client.messages.countTokens({ model: 'claude-haiku-5-5', messages: [{ role: 'user', content: asBlocks(f) }] })).input_tokens;
  }));
}

const head = `// 문제 데이터. 묶음 5개 × (객관식 1 + 단답형 2).
// 이 파일은 tools/gen-data.mjs 가 만든다. 직접 고치지 말고 생성기를 고친 뒤 \`node tools/gen-data.mjs && node check.mjs\`.
// 첨부파일 종류(kind): 없음=글자 파일(body), 'sheet'=엑셀(body는 AI·미리보기용 표 내용),
//   'pdf'·'image'=원본을 그대로 AI에 전달(pdf는 preview 이미지로 화면 표시). 원본은 files/ 폴더.
// tokens = 그 파일을 AI에 첨부할 때 드는 토큰 수(생성기가 API로 잰 값).
// 단답형 answers는 허용 표기 목록(공백·대소문자는 채점 때 무시).
`;
fs.writeFileSync(new URL('data.js', ROOT), head + 'const BUNDLES = ' + JSON.stringify(BUNDLES, null, 1) + ';\n');
for (const B of BUNDLES) console.log(B.title, '|', B.files.map((f) => `${f.name} ${f.tokens}토큰`).join(', '));
