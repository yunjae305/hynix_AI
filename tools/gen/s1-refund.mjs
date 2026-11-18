// 상황 1: 글로벌 쇼핑몰 VIP 고객 문의 (다국어 원문 + 환불 정책 + 표 세 개)
// 정보 분리: VIP 여부(구매액)는 customers.csv에만, 요청 의도(원문)는 cs_tickets.xlsx에만, 날짜·금액·개봉은 orders.csv에만 있다.
import { makeRng, csv, need, ymd, won, wonAnswers, idAnswers, assertNoCrossLeak, josa } from './common.mjs';

const SUR = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권'];
const GIV = ['민준', '서연', '도윤', '지우', '하준', '서윤', '시우', '하은', '주원', '지호', '예준', '수아', '유준', '지민', '건우', '채원', '현우', '다은', '준서', '소율'];
// 의도별 원문. 의도가 둘로 읽히는 문장(예: 불량인데 교환 요청)은 넣지 않는다.
const MSG = {
  change: { ko: ['생각했던 것과 달라서 돈으로 돌려받고 싶어요', '마음이 바뀌어서 결제를 취소하고 환불받고 싶습니다', '필요가 없어져서 반품하고 환불을 원합니다'], en: ['I changed my mind and would like my money back', 'It is not what I expected so please refund my order'], ja: ['イメージと違ったので返金をお願いします', '不要になったので返品して返金してほしいです'] },
  defect: { ko: ['받자마자 전원이 안 켜집니다 환불해 주세요', '상자를 열어 보니 깨져 있었습니다 환불 부탁드립니다'], en: ['The item arrived broken and I want a full refund', 'It stopped working on the first day so please refund me'], ja: ['届いた商品が壊れていたので返金してください', '電源が入らない不良品なので返金をお願いします'] },
  exchange: { ko: ['사이즈가 안 맞아서 한 치수 큰 것으로 바꾸고 싶어요', '색상을 다른 것으로 교환하고 싶습니다'], en: ['Can I swap this for the same item in a different color', 'Please exchange it for a larger size'], ja: ['サイズが合わないので交換をお願いします', '別の色に交換してもらえますか'] },
  delivery: { ko: ['주문한 지 일주일인데 아직 안 왔어요 언제 오나요'], en: ['Where is my package it has been ten days already'], ja: ['注文した商品はいつ届きますか'] },
  payment: { ko: ['카드가 두 번 결제된 것 같아요 확인 부탁드려요'], en: ['I was charged twice for one order please check'], ja: ['二重に請求されているようです確認してください'] },
  usage: { ko: ['설명서대로 해도 연결이 안 되는데 방법을 알려 주세요'], en: ['How do I reset the device to factory settings'], ja: ['初期設定の方法を教えてください'] },
};
const FEE = 6000, VIP_MIN = 5000000;

export function build({ nCust = 340, nTicket = 300 } = {}) {
  const R = makeRng(20261111);
  const person = () => R.pick(SUR) + R.pick(GIV);
  const idx = R.shuffle([...Array(nCust).keys()]);
  const vipSet = new Set(idx.slice(0, 10)), nearSet = new Set(idx.slice(10, 13));
  const nearSpend = [4950000, 4980000, 4990000];
  const customers = [...Array(nCust).keys()].map((i) => ({
    id: `C-${1001 + i}`, name: person(), region: R.pick(['서울', '경기', '부산', '도쿄', '오사카', '뉴욕', '런던', '시드니']), signup: `${R.int(2019, 2025)}-${String(R.int(1, 12)).padStart(2, '0')}-${String(R.int(1, 28)).padStart(2, '0')}`,
    spend: vipSet.has(i) ? R.int(500, 980) * 10000 : nearSet.has(i) ? nearSpend[[...nearSet].indexOf(i)] : R.int(10, 300) * 10000, orders: R.int(1, 40),
  }));
  const vips = customers.filter((c) => c.spend >= VIP_MIN).map((c) => c.id);
  const near = customers.filter((c) => c.spend >= 4900000 && c.spend < VIP_MIN).map((c) => c.id);
  const others = customers.filter((c) => c.spend < 4900000).map((c) => c.id);
  need(vips.length === 10 && near.length === 3, '상황 1: VIP 10명·경계 고객 3명');

  // 티켓 하나 = 주문 하나. lag = 배송 완료일부터 문의일까지 일수, ship = 주문일부터 배송 완료일까지 일수
  const T = [];
  const add = (cid, intent, lang, o = {}) => T.push({ cid, intent, lang, msg: o.msg ?? R.pick(MSG[intent][lang]), amount: o.amount ?? R.int(2, 30) * 10000 + R.pick([0, 5000, 9000]), lag: o.lag ?? R.int(1, 45), ship: o.ship ?? R.int(2, 6), opened: o.opened ?? R.pick(['Y', 'N', 'N']), tag: o.tag });
  const v = R.shuffle(vips);
  // 단답 2: VIP 단순 변심 6건. 가능 3건(그중 하나는 주문일 기준 30일 초과지만 배송 완료일 기준 26일), 불가 3건(개봉 / 34일 / 31일)
  add(v[0], 'change', 'ko', { amount: 89000, lag: 5, opened: 'N', tag: 'chOk' });
  add(v[1], 'change', 'en', { amount: 152000, lag: 22, opened: 'N', tag: 'chOk' });
  add(v[2], 'change', 'ja', { amount: 137000, lag: 26, ship: 12, opened: 'N', tag: 'chOk' });
  add(v[3], 'change', 'ko', { amount: 240000, lag: 12, opened: 'Y', tag: 'chNo' });
  add(v[4], 'change', 'ja', { amount: 64000, lag: 34, opened: 'N', tag: 'chNo' });
  add(v[5], 'change', 'en', { amount: 99000, lag: 31, opened: 'N', tag: 'chNo' });
  // 단답 1: VIP 불량 환불 4건 중 일본어는 1건. 일본어 불량 환불은 VIP 아닌 고객에게도 6건(미끼)
  add(v[6], 'defect', 'ja', { tag: 'defJa' });
  add(v[7], 'defect', 'ko', { tag: 'defVip' }); add(v[8], 'defect', 'en', { tag: 'defVip' }); add(v[9], 'defect', 'ko', { tag: 'defVip' });
  for (let i = 0; i < 6; i++) add(R.pick(others), 'defect', 'ja', { tag: 'defJaOther' });
  // 객관식(2×2): VIP·교환 / VIP·배송 문의 / 경계 고객·교환 / 일반 고객·결제 문의
  add(v[1], 'exchange', 'en', { tag: 'mcA' }); add(v[3], 'delivery', 'ja', { tag: 'mcB' });
  add(near[0], 'exchange', 'ko', { tag: 'mcC' }); add(R.pick(others), 'payment', 'ko', { tag: 'mcD' });
  // 경계 고객의 변심 환불(VIP로 잘못 세기 쉬움)
  near.forEach((c) => add(c, 'change', 'ko', { amount: 110000, lag: 8, opened: 'N' }));
  while (T.length < nTicket) add(R.pick(others), R.pick(['change', 'change', 'defect', 'exchange', 'delivery', 'delivery', 'payment', 'usage']), R.pick(['ko', 'ko', 'en', 'ja']));

  const tickets = R.shuffle(T).map((x, i) => {
    const claim = new Date(Date.UTC(2026, 5, 1) + R.int(0, 25) * 864e5); // 문의일 6/1~6/26
    const delivered = new Date(claim - x.lag * 864e5), ordered = new Date(delivered - x.ship * 864e5);
    const iso = (d) => d.toISOString().slice(0, 10);
    return { ...x, id: `T-${2001 + i}`, order: `O-${70101 + i * 7}`, claim: iso(claim), delivered: iso(delivered), ordered: iso(ordered) };
  });
  const by = (tag) => tickets.filter((x) => x.tag === tag);
  const isVip = (cid) => vips.includes(cid);

  // 정답을 데이터에서 다시 계산해 설계와 대조한다
  const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  const vipChange = tickets.filter((x) => isVip(x.cid) && x.intent === 'change');
  const okChange = vipChange.filter((x) => daysBetween(x.delivered, x.claim) <= 30 && x.opened === 'N');
  const sum = okChange.reduce((s, x) => s + x.amount - FEE, 0);
  need(vipChange.length === 6 && okChange.length === 3 && okChange.every((x) => x.tag === 'chOk'), '상황 1: VIP 변심 6건 중 가능 3건');
  need(sum === (89000 + 152000 + 137000 - 3 * FEE), '상황 1: 환불액 합계 재계산');
  need(okChange.some((x) => daysBetween(x.ordered, x.claim) > 30), '상황 1: 주문일 기준이면 놓치는 건이 있어야 한다');
  const vipDefJa = tickets.filter((x) => isVip(x.cid) && x.intent === 'defect' && x.lang === 'ja');
  const allDefJa = tickets.filter((x) => x.intent === 'defect' && x.lang === 'ja');
  need(vipDefJa.length === 1 && allDefJa.length >= 5, '상황 1: VIP 일본어 불량 환불은 1건, 전체 일본어 불량 환불은 5건 이상');
  const vipDef = tickets.filter((x) => isVip(x.cid) && x.intent === 'defect');
  need(vipDef.length >= 4, '상황 1: VIP 불량 환불 후보 4건 이상');
  const mcRows = ['mcA', 'mcB', 'mcC', 'mcD'].map((t) => by(t)[0]);
  const mcTruth = mcRows.map((x) => isVip(x.cid) && x.intent === 'exchange');
  need(mcTruth.filter(Boolean).length === 1 && mcTruth[0], '상황 1: 객관식 정답은 하나');
  need(mcRows.filter((x) => isVip(x.cid)).length === 2 && mcRows.filter((x) => x.intent === 'exchange').length === 2, '상황 1: 객관식 2×2');
  // 한 파일만 볼 때 후보 수: orders.csv만으로는 의도를 모르고, VIP 변심 후보 금액 조합은 수없이 많다
  need(tickets.filter((x) => x.intent === 'change').length >= 20, '상황 1: 변심 환불 후보가 많아야 한다');

  const ticketCsv = csv(['ticket_id', 'customer_id', 'order_id', 'message'], tickets.map((x) => [x.id, x.cid, x.order, x.msg]));
  const orderRows = [...tickets].sort((a, b) => a.order.localeCompare(b.order)).map((x) => [x.order, x.cid, x.ordered, x.delivered, x.claim, x.amount, x.opened]);
  const policy = `# 환불 정책 (v5)\n1. VIP 고객: customers.csv의 최근 12개월 구매액(total_spend_12m)이 5,000,000원 이상인 고객.\n2. 단순 변심 환불: 배송 완료일(delivered_date)부터 문의일(claim_date)까지 14일 이내(VIP는 30일 이내)이고 미개봉(opened=N)인 경우에만 가능하다. 환불액 = 주문 금액(order_amount) - 왕복 배송비 6,000원.\n3. 제품 불량 환불: 배송 완료일부터 30일 이내이면 개봉 여부와 무관하게 주문 금액 전액을 환불한다.\n4. 교환 요청, 배송 문의, 결제 오류 문의, 사용법 문의는 환불 요청이 아니다.`;
  const mcList = R.shuffle(mcRows);
  const aiList = `[AI가 정리한 'VIP 고객 교환 요청' 목록]\n${mcList.map((x, i) => `${i + 1}. ${x.id} (고객 ${x.cid}) - 교환 요청`).join('\n')}`;
  const options = mcList.map((x) => x.id);
  const answerIdx = mcList.findIndex((x) => x.tag === 'mcA');
  const defJa = vipDefJa[0];

  const files = [
    { name: 'cs_tickets.xlsx', kind: 'sheet', url: 'files/cs_tickets.xlsx', body: ticketCsv },
    { name: 'customers.csv', body: csv(['customer_id', 'name', 'region', 'signup_date', 'total_spend_12m', 'orders_12m'], customers.map((c) => [c.id, c.name, c.region, c.signup, c.spend, c.orders])) },
    { name: 'orders.csv', body: csv(['order_id', 'customer_id', 'order_date', 'delivered_date', 'claim_date', 'order_amount', 'opened'], orderRows) },
    { name: 'refund_policy.md', body: policy },
    { name: 'ai_vip_list.md', body: aiList },
  ];
  const sumText = okChange.map((x) => `${won(x.amount)} - 6,000 = ${won(x.amount - FEE)}`).join(', ');
  const questions = [
    { type: 'mc', text: 'ai_vip_list.md는 AI가 \'VIP 고객의 교환 요청\'이라며 뽑은 티켓 4건이다. 이 가운데 실제로 VIP 고객(환불 정책 기준)이 보낸 교환 요청인 티켓은?', options, answer: answerIdx,
      why: `customers.csv와 cs_tickets.xlsx를 함께 보내면 1만 3천 토큰을 넘는다. ① customers.csv에서 total_spend_12m이 500만 원 이상인 VIP 10명을 뽑는다: ${vips.join(', ')}. 구매액이 495만~499만 원인 경계 고객 ${josa(near.join(', '), '은/는')} VIP가 아니다. ② 그 목록을 옮겨 적고 cs_tickets.xlsx와 ai_vip_list.md를 함께 보내 4건의 원문을 확인한다. ${mcRows[0].id}만 VIP의 교환 요청이다. ${josa(mcRows[1].id, '은/는')} VIP지만 일본어로 쓴 배송 문의이고, ${josa(mcRows[2].id, '은/는')} 교환 요청이지만 경계 고객이 보냈으며, ${josa(mcRows[3].id, '은/는')} 일반 고객의 결제 문의다.` },
    { type: 'short', text: 'VIP 고객(환불 정책 기준)이 보낸 \'제품 불량 환불\' 요청 가운데 일본어로 쓰인 티켓의 ticket_id는? (T-0000 형식)', answers: idAnswers(defJa.id),
      why: `customers.csv와 cs_tickets.xlsx를 함께 보내면 1만 3천 토큰을 넘는다. ① customers.csv에서 VIP 10명의 customer_id를 뽑고 ② 그 목록을 옮겨 적어 cs_tickets.xlsx에서 VIP의 불량 환불 요청 ${vipDef.length}건을 찾는다: ${vipDef.map((x) => `${x.id}(${{ ja: '일본어', ko: '한국어', en: '영어' }[x.lang]})`).join(', ')}. 일본어는 ${defJa.id} 하나다(원문: "${defJa.msg}"). 일본어 불량 환불은 VIP가 아닌 고객에게도 ${allDefJa.length - 1}건 있어 티켓 파일만으로는 고를 수 없다.` },
    { type: 'short', text: 'VIP 고객(환불 정책 기준)이 보낸 \'단순 변심 환불\' 요청 가운데 환불 정책상 환불이 가능한 건들의 환불액 합계는 얼마인가? (원 단위 숫자)', answers: wonAnswers(sum),
      why: `세 파일(customers.csv, cs_tickets.xlsx, orders.csv) 중 어느 두 개도 함께 보낼 수 없다. ① customers.csv에서 VIP 10명을 뽑는다. ② 그 목록으로 cs_tickets.xlsx에서 VIP의 단순 변심 환불 6건의 order_id를 뽑는다: ${vipChange.map((x) => x.order).join(', ')}. ③ orders.csv와 refund_policy.md에 그 order_id를 보내 배송 완료일부터 문의일까지 일수와 개봉 여부를 본다. 가능: ${okChange.map((x) => `${x.order}(${daysBetween(x.delivered, x.claim)}일)`).join(', ')}. ${josa(okChange.find((x) => daysBetween(x.ordered, x.claim) > 30).order, '은/는')} 주문일부터는 30일이 넘지만 정책은 배송 완료일 기준이다. 불가: ${vipChange.filter((x) => !okChange.includes(x)).map((x) => `${x.order}(${x.opened === 'Y' ? '개봉' : daysBetween(x.delivered, x.claim) + '일'})`).join(', ')}. 환불액은 ${sumText}이고, 합계는 ${won(sum)}원이다.` },
  ];

  const vipAsk = 'customers.csv에서 total_spend_12m이 5000000 이상인 고객의 customer_id를 모두 쉼표로만 나열해 줘.';
  const plan = [
    { needs: [['customers.csv'], ['cs_tickets.xlsx']], pattern: 'T-\\d{4}',
      path: [{ files: ['customers.csv'], ask: vipAsk, carry: vips }, { files: ['cs_tickets.xlsx', 'ai_vip_list.md'], ask: 'VIP 고객 customer_id: {{prev}}\n\n{{question}}' }],
      bypass: [{ files: ['cs_tickets.xlsx', 'ai_vip_list.md', 'refund_policy.md'], text: 'ai_vip_list.md의 4건 원문을 cs_tickets.xlsx에서 찾아 각각 실제로 교환 요청인지 알려 줘. 그리고 그중 VIP 고객이 보냈을 것 같은 티켓 하나를 골라 줘.' },
        { files: ['customers.csv', 'ai_vip_list.md', 'refund_policy.md'], text: 'ai_vip_list.md의 4건 가운데 고객이 VIP(정책 기준)인 티켓은? 그중 교환 요청일 것 같은 하나를 골라 줘.' }] },
    { needs: [['customers.csv'], ['cs_tickets.xlsx']], pattern: 'T-\\d{4}',
      path: [{ files: ['customers.csv'], ask: vipAsk, carry: vips }, { files: ['cs_tickets.xlsx', 'refund_policy.md'], ask: 'VIP 고객 customer_id: {{prev}}\n\n{{question}}' }],
      bypass: [{ files: ['cs_tickets.xlsx', 'refund_policy.md'], text: '일본어로 쓰인 제품 불량 환불 요청 티켓을 모두 찾아 ticket_id와 customer_id를 알려 줘.' }] },
    { needs: [['customers.csv'], ['cs_tickets.xlsx'], ['orders.csv']], pattern: '\\d{1,3}(,\\d{3})+|\\d{5,}',
      path: [{ files: ['customers.csv'], ask: vipAsk, carry: vips },
        { files: ['cs_tickets.xlsx', 'refund_policy.md'], ask: 'VIP 고객 customer_id: {{prev}}\n이 고객들이 보낸 티켓 가운데 \'단순 변심 환불\' 요청인 것의 order_id를 모두 쉼표로만 나열해 줘. (제품 불량 환불·교환·배송·결제·사용법 문의는 빼고)', carry: vipChange.map((x) => x.order) },
        { files: ['orders.csv', 'refund_policy.md'], ask: 'VIP 고객이 보낸 단순 변심 환불 요청의 order_id: {{prev}}\n\n{{question}}' }],
      bypass: [{ files: ['orders.csv', 'refund_policy.md'], text: 'orders.csv에서 VIP 기준(배송 완료 후 30일 이내, 미개봉)으로 단순 변심 환불이 가능한 주문의 환불액 합계를 계산해 줘.' },
        { files: ['cs_tickets.xlsx', 'refund_policy.md', 'ai_vip_list.md'], text: 'VIP 고객이 보낸 단순 변심 환불 요청 중 환불 가능한 건의 환불액 합계를 추정해 줘.' }] },
  ];
  plan.forEach((p, i) => { p.id = `1-${i + 1}`; });
  assertNoCrossLeak('상황 1', plan, (i) => (questions[i].type === 'mc' ? [questions[i].options[questions[i].answer]] : questions[i].answers));

  return {
    sheet: ticketCsv,
    bundle: {
      title: '글로벌 쇼핑몰 VIP 고객 문의',
      scenario: '당신은 해외 직구 쇼핑몰의 CS 운영 담당자입니다. 오늘 오후 임원 회의에 "VIP 고객 문의·환불 현황"을 보고해야 합니다.\n고객 문의 원문은 한국어·영어·일본어로 섞여 있고 분류 값이 없습니다. 고객 정보, 문의 티켓, 주문 기록은 서로 다른 파일로 관리되며, VIP 여부와 환불 가능 여부는 환불 정책에 따라 판단합니다.',
      files, questions,
    },
    plan,
  };
}
