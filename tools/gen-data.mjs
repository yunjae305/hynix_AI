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

// ───────────────────────── 상황 1: 글로벌 쇼핑몰 VIP 환불 보고
// 어려운 점: 티켓에 분류가 없고 원문이 한·영·일 3개 언어, VIP 표시도 없어 정책 기준으로 가려내야 한다.
function bundle1() {
  const N_CUST = 360, N_TICKET = 330;
  const MSG = {
    change: { ko: ['생각했던 것과 달라서 돈으로 돌려받고 싶어요', '마음이 바뀌어서 결제를 취소하고 환불받고 싶습니다', '필요가 없어져서 반품하고 환불을 원합니다'], en: ['I changed my mind and would like my money back', 'It is not what I expected so please refund my order'], ja: ['イメージと違ったので返金をお願いします', '不要になったので返品して返金してほしいです'] },
    defect: { ko: ['받자마자 전원이 안 켜집니다 환불해 주세요', '상자를 열어 보니 깨져 있었습니다 환불 부탁드립니다'], en: ['The item arrived broken and I want a full refund'], ja: ['届いた商品が壊れていたので返金してください'] },
    exchange: { ko: ['사이즈가 안 맞아서 한 치수 큰 것으로 바꾸고 싶어요'], en: ['Can I swap this for the same item in a different color'], ja: ['サイズが合わないので交換をお願いします'] },
    delivery: { ko: ['주문한 지 일주일인데 아직 안 왔어요 언제 오나요'], en: ['Where is my package it has been ten days already'], ja: ['注文した商品はいつ届きますか'] },
    payment: { ko: ['카드가 두 번 결제된 것 같아요 확인 부탁드려요'], en: ['I was charged twice for one order please check'], ja: ['二重に請求されているようです確認してください'] },
    usage: { ko: ['설명서대로 해도 연결이 안 되는데 방법을 알려 주세요'], en: ['How do I reset the device to factory settings'], ja: ['初期設定の方法を教えてください'] },
  };
  const vipIdx = shuffle([...Array(N_CUST).keys()]);
  const vipSet = new Set(vipIdx.slice(0, 10)), nearSet = new Set(vipIdx.slice(10, 12)); // near: 기준에 살짝 못 미치는 고객(함정)
  const customers = [...Array(N_CUST).keys()].map((i) => ({
    id: `C-${1001 + i}`, name: person(), region: pick(['서울', '경기', '부산', '도쿄', '오사카', '뉴욕', '런던', '시드니']), signup: `${int(2019, 2025)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`,
    spend: vipSet.has(i) ? int(500, 980) * 10000 : nearSet.has(i) ? pick([4950000, 4990000]) : int(10, 300) * 10000, orders: int(1, 40),
  }));
  const vips = customers.filter((c) => c.spend >= 5000000).map((c) => c.id), near = customers.filter((c) => c.spend >= 4900000 && c.spend < 5000000).map((c) => c.id);
  const others = customers.filter((c) => c.spend < 4900000).map((c) => c.id);
  if (vips.length !== 10 || near.length !== 2) throw new Error('상황 1: VIP 구성 불일치');
  const mk = (customer_id, intent, lang, amount, days, opened, tag) => ({ customer_id, intent, lang, message: pick(MSG[intent][lang]), amount, days, opened, tag });
  const rand = (cid) => { const intent = pick(['change', 'defect', 'exchange', 'delivery', 'delivery', 'payment', 'usage']); return mk(cid, intent, pick(['ko', 'ko', 'en', 'ja']), int(2, 30) * 10000 + pick([0, 5000, 9000]), int(1, 45), pick(['Y', 'N', 'N'])); };
  const v = shuffle(vips), t = [];
  // VIP의 단순 변심 환불 5건: 가능 3건(그중 1건은 VIP 30일 연장 덕분), 불가 2건(개봉 / 30일 초과)
  t.push(mk(v[0], 'change', 'ko', 89000, 5, 'N', 'vipOk'), mk(v[1], 'change', 'en', 152000, 22, 'N', 'vipOk'), mk(v[2], 'change', 'ja', 37000, 9, 'N', 'vipOk'),
    mk(v[3], 'change', 'ko', 240000, 12, 'Y', 'vipNo'), mk(v[4], 'change', 'ja', 64000, 34, 'N', 'vipNo'));
  // VIP의 다른 문의(불량 환불·교환·배송 등): 변심 환불로 세면 안 된다
  t.push(mk(v[5], 'defect', 'en', 120000, 18, 'Y'), mk(v[6], 'defect', 'ko', 45000, 40, 'N'), mk(v[7], 'exchange', 'ja', 58000, 6, 'N'), mk(v[8], 'delivery', 'en', 99000, 10, 'N'),
    mk(v[9], 'payment', 'ko', 133000, 3, 'N'), mk(v[0], 'usage', 'ko', 71000, 20, 'Y'), mk(v[2], 'exchange', 'ko', 82000, 4, 'N'));
  // 기준에 살짝 못 미치는 고객의 변심 환불(VIP로 잘못 세기 쉬움)
  near.forEach((c) => t.push(mk(c, 'change', 'ko', 110000, 8, 'N')));
  // 객관식: 환불 요청이 아닌 것 하나(일본어 교환 문의)
  t.push(mk(pick(others), 'change', 'ja', 75000, 6, 'N', 'mc'), mk(pick(others), 'defect', 'en', 98000, 11, 'Y', 'mc'), mk(pick(others), 'exchange', 'ja', 66000, 7, 'N', 'mcNo'), mk(pick(others), 'change', 'ko', 54000, 3, 'N', 'mc'));
  while (t.length < N_TICKET) t.push(rand(pick(others)));
  const tickets = shuffle(t).map((x, i) => ({ id: `T-${2001 + i}`, ...x }));
  const mc = tickets.filter((x) => x.tag?.startsWith('mc')).map((x) => x.id).sort(), mcNo = tickets.find((x) => x.tag === 'mcNo').id;
  const vipChange = tickets.filter((x) => vips.includes(x.customer_id) && x.intent === 'change');
  const okSum = vipChange.filter((x) => x.days <= 30 && x.opened === 'N').reduce((s, x) => s + x.amount - 6000, 0);
  if (vipChange.length !== 5 || okSum !== 260000) throw new Error('상황 1: VIP 환불 구성 불일치 ' + okSum);
  const ticketCsv = csv(['id', 'customer_id', 'message', 'order_amount', 'days_since_purchase', 'opened'], tickets.map((x) => [x.id, x.customer_id, x.message, x.amount, x.days, x.opened]));
  return {
    sheet: ticketCsv,
    bundle: {
      title: '글로벌 쇼핑몰 VIP 환불 보고',
      scenario: '당신은 해외 직구 쇼핑몰의 CS 운영 담당자입니다. 오늘 오후 임원 회의에 "VIP 고객 환불 현황"을 보고해야 합니다.\n티켓 330건에는 분류 값이 없고, 고객이 한국어·영어·일본어로 쓴 문의 원문만 있습니다. 고객 표에도 VIP 표시가 없어서, 환불 정책에 적힌 기준으로 직접 가려내야 합니다.',
      files: [
        { name: 'cs_tickets.xlsx', kind: 'sheet', url: 'files/cs_tickets.xlsx', body: ticketCsv },
        { name: 'customers.csv', body: csv(['customer_id', 'name', 'region', 'signup_date', 'total_spend_12m', 'orders_12m'], customers.map((c) => [c.id, c.name, c.region, c.signup, c.spend, c.orders])) },
        { name: 'refund_policy.md', body: `# 환불 정책 (v4)\n1. VIP 고객: 최근 12개월 구매액(total_spend_12m)이 5000000원 이상인 고객.\n2. 단순 변심 환불: 구매 후 14일 이내(VIP는 30일 이내)이고 미개봉(opened=N)인 경우에만 가능하다. 환불액 = 주문 금액(order_amount) - 왕복 배송비 6000원.\n3. 제품 불량 환불: 구매 후 30일 이내이면 개봉 여부와 무관하게 주문 금액 전액을 환불한다.\n4. 교환 요청, 배송 문의, 결제 오류 문의, 사용법 문의는 환불 요청이 아니다.` },
      ],
      questions: [
        { type: 'mc', text: '다음 티켓 중 고객이 환불을 요청한 것이 아닌 티켓은?', options: mc, answer: mc.indexOf(mcNo),
          why: `${mcNo}는 일본어로 "사이즈가 맞지 않으니 교환해 달라"는 내용이다. 정책 4에 따라 교환 요청은 환불 요청이 아니다. 나머지 세 건은 한국어·영어·일본어로 환불을 요청했다.` },
        { type: 'short', text: `VIP 고객이 보낸 '단순 변심 환불' 요청 티켓은 몇 건인가? (숫자만)`, answers: ['5', '5건', '5개'],
          why: `두 파일을 함께 보내면 2만 토큰을 넘는다. ① customers.csv에서 total_spend_12m이 500만 원 이상인 customer_id 10개를 뽑는다(495만·499만 원인 고객 2명은 VIP가 아니다). ② 그 목록을 적어 cs_tickets.xlsx에서 해당 고객의 티켓을 찾고 원문의 뜻으로 분류한다. 단순 변심 환불은 ${vipChange.map((x) => x.id).sort().join(', ')}로 5건. 불량 환불·교환·배송 문의는 세지 않는다.` },
        { type: 'short', text: '그 5건 중 정책상 환불이 가능한 건들의 환불액 합계는 얼마인가? (원 단위 숫자만)', answers: ['260000', '260,000', '260000원', '260,000원', '26만원', '26만'],
          why: `가능한 것은 3건이다. 89,000원(5일), 152,000원(22일, VIP라 30일 이내 적용), 37,000원(9일). 각 건에서 왕복 배송비 6,000원을 빼면 83,000 + 146,000 + 31,000 = 260,000원. 240,000원 건은 개봉, 64,000원 건은 34일 경과로 불가다.` },
      ],
    },
  };
}

// ───────────────────────── 상황 2: 프롬프트 v2 배포 판단
// 어려운 점: 리뷰에 분류가 없어서 실패한 리뷰를 직접 읽고 원인을 찾아야 한다(일본어, 혼합 감정).
function bundle2() {
  const N = 400;
  const plain = ['주문한 지 이틀 만에 도착해서 놀랐어요 포장도 꼼꼼했습니다', '배송 예정일보다 나흘이나 늦게 와서 선물 날짜를 놓쳤어요', '기사님이 문 앞에 조심히 두고 가셔서 좋았습니다', '배송 조회가 계속 멈춰 있어서 불안했습니다',
    '마감이 깔끔하고 사진과 색이 똑같아요 만족합니다', '두 번 썼는데 손잡이가 벌써 헐거워졌어요', '세탁 한 번에 보풀이 잔뜩 일어나서 실망했습니다', '이 가격에 이 구성이면 정말 잘 산 것 같아요', '할인 끝나자마자 가격이 더 내려가서 속상하네요',
    '환불 신청하고 사흘 만에 입금돼서 편했어요', '반품 택배를 직접 불러야 해서 번거로웠어요', '환불 규정 안내가 친절해서 헷갈리지 않았습니다', '상담원이 끝까지 친절하게 설명해 주셨어요', '문의 답변이 복사해 붙인 것 같아서 도움이 안 됐어요', '전화 연결까지 이십 분을 기다렸습니다'];
  const tails = ['', ' 재구매 의사 있습니다', ' 다음에는 개선되면 좋겠어요', ' 주변에도 이야기했어요', ' 참고하세요'];
  const ja = ['二日で届いて梱包も丁寧でした', '一週間でファスナーが壊れてしまい残念です', 'この値段でこの品質なら大満足です', '問い合わせの返事がとても遅かったです', 'スタッフの対応が親切で助かりました'];
  // 칭찬과 불만이 함께 있는 리뷰(v2가 라벨을 틀림). 첫 문장만 환불 지연을 말한다.
  const mixed = ['상담원은 친절했지만 환불이 3주째 들어오지 않고 있어요', '배송은 정말 빨랐는데 제품 마감이 엉망이에요', '디자인은 마음에 드는데 가격이 너무 비싸요', '품질은 좋은데 배송이 열흘이나 걸렸어요', '가격은 저렴했지만 상담 연결이 너무 어려웠어요',
    '포장은 꼼꼼했는데 색이 사진과 전혀 달라요', '기능은 만족하지만 설명서가 너무 불친절해요', '사은품은 좋았는데 본품 크기가 생각보다 작아요', '교환은 빨리 해 주셨지만 새 제품도 흠집이 있었어요'];
  const idx = shuffle([...Array(N).keys()]), jaIdx = idx.slice(0, ja.length), mixIdx = idx.slice(ja.length, ja.length + mixed.length);
  const reviews = [...Array(N).keys()].map((i) => {
    if (jaIdx.includes(i)) return { id: i + 1, kind: 'ja', text: ja[jaIdx.indexOf(i)] };
    if (mixIdx.includes(i)) return { id: i + 1, kind: 'mixed', text: mixed[mixIdx.indexOf(i)] };
    return { id: i + 1, kind: 'plain', text: pick(plain) + pick(tails) };
  });
  const rows = [];
  for (const r of reviews) rows.push([r.id, 'v1', rnd() < 0.35 ? 'Y' : 'N', rnd() < 0.8 ? 'Y' : 'N']);
  for (const r of reviews) rows.push([r.id, 'v2', r.kind === 'ja' ? 'N' : 'Y', r.kind === 'mixed' ? 'N' : 'Y']);
  const failIds = reviews.filter((r) => r.kind === 'ja').map((r) => r.id), wrongIds = reviews.filter((r) => r.kind === 'mixed').map((r) => r.id);
  const refundId = reviews.find((r) => r.text === mixed[0]).id;
  return {
    title: '리뷰 분석 프롬프트 v2 배포 판단',
    scenario: '당신은 리뷰 감정 분류 자동화를 맡은 기획자입니다. 프롬프트를 v1에서 v2로 고친 뒤 리뷰 400건으로 시험했고, 내일 아침까지 v2 배포 여부를 정해야 합니다.\n시험 결과에는 성공·실패 표시만 있고, 리뷰 원문에는 아무 분류가 없습니다. v2가 어떤 리뷰에서 왜 실패하는지는 원문을 읽어야 알 수 있습니다.',
    files: [
      { name: 'prompt_v1.txt', body: `너는 고객 리뷰 분석 전문가야.\n아래 리뷰를 읽고 감정을 분석해줘.\n\n리뷰: {review}` },
      { name: 'prompt_v2.txt', body: `너는 고객 리뷰 분석 전문가야.\n아래 리뷰의 감정을 분류해.\n\n규칙:\n- sentiment는 "긍정", "부정" 중 하나만 쓴다.\n- reason은 리뷰에서 근거가 된 표현을 20자 이내로 인용한다.\n- 다른 설명 없이 아래 JSON만 출력한다.\n\n{"sentiment": "...", "reason": "..."}\n\n예시)\n리뷰: 포장이 찢어진 채로 왔어요.\n출력: {"sentiment": "부정", "reason": "포장이 찢어진 채로"}\n\n리뷰: {review}` },
      { name: 'test_results.csv', body: csv(['case_id', 'prompt_version', 'format_ok', 'label_correct'], rows) },
      { name: 'reviews.csv', body: csv(['case_id', 'review'], reviews.map((r) => [r.id, r.text])) },
    ],
    questions: [
      { type: 'mc', text: 'prompt_v2에서 출력 형식은 지켰지만(format_ok=Y) 라벨이 틀린(label_correct=N) 리뷰들의 공통점은?',
        options: ['모두 일본어로 쓰인 리뷰다', '칭찬과 불만이 한 리뷰에 함께 들어 있다', '모두 환불에 관한 리뷰다', '모두 열 글자 이하의 짧은 리뷰다'], answer: 1,
        why: `결과와 원문을 함께 보내면 2만 토큰을 넘는다. ① test_results.csv에서 v2이고 format_ok=Y, label_correct=N인 case_id ${wrongIds.length}개(${wrongIds.join(', ')})를 뽑고 ② 그 번호를 적어 reviews.csv에서 원문을 읽는다. 모두 "~는 좋았지만 ~는 나빴다"는 혼합 감정 리뷰다. v2는 긍정·부정 둘 중 하나만 고르게 해서 이런 리뷰를 처리하지 못한다.` },
      { type: 'short', text: 'prompt_v2가 출력 형식을 지키지 못한(format_ok=N) 리뷰들은 모두 같은 언어로 쓰였다. 어떤 언어인가?', answers: ['일본어', '일어', 'japanese', '日本語'],
        why: `① test_results.csv에서 v2의 format_ok=N인 case_id(${failIds.join(', ')})를 뽑고 ② reviews.csv에서 원문을 확인하면 모두 일본어다. v2의 규칙과 예시가 한국어만 가정하고 있다.` },
      { type: 'short', text: `1번 문제의 라벨이 틀린 리뷰들 가운데 '환불이 늦어지는 것'을 불만으로 말한 리뷰의 case_id는? (숫자만)`, answers: [String(refundId)],
        why: `라벨이 틀린 ${wrongIds.length}건의 원문을 읽으면 case ${refundId}("상담원은 친절했지만 환불이 3주째 들어오지 않고 있어요")만 환불 지연을 말한다. reviews.csv 전체에서 '환불'을 찾으면 다른 리뷰가 많이 나오므로, 반드시 1번에서 뽑은 번호로 범위를 좁혀야 한다.` },
    ],
  };
}

// ───────────────────────── 상황 3: 사내 규정 챗봇 답변 검증
// 어려운 점: 점수가 높은 청크에 폐기 문서가 섞여 있고, 폐기 문서의 대체 관계가 두 단계로 이어진다.
function bundle3() {
  const depts = ['HR', 'FIN', 'IT', 'SEC', 'OPS', 'LEG'];
  const titles = { HR: ['연차 운영 지침', '채용 절차', '근태 관리 기준', '교육비 지원 안내', '재택근무 운영 기준', '경조사 지원 기준'], FIN: ['출장비 정산 기준', '법인카드 사용 지침', '예산 편성 절차', '구매 품의 기준'], IT: ['계정 발급 절차', '장비 반납 기준', '원격 접속 가이드', '소프트웨어 설치 기준'],
    SEC: ['출입 통제 기준', '문서 반출 절차', '비밀번호 관리 기준'], OPS: ['회의실 예약 안내', '사무용품 신청 절차', '주차 등록 안내'], LEG: ['계약 검토 절차', '인장 사용 기준', '대외 공문 발송 기준'] };
  const sentences = ['신청은 사용일 기준 영업일 3일 전까지 시스템에 등록한다.', '부서장 승인 후 담당 부서가 최종 확인한다.', '증빙 서류는 전자 문서로 첨부하며 원본은 5년간 보관한다.', '기준을 초과하는 경우 사전에 품의를 받아야 한다.', '분기마다 사용 현황을 점검하고 결과를 공지한다.',
    '신규 입사자는 입사 첫 주에 안내 교육을 받는다.', '위반 시 1차 경고 후 재발하면 권한을 회수한다.', '긴급한 경우 사후 승인을 받을 수 있으나 3일 이내에 등록해야 한다.', '외부 반출이 필요한 경우 보안 담당자의 확인을 받는다.', '담당자가 바뀌면 인수인계 내용을 문서로 남긴다.',
    '비용은 건당 한도 내에서 실비로 정산한다.', '예약은 최대 2주 전부터 가능하며 미사용 시 자동 취소된다.', '장비는 퇴사일 전날까지 반납하고 확인서를 받는다.', '계약서는 서명 전에 법무 검토를 거친다.', '재택근무는 주 2회까지 가능하며 전날까지 일정을 공유한다.'];
  const ids = new Set(); const docs = [];
  const add = (id, title, status, updated, replaced = '') => { ids.add(id); docs.push({ id, title, dept: id.split('-')[0], status, updated, replaced }); };
  // 대체 관계가 두 단계: HR-2023-07 → HR-2024-02(이것도 폐기) → HR-2025-03(현행)
  add('HR-2023-07', '연차 운영 지침(구)', '폐기', '2023-07-01', 'HR-2024-02'); add('HR-2024-02', '연차 운영 지침(개정 전)', '폐기', '2024-02-01', 'HR-2025-03'); add('HR-2025-03', '연차 운영 지침', '현행', '2025-03-01');
  add('HR-2024-11', '연차 신청 절차', '현행', '2024-11-15'); add('FIN-2024-02', '출장비 정산 기준', '현행', '2024-02-10'); add('HR-2022-01', '경조 휴가 기준', '현행', '2022-01-05');
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
  const rest = [['FIN-2024-02', 0.61, '출장비 정산은 출장 종료 후 14일 이내에 한다.'], ['HR-2022-01', 0.58, '경조 휴가는 연차와 별도로 부여한다.'], ['HR-2024-02', 0.52, '미사용 연차는 최대 4일까지 다음 해로 이월할 수 있다.']];
  const pool = docs.filter((d) => !top.some((t) => t[0] === d.id) && !rest.some((t) => t[0] === d.id));
  while (top.length + rest.length < 90) rest.push([pick(pool).id, int(30, 74) / 100, filler()]);
  const chunks = [...top, ...rest].sort((a, b) => b[1] - a[1]).map(([doc_id, score, text], i) => ({ chunk: i + 1, doc_id, score, text }));
  const hi = chunks.filter((c) => c.score >= 0.75), hiDocs = [...new Set(hi.map((c) => c.doc_id))];
  const dead = hiDocs.filter((id) => docs.find((d) => d.id === id).status === '폐기');
  if (hi.length !== 9 || dead.length !== 2) throw new Error('상황 3: 상위 청크 구성 불일치');
  return {
    title: '사내 규정 챗봇 답변 검증',
    scenario: '당신은 사내 규정 챗봇의 품질 담당자입니다. 한 직원이 "챗봇이 옛 규정으로 답하는 것 같다"고 신고했습니다.\n챗봇이 검색해 온 청크 90개와 문서 대장 300건을 대조해, 답변 초안을 그대로 내보내도 되는지 판정해야 합니다. 문서 대장에서 폐기된 문서는 replaced_by로 대체 문서를 가리키며, 그 대체 문서가 다시 폐기된 경우도 있습니다.',
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
      { type: 'short', text: 'answer_draft.md의 ①이 인용한 문서에서 대체 관계(replaced_by)를 끝까지 따라가면 나오는 현행 문서의 doc_id는?', answers: ['HR-2025-03', 'HR202503', 'HR 2025 03'],
        why: '①이 인용한 HR-2023-07은 폐기이고 replaced_by가 HR-2024-02다. HR-2024-02도 폐기이며 replaced_by가 HR-2025-03(현행)이다. 한 단계만 따라가면 HR-2024-02에서 멈추게 된다. 현행 규정의 이월 한도는 3일이다.' },
    ],
  };
}

// ───────────────────────── 상황 4: 영어 회의록 3주치 정리
// 어려운 점: 회의록이 전부 영어이고, 세 개를 한 번에 보낼 수 없어 회의별 결과를 직접 이어 붙여야 한다.
function bundle4() {
  const who = ['Minji', 'Sehun', 'Yura', 'Doyun', 'Taeo', 'Jian'];
  const topics = ['weekly active users', 'response latency', 'support ticket volume', 'server cost', 'signup conversion', 'app store rating', 'search success rate', 'payment failure rate', 'onboarding completion', 'push opt-in rate'];
  const causes = ['the release from last week', 'the marketing campaign', 'an error on a specific device model', 'a delay in an external integration', 'a change in usage over the holiday', 'the new placement of the feature entry point'];
  const extra = ['The detailed numbers are on the dashboard if you want to look.', 'We are checking whether other metrics show the same pattern.', 'The same point came up in customer interviews.', 'A competitor reportedly saw a similar shift around the same time.', 'We need to dig into the logs to know the exact reason.', 'Compared with last quarter it is still in a stable range.'];
  // 현황 공유 잡담. 기한·완료·출시일 같은 표현은 넣지 않는다(문제의 단서와 섞이지 않게).
  const filler = () => {
    const [a, b] = shuffle(who);
    return [`${a}: Quick update on ${pick(topics)}. This week the number is ${int(12, 980)}, ${pick(['up', 'down'])} ${int(1, 19)} percent from last week.`,
      `${b}: We think it is mostly ${pick(causes)}. ${pick(extra)}`, `${a}: Got it. ${pick(extra)}`];
  };
  const build = (head, keys, n) => {
    const blocks = Array.from({ length: n }, filler);
    const step = Math.floor(n / (keys.length + 1));
    keys.forEach((k, i) => blocks.splice((i + 1) * step + i, 0, k));
    return head + '\n\n' + blocks.map((b) => b.join('\n')).join('\n');
  };
  const N = 78, people = 'Attendees: Minji (PM), Sehun (Backend), Yura (Design), Doyun (QA), Taeo (Data), Jian (Marketing)';
  const m1 = build(`[2026-06-03 Weekly Product Sync] ${people}`, [
    ['Minji: We are locking the launch date for the chat summary feature. It will be June 20.', 'Jian: OK, I will plan the announcement around that date.'],
    ['Minji: Sehun, please send the response cache design doc by June 9.', 'Sehun: Sure, I will have it written by June 9.'],
    ['Yura: I will upload the draft error messages by June 9.'],
    ['Doyun: I will write the QA checklist by June 9.'],
    ['Minji: Taeo, can you get a first version of the usage dashboard by June 9?', 'Taeo: Yes, I will build a first version by June 9.'],
  ], N);
  const m2 = build(`[2026-06-10 Weekly Product Sync] ${people}`, [
    ['Sehun: The response cache design doc is complete and shared on the wiki.'],
    ['Doyun: The QA checklist is complete as well.'],
    ['Taeo: The usage dashboard is still in progress because the data connection is not ready.'],
    ['Sehun: Summary responses are still slow. Applying the cache for real will take one more week.', 'Minji: Then we are moving the launch to June 27. Sehun, please get the cache applied by June 16.', 'Sehun: OK, by June 16.'],
    ['Jian: I will prepare the launch announcement draft by June 16.'],
  ], N);
  const m3 = build(`[2026-06-17 Weekly Product Sync] ${people}`, [
    ['Yura: The draft error messages are complete and uploaded to the design folder.'],
    ['Sehun: The cache is applied and response time is now within target.'],
    ['Doyun: The security review turned up more items to check. I need until June 24 to get through it.', 'Minji: Understood. We are pushing the launch once more, to July 4. Doyun, please complete the security review by June 24.', 'Doyun: Yes, I will wrap it up by June 24.'],
    ['Doyun: I also need five test accounts.', 'Minji: I will issue the test accounts by June 18.'],
    ['Yura: Are we deciding the pricing today?', 'Minji: Let us revisit pricing next month. No decision today.'],
  ], N);
  return {
    title: '글로벌 제품팀 영어 회의록 정리',
    scenario: '당신은 글로벌 제품팀의 PM 보조입니다. 지난 3주간의 주간 회의는 모두 영어로 진행됐고, 남은 것은 녹취록 세 개뿐입니다.\n내일 본사 보고에 "출시 일정이 어떻게 바뀌어 왔는지"와 "아직 끝나지 않은 업무"를 정리해 올려야 합니다. AI가 써 준 6월 17일 회의 요약이 있지만 믿어도 되는지는 확인되지 않았습니다.',
    files: [
      { name: 'meeting_0603.txt', body: m1 }, { name: 'meeting_0610.txt', body: m2 }, { name: 'meeting_0617.txt', body: m3 },
      { name: 'ai_summary.md', body: `[AI가 작성한 6월 17일 회의 요약]\n## 결정 사항\n- 출시일을 7월 4일로 연기\n- 가격 정책을 인상하기로 결정\n\n## 액션아이템\n- Doyun: 6월 24일까지 보안 점검 완료\n- Minji: 6월 18일까지 테스트 계정 발급` },
    ],
    questions: [
      { type: 'mc', text: 'ai_summary.md의 내용 중 실제 6월 17일 회의(meeting_0617.txt) 내용과 다른 것은?',
        options: ['출시일을 7월 4일로 연기', '가격 정책을 인상하기로 결정', 'Doyun: 6월 24일까지 보안 점검 완료', 'Minji: 6월 18일까지 테스트 계정 발급'], answer: 1,
        why: '회의에서 Minji는 "Let us revisit pricing next month. No decision today."라고 했다. 가격은 결정되지 않았는데 요약이 없던 결정을 만들어냈다.' },
      { type: 'short', text: '세 번의 회의를 통틀어, 처음 확정된 출시일은 이후 몇 번 변경되었는가? (숫자만)', answers: ['2', '2번', '2회'],
        why: '회의록 세 개를 한 번에 보내면 2만 토큰을 넘으므로 나눠서 물어야 한다. 6/3에 June 20으로 확정 → 6/10에 June 27로 변경 → 6/17에 July 4로 변경. 2번이다.' },
      { type: 'short', text: '6월 3일 회의에서 기한과 함께 정해진 업무 중, 6월 17일 회의까지 완료 보고가 한 번도 없는 업무의 담당자 이름은? (회의록에 나온 영문 이름)', answers: ['Taeo', '태오'],
        why: '6/3에 기한(June 9)과 함께 정해진 업무는 Sehun(cache design doc), Yura(draft error messages), Doyun(QA checklist), Taeo(usage dashboard) 4개다. 6/10에 Sehun과 Doyun이, 6/17에 Yura가 완료를 보고했다. Taeo는 6/10에 "still in progress"라고만 했다. 6/3의 업무 목록을 적어 두고 나머지 회의록에 차례로 물어야 한다.' },
    ],
  };
}

// ───────────────────────── 상황 5: 외부 AI 사용 로그 감사
// 어려운 점: 위반 표시가 없는 프롬프트 원문을 정책에 비춰 판단해야 하고, 겉보기에 비슷한 정상·위반 사례가 섞여 있다.
function bundle5() {
  const depts = ['개발', '개발', '개발', '마케팅', '마케팅', 'CS', 'CS', 'CS', '재무', '인사', '영업', '영업'];
  const N_EMP = 400, N_REQ = 300;
  const legalIdx = new Set(shuffle([...Array(N_EMP).keys()]).slice(0, 4));
  const emps = [...Array(N_EMP).keys()].map((i) => ({ id: `E-${3001 + i}`, name: person(), dept: legalIdx.has(i) ? '법무' : pick(depts), title: pick(['사원', '사원', '대리', '과장', '차장']), office: pick(['본사 3층', '본사 5층', '본사 7층', '판교 2층', '부산 지사']), joined: `${int(2015, 2025)}-${String(int(1, 12)).padStart(2, '0')}` }));
  const legal = emps.filter((e) => e.dept === '법무').map((e) => e.id), nonLegal = emps.filter((e) => e.dept !== '법무').map((e) => e.id);
  const OK = ['지난주에 배포한 보도자료를 세 줄로 요약해줘', '공개 채용 공고 문구를 더 자연스럽게 고쳐줘', '엑셀에서 두 시트를 비교하는 함수를 알려줘', '상담 내역을 요약해줘: 고객 홍*동(010-****-5678)이 배송 지연을 문의함',
    '설정 파일 오류를 봐줘: DB_PASSWORD=${VAULT_DB_PASSWORD} 로 되어 있는데 접속이 안 됨', '회의 아이스브레이킹 질문을 다섯 개 만들어줘', '공개된 제품 설명서 문장을 영어로 번역해줘', '파이썬에서 리스트를 정렬하는 방법을 알려줘'];
  const BAD = ['상담 내역을 분류해줘: 고객 김민서(010-2345-6789)가 환불을 요청함', '설정 파일 오류를 봐줘: DB_PASSWORD=Qz7mLp2xR9 로 되어 있는데 접속이 안 됨', '아직 발표 전인 3분기 영업이익 412억 원이 들어간 문장을 다듬어줘', '지원자 박서준(seojun.park@example.com)의 이력서를 요약해줘',
    '미공개 인수 검토 자료에서 매수가 1200억 원의 근거를 요약해줘', '고객 이메일 목록을 정리해줘: jiwoo.kim@example.com / haeun.lee@example.com'];
  const mk = (employee_id, prompt, bad, tag) => ({ employee_id, prompt, bad, date: date(int(5, 6), int(1, 28)), tag });
  const r = [];
  // 법무 직원 요청 7건 중 위반 3건. 정상 4건에는 마스킹된 개인정보와 자리표시 비밀번호(함정)가 들어 있다.
  [BAD[4], BAD[0], BAD[1]].forEach((p) => r.push(mk(pick(legal), p, true)));
  [OK[0], OK[3], OK[4], OK[5]].forEach((p) => r.push(mk(pick(legal), p, false)));
  // 객관식 4건(법무 외): 위반 3 + 정상 1(비밀번호 자리에 변수만 있는 설정 파일)
  r.push(mk(pick(nonLegal), BAD[1], true, 'mc'), mk(pick(nonLegal), BAD[3], true, 'mc'), mk(pick(nonLegal), OK[4], false, 'mcOk'), mk(pick(nonLegal), BAD[2], true, 'mc'));
  while (r.length < N_REQ) { const bad = rnd() < 0.3; r.push(mk(pick(nonLegal), pick(bad ? BAD : OK), bad)); }
  const reqs = shuffle(r).map((x, i) => ({ id: `R-${5001 + i}`, ...x }));
  const mc = reqs.filter((x) => x.tag?.startsWith('mc')).map((x) => x.id).sort(), mcOk = reqs.find((x) => x.tag === 'mcOk').id;
  const legalReqs = reqs.filter((x) => legal.includes(x.employee_id)), legalBad = legalReqs.filter((x) => x.bad);
  if (legalReqs.length !== 7 || legalBad.length !== 3) throw new Error('상황 5: 법무 요청 구성 불일치');
  return {
    title: '외부 AI 사용 로그 감사',
    scenario: '당신은 정보보안팀 담당자입니다. 지난 두 달간 직원들이 외부 AI에 입력한 프롬프트 300건의 로그를 받았습니다.\n내일 감사에서 법무 부서의 정책 위반 건수를 보고해야 합니다. 로그에는 직원 번호와 프롬프트 원문만 있고 위반 여부 표시는 없습니다. 부서는 직원 명부에서 찾아야 하고, 위반인지는 사용 정책에 비춰 직접 판단해야 합니다.',
    files: [
      { name: 'ai_usage_policy.pdf', kind: 'pdf', url: 'files/ai_usage_policy.pdf', preview: 'files/ai_usage_policy.preview.png' },
      { name: 'ai_requests.csv', body: csv(['req_id', 'date', 'employee_id', 'prompt'], reqs.map((x) => [x.id, x.date, x.employee_id, x.prompt])) },
      { name: 'employees.csv', body: csv(['employee_id', 'name', 'dept', 'title', 'office', 'joined'], emps.map((e) => [e.id, e.name, e.dept, e.title, e.office, e.joined])) },
      { name: 'customer_table.png', kind: 'image', url: 'files/customer_table.png' },
    ],
    questions: [
      { type: 'mc', text: 'ai_requests.csv의 다음 요청 중 사용 정책(ai_usage_policy.pdf)을 위반하지 않는 것은?', options: mc, answer: mc.indexOf(mcOk),
        why: `${mcOk}는 비밀번호 자리에 실제 값이 아니라 변수 이름(\${VAULT_DB_PASSWORD})만 들어 있어 제2조 위반이 아니다. 나머지는 실제 비밀번호(제2조), 마스킹하지 않은 지원자 개인정보(제1조), 발표 전 실적(제2조)을 입력했다. 겉모습이 비슷한 설정 파일 요청이라도 실제 값이 들어 있는지 봐야 한다.` },
      { type: 'short', text: '동료가 고객 표를 캡처한 customer_table.png를 보냈다. 이 표를 외부 AI에 넣기 전에 정책상 마스킹해야 하는 컬럼은 몇 개인가? (숫자만)', answers: ['3', '3개'],
        why: 'name, phone, email 3개가 제1조의 개인정보에 해당한다. customer_id, plan, monthly_fee, signup_date는 해당하지 않는다. 정책 PDF와 이미지를 함께 멘션하면 AI가 둘 다 읽는다.' },
      { type: 'short', text: `'법무' 부서 직원이 보낸 요청 중 사용 정책을 위반한 것은 몇 건인가? (숫자만)`, answers: ['3', '3건', '3개'],
        why: `명부와 로그를 함께 보내면 2만 토큰을 넘는다. ① employees.csv에서 법무 직원 employee_id 4개(${legal.join(', ')})를 뽑고 ② 그 목록을 적어 ai_requests.csv에서 이들의 요청 7건을 찾은 뒤 ③ 정책과 대조한다. 위반은 ${legalBad.map((x) => x.id).sort().join(', ')}로 3건. 마스킹된 개인정보(홍*동)와 변수만 적힌 비밀번호는 위반이 아니다.` },
    ],
  };
}

const b1 = bundle1();
const BUNDLES = [b1.bundle, bundle2(), bundle3(), bundle4(), bundle5()];

// 엑셀 원본을 data.js의 표 내용과 같은 값으로 만든다
const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('tickets');
b1.sheet.split('\n').forEach((l, i) => ws.addRow(l.split(',').map((v) => (i && /^\d+$/.test(v) ? +v : v))));
ws.getRow(1).font = { bold: true }; ws.columns.forEach((c, i) => (c.width = i === 2 ? 60 : 18));
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

const head = `// 문제 데이터. 현업 상황 5개 × (객관식 1 + 단답형 2). scenario는 문제 위에 보여주는 상황 설명.
// 이 파일은 tools/gen-data.mjs 가 만든다. 직접 고치지 말고 생성기를 고친 뒤 \`node tools/gen-data.mjs && node check.mjs\`.
// 첨부파일 종류(kind): 없음=글자 파일(body), 'sheet'=엑셀(body는 AI·미리보기용 표 내용),
//   'pdf'·'image'=원본을 그대로 AI에 전달(pdf는 preview 이미지로 화면 표시). 원본은 files/ 폴더.
// tokens = 그 파일을 AI에 첨부할 때 드는 토큰 수(생성기가 API로 잰 값).
// 단답형 answers는 허용 표기 목록(공백·대소문자는 채점 때 무시).
`;
fs.writeFileSync(new URL('data.js', ROOT), head + 'const BUNDLES = ' + JSON.stringify(BUNDLES, null, 1) + ';\n');
for (const B of BUNDLES) console.log(B.title, '|', B.files.map((f) => `${f.name} ${f.tokens}토큰`).join(', '));
