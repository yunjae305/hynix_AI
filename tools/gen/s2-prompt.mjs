// 상황 2: 리뷰 분석 프롬프트 v2 배포 판단
// 정보 분리: 채점 결과는 test_results.csv에만, 리뷰 원문(언어·내용)은 reviews.csv에만, 상품 코드는 review_meta.csv에만 있다.
import { makeRng, csv, need, idAnswers, numAnswers, assertNoCrossLeak, josa } from './common.mjs';

// 한 가지 감정만 분명한 한국어 리뷰. 아쉬움을 덧붙이는 꼬리말은 쓰지 않는다(혼합 감정처럼 보이지 않게).
const POS = ['주문한 지 이틀 만에 도착해서 놀랐어요 포장도 꼼꼼했습니다', '기사님이 문 앞에 조심히 두고 가셔서 좋았습니다', '마감이 깔끔하고 사진과 색이 똑같아요 만족합니다', '이 가격에 이 구성이면 정말 잘 산 것 같아요',
  '환불 신청하고 사흘 만에 입금돼서 편했어요', '환불 규정 안내가 친절해서 헷갈리지 않았습니다', '상담원이 끝까지 친절하게 설명해 주셨어요', '두 달째 매일 쓰는데 고장 없이 잘 됩니다', '선물했는데 받는 사람이 아주 좋아했어요', '설명서가 자세해서 금방 조립했어요'];
const NEG = ['배송 예정일보다 나흘이나 늦게 와서 선물 날짜를 놓쳤어요', '배송 조회가 계속 멈춰 있어서 불안했습니다', '두 번 썼는데 손잡이가 벌써 헐거워졌어요', '세탁 한 번에 보풀이 잔뜩 일어나서 실망했습니다', '할인 끝나자마자 가격이 더 내려가서 속상하네요',
  '반품 택배를 직접 불러야 해서 번거로웠어요', '문의 답변이 복사해 붙인 것 같아서 도움이 안 됐어요', '전화 연결까지 이십 분을 기다렸습니다', '사진과 색이 달라서 실망했어요', '포장이 뜯긴 채로 와서 기분이 나빴습니다'];
const POS_TAIL = ['', ' 재구매 의사 있습니다', ' 주변에도 추천했어요'];
const NEG_TAIL = ['', ' 다시는 안 살 것 같아요', ' 다른 분들은 참고하세요'];
// 환불 지연 불만(한 가지 감정). 혼합 감정 리뷰 밖에 두는 미끼
const REFUND_LATE = ['환불 신청한 지 열흘이 지났는데 아직 입금이 안 됐어요', '반품은 진작 보냈는데 환불이 2주째 감감무소식이에요', '환불 처리가 너무 늦어서 카드값이 먼저 나갔어요', '환불 요청하고 한 달 가까이 기다리는 중입니다',
  '환불이 언제 되는지 아무도 안 알려 줘서 답답해요', '반품 확인 문자만 오고 환불은 아직이에요', '환불이 계속 늦어져서 다시는 안 살 것 같아요'];
// 칭찬과 불만이 함께 있는 리뷰. 환불 이야기는 첫 문장(정답) 하나에만 있다.
const MIXED = ['상담원은 친절했지만 환불이 3주째 들어오지 않고 있어요', '배송은 정말 빨랐는데 제품 마감이 엉망이에요', '디자인은 마음에 드는데 가격이 너무 비싸요', '품질은 좋은데 배송이 열흘이나 걸렸어요', '가격은 저렴했지만 상담 연결이 너무 어려웠어요',
  '포장은 꼼꼼했는데 색이 사진과 전혀 달라요', '기능은 만족하지만 설명서가 너무 불친절해요', '사은품은 좋았는데 본품 크기가 생각보다 작아요', '교환은 빨리 해 주셨지만 새 제품도 흠집이 있었어요', '소리는 정말 좋은데 배터리가 반나절도 못 가요',
  '맛은 훌륭했지만 양이 너무 적었어요', '착용감은 편한데 한 번 빨았더니 늘어났어요', '화면은 선명한데 발열이 심해요', '조립은 쉬웠지만 나사 하나가 빠져 있었어요'];
// 일본어 리뷰(한 가지 감정)
// 칭찬과 환불 지연이 함께 있는 미끼(단답 1의 집합 밖: v2가 형식을 못 지킨 리뷰)
const PRAISE_LATE = ['포장은 꼼꼼했는데 환불은 2주째 처리가 안 되고 있어요', '배송은 빨랐지만 환불이 한 달째 감감무소식이에요', '対応は丁寧でしたが返金がまだ届きません', '配送は早かったのに返金が三週間たっても入金されません'];
const JA_POS = ['二日で届いて梱包も丁寧でした', 'この値段でこの品質なら大満足です', 'スタッフの対応が親切で助かりました', '色も写真どおりでとても気に入りました', '説明書が分かりやすくてすぐ使えました', '毎日使っていますが故障もなく快適です',
  '友達へのプレゼントにしたらとても喜ばれました', '音がクリアで大満足です', 'サイズがぴったりで着心地もいいです', '組み立てが簡単で助かりました', '発送が早くて驚きました', '素材がしっかりしていて長く使えそうです', 'デザインがおしゃれで部屋に合います'];
const JA_NEG = ['一週間でファスナーが壊れてしまい残念です', '問い合わせの返事がとても遅かったです', '写真と色が全然違ってがっかりしました', '届いた箱がつぶれていました', '一度洗っただけで縮んでしまいました', '説明書が分かりにくくて困りました',
  '電池がすぐ切れてしまいます', '配送が予定より五日も遅れました', 'サイズが小さすぎて使えませんでした', '値段の割に作りが雑です', '返金を申請して三週間たちますがまだ入金されません', '返品したのに返金の連絡が一向にありません'];

export function build({ n = 420, metaCols = true } = {}) {
  const R = makeRng(20261112);
  const ja = [...JA_POS.map((t) => ({ t, s: 'pos' })), ...JA_NEG.map((t) => ({ t, s: 'neg' }))];
  const idx = R.shuffle([...Array(n).keys()]);
  let k = 0;
  const take = (m) => idx.slice(k, (k += m));
  const jaIdx = take(ja.length), mixIdx = take(MIXED.length), lateIdx = take(REFUND_LATE.length);
  const reviews = [...Array(n).keys()].map((i) => {
    if (jaIdx.includes(i)) { const j = ja[jaIdx.indexOf(i)]; return { id: i + 1, kind: 'ja', sent: j.s, text: j.t }; }
    if (mixIdx.includes(i)) { const m = mixIdx.indexOf(i); return { id: i + 1, kind: 'mixed', sent: 'mixed', text: MIXED[m], refund: m === 0 }; }
    if (lateIdx.includes(i)) return { id: i + 1, kind: 'plain', sent: 'neg', text: REFUND_LATE[lateIdx.indexOf(i)], late: true };
    const pos = R.rnd() < 0.55;
    return { id: i + 1, kind: 'plain', sent: pos ? 'pos' : 'neg', text: pos ? R.pick(POS) + R.pick(POS_TAIL) : R.pick(NEG) + R.pick(NEG_TAIL) };
  });
  let jaRev = reviews.filter((r) => r.kind === 'ja'); const mixRev = reviews.filter((r) => r.kind === 'mixed');
  const refundCase = mixRev.find((r) => r.refund);
  // v1: 일본어는 한 건(단답 2의 정답)만 라벨이 맞고 나머지는 틀린다. 정답 리뷰가 '환불 지연' 미끼가 아니게 긍정 리뷰에서 고른다.
  const jaTarget = R.pick(jaRev.filter((r) => r.sent === 'pos'));
  const mixV1 = new Map(R.shuffle(mixRev).map((r, i) => [r.id, i < 8 ? 'Y' : 'N']));
  mixV1.set(refundCase.id, 'N'); // 단답 1의 정답이 단답 2의 중간 결과(회귀 목록)에 나오지 않게
  const res = new Map(reviews.map((r) => {
    const v2 = r.kind === 'ja' ? ['N', 'N'] : r.kind === 'mixed' ? ['Y', 'N'] : ['Y', 'Y'];
    const v1label = r.kind === 'ja' ? (r.id === jaTarget.id ? 'Y' : 'N') : r.kind === 'mixed' ? mixV1.get(r.id) : (R.rnd() < 0.8 ? 'Y' : 'N');
    const v1 = [R.rnd() < 0.7 ? 'Y' : 'N', v1label];
    return [r.id, { v1, v2 }];
  }));
  const codes = R.shuffle([...Array(9000).keys()]).slice(0, 60).map((x) => `P-${1000 + x}`);
  const meta = new Map(reviews.map((r) => [r.id, { code: R.pick(codes), channel: R.pick(['app', 'web', 'partner']), rating: R.int(1, 5), date: `2026-0${R.int(4, 6)}-${String(R.int(1, 28)).padStart(2, '0')}`, votes: R.int(0, 40) }]));

  // 정답 재계산
  let v2Wrong = reviews.filter((r) => { const x = res.get(r.id).v2; return x[0] === 'Y' && x[1] === 'N'; });
  const lateIn = v2Wrong.filter((r) => /환불/.test(r.text));
  const isLate = (r) => r.late || r.refund || r.praiseLate || /返金/.test(r.text);
  let lateAll = reviews.filter(isLate);
  need(lateIn.length === 1 && lateIn[0].id === refundCase.id, '상황 2: v2 라벨 오답 중 환불 지연은 1건');
  need(lateAll.length >= 4, '상황 2: 리뷰 파일만 볼 때 환불 지연 후보 4건 이상');
  need(v2Wrong.length >= 4 && v2Wrong.length <= 20, '상황 2: 옮겨 적는 목록 4~20개');
  let regress = reviews.filter((r) => res.get(r.id).v1[1] === 'Y' && res.get(r.id).v2[1] === 'N');
  const regJa = regress.filter((r) => r.kind === 'ja');
  need(regJa.length === 1 && regJa[0].id === jaTarget.id, '상황 2: 회귀 리뷰 중 일본어는 1건');
  need(regress.length >= 4 && regress.length <= 20, '상황 2: 회귀 목록 4~20개');
  need(new Set(regress.map((r) => meta.get(r.id).code)).size >= 4, '상황 2: test_results+meta만 볼 때 상품 코드 후보 4개 이상');
  need(jaRev.length >= 4, '상황 2: 리뷰 파일만 볼 때 일본어 후보 4건 이상');
  const productCode = meta.get(jaTarget.id).code;

  // 객관식(2×2): AI 메모의 'v2 채점 결과'와 '리뷰 특징'이 둘 다 맞는 사례 하나
  const used = new Set([refundCase.id, jaTarget.id]);
  const pickRev = (f) => { const r = R.pick(reviews.filter((x) => f(x) && !used.has(x.id) && !regress.includes(x) && !v2Wrong.includes(x))); used.add(r.id); return r; };
  const a = pickRev((r) => r.kind === 'ja' && r.sent === 'pos' && !/返金/.test(r.text));
  const b = pickRev((r) => r.kind === 'plain' && r.sent === 'neg' && !r.late);
  const c = pickRev((r) => r.kind === 'ja' && r.sent === 'neg' && !/返金/.test(r.text));
  const d = pickRev((r) => r.kind === 'plain' && r.sent === 'pos');
  const claims = [
    { r: a, st: 'format_ok=N, label_correct=N', feat: '일본어로 쓴 긍정 리뷰', ok: [true, true] },
    { r: b, st: 'format_ok=N, label_correct=N', feat: '한국어로 쓴 부정 리뷰', ok: [false, true] },
    { r: c, st: 'format_ok=N, label_correct=N', feat: '일본어로 쓴 긍정 리뷰', ok: [true, false] },
    { r: d, st: 'format_ok=Y, label_correct=N', feat: '한국어로 쓴 부정 리뷰', ok: [false, false] },
  ];
  for (const x of claims) { // 주장과 데이터를 다시 대조
    const v2 = res.get(x.r.id).v2.join(), want = x.st.match(/=(\w)/g).map((s) => s[1]).join();
    const lang = x.r.kind === 'ja' ? '일본어' : '한국어', sent = x.r.sent === 'pos' ? '긍정' : '부정';
    need((v2 === want) === x.ok[0] && (x.feat === `${lang}로 쓴 ${sent} 리뷰`) === x.ok[1], `상황 2: 객관식 주장 대조 case ${x.r.id}`);
  }
  const note = R.shuffle(claims);
  const aiNote = `[AI가 정리한 v2 실패 사례 메모]\n${note.map((x, i) => `${i + 1}. case ${x.r.id} - v2 채점: ${x.st} / 리뷰 특징: ${x.feat}`).join('\n')}`;
  const options = note.map((x) => `case ${x.r.id}`), answerIdx = note.findIndex((x) => x.r === a);

  // ── 보강(별도 난수 줄기). 위의 무작위 선택이 모두 끝난 뒤 '평범한 리뷰' 일부만 바꾸므로 다른 리뷰의 ID·결과·상품 코드와 객관식은 그대로다.
  const R2 = makeRng(20261212);
  const before = { v2Wrong: v2Wrong.map((r) => r.id).join(), refund: refundCase.id, ja: jaTarget.id, code: productCode };
  const locked = new Set([...v2Wrong, ...regress, ...lateAll, a, b, c, d].map((r) => r.id));
  const spare = R2.shuffle(reviews.filter((r) => r.kind === 'plain' && !locked.has(r.id)));
  // 단답 1 미끼: 칭찬 + 환불 지연 리뷰 4건. v2 형식 실패(N, N)라 단답 1의 집합 밖이고, v1도 틀려 회귀 목록 밖이다.
  PRAISE_LATE.forEach((t, k) => { const r = spare[k]; Object.assign(r, { kind: /[\u3040-\u30ff]/.test(t) ? 'ja' : 'mixed', sent: 'mixed', text: t, praiseLate: true }); res.set(r.id, { v1: [res.get(r.id).v1[0], 'N'], v2: ['N', 'N'] }); });
  // 단답 2 미끼: v1은 맞고 v2는 형식을 못 지킨 한국어 리뷰 4건(회귀 목록 안). test_results만으로는 일본어 리뷰를 고를 수 없다.
  spare.slice(4, 8).forEach((r) => res.set(r.id, { v1: [res.get(r.id).v1[0], 'Y'], v2: ['N', 'N'] }));
  v2Wrong = reviews.filter((r) => { const x = res.get(r.id).v2; return x[0] === 'Y' && x[1] === 'N'; });
  regress = reviews.filter((r) => res.get(r.id).v1[1] === 'Y' && res.get(r.id).v2[1] === 'N');
  lateAll = reviews.filter(isLate); jaRev = reviews.filter((r) => r.kind === 'ja');
  need(v2Wrong.map((r) => r.id).join() === before.v2Wrong && meta.get(jaTarget.id).code === before.code, '상황 2: 보강 뒤에도 단답 1의 집합·단답 2의 답이 그대로');
  const praiseLate = reviews.filter((r) => r.praiseLate || r.refund);
  need(praiseLate.length >= 4 && praiseLate.filter((r) => v2Wrong.includes(r)).length === 1 && v2Wrong.filter(isLate).length === 1, '상황 2: 칭찬+환불 지연 후보 4건 이상, 단답 1의 집합 안에는 1건');
  const regFmtN = regress.filter((r) => res.get(r.id).v2[0] === 'N');
  need(regFmtN.length >= 4 && regress.filter((r) => r.kind === 'ja').length === 1 && regress.find((r) => r.kind === 'ja').id === before.ja, '상황 2: 회귀 목록에서 v2 형식 실패 4건 이상, 일본어는 정답 1건');
  need(new Set(regress.map((r) => meta.get(r.id).code)).size >= 4 && regress.length <= 20, '상황 2: 원문 없이(test_results·meta) 볼 때 상품 코드 후보 4개 이상');
  for (const x of claims) need(res.get(x.r.id).v2.join() === x.st.match(/=(\w)/g).map((m) => m[1]).join() === x.ok[0], `상황 2: 보강 뒤 객관식 주장 그대로 case ${x.r.id}`);
  const rows = [...reviews.map((r) => [r.id, 'v1', ...res.get(r.id).v1]), ...reviews.map((r) => [r.id, 'v2', ...res.get(r.id).v2])];

  const metaHead = metaCols ? ['case_id', 'product_code', 'channel', 'rating', 'review_date', 'helpful_votes'] : ['case_id', 'product_code'];
  const files = [
    { name: 'prompt_v1.txt', body: '너는 고객 리뷰 분석 전문가야.\n아래 리뷰를 읽고 감정을 분석해줘.\n\n리뷰: {review}' },
    { name: 'prompt_v2.txt', body: '너는 고객 리뷰 분석 전문가야.\n아래 리뷰의 감정을 분류해.\n\n규칙:\n- sentiment는 "긍정", "부정" 중 하나만 쓴다.\n- reason은 리뷰에서 근거가 된 표현을 20자 이내로 인용한다.\n- 다른 설명 없이 아래 JSON만 출력한다.\n\n{"sentiment": "...", "reason": "..."}\n\n예시)\n리뷰: 포장이 찢어진 채로 왔어요.\n출력: {"sentiment": "부정", "reason": "포장이 찢어진 채로"}\n\n리뷰: {review}' },
    { name: 'test_results.csv', body: csv(['case_id', 'prompt_version', 'format_ok', 'label_correct'], rows) },
    { name: 'reviews.csv', body: csv(['case_id', 'review'], reviews.map((r) => [r.id, r.text])) },
    { name: 'review_meta.csv', body: csv(metaHead, reviews.map((r) => { const m = meta.get(r.id); return metaCols ? [r.id, m.code, m.channel, m.rating, m.date, m.votes] : [r.id, m.code]; })) },
    { name: 'ai_failure_note.md', body: aiNote },
  ];
  const questions = [
    { type: 'mc', text: 'ai_failure_note.md는 AI가 v2 실패 사례 4개에 \'v2 채점 결과\'와 \'리뷰 특징\'을 적어 둔 메모다. 두 가지가 모두 사실과 맞는 사례는?', options, answer: answerIdx,
      why: `test_results.csv와 reviews.csv를 함께 보내면 1만 3천 토큰을 넘는다. ① test_results.csv와 메모를 보내 4건의 v2 채점 결과를 확인하면 ${josa(`case ${a.id}`, '과/와')} case ${c.id}만 맞다. ② 그 두 번호를 옮겨 적어 reviews.csv에서 원문을 보면 ${josa(`case ${a.id}`, '은/는')} 일본어 긍정 리뷰로 맞고, ${josa(`case ${c.id}`, '은/는')} 일본어 부정 리뷰라서 특징이 틀렸다(원문: "${c.text}"). ${josa(`case ${b.id}`, '은/는')} 리뷰 특징은 맞지만 v2 채점 결과가 Y, Y라서 틀렸고, ${josa(`case ${d.id}`, '은/는')} 둘 다 틀렸다.` },
    { type: 'short', text: 'prompt_v2가 출력 형식은 지켰지만(format_ok=Y) 라벨이 틀린(label_correct=N) 리뷰 가운데, 환불이 늦어지는 것을 불만으로 말한 리뷰의 case_id는? (숫자)', answers: numAnswers(refundCase.id, ['번', '번 리뷰']).concat([`case ${refundCase.id}`]),
      why: `test_results.csv와 reviews.csv를 함께 보내면 1만 3천 토큰을 넘는다. ① test_results.csv에서 v2이고 format_ok=Y, label_correct=N인 case_id ${v2Wrong.length}개를 뽑는다: ${v2Wrong.map((r) => r.id).join(', ')}. ② 그 목록을 옮겨 적어 reviews.csv에서 원문을 읽는다. 환불 지연을 말한 것은 case ${refundCase.id} 하나다(원문: "${refundCase.text}"). 리뷰 파일 전체에는 한국어·일본어로 쓴 환불 지연 불만이 ${lateAll.length}건 있고, 그중 칭찬도 함께 있는 리뷰만 ${praiseLate.length}건이라 범위를 좁혀야 고를 수 있다.` },
    { type: 'short', text: 'v1에서는 라벨이 맞았지만(label_correct=Y) v2에서는 라벨이 틀린(label_correct=N) 리뷰 가운데 일본어로 쓰인 리뷰가 하나 있다. 그 리뷰가 달린 상품의 product_code는? (P-0000 형식)', answers: idAnswers(productCode),
      why: `세 파일(test_results.csv, reviews.csv, review_meta.csv)은 원문이 든 reviews.csv를 다른 어느 파일과도 함께 보낼 수 없다. ① test_results.csv에서 v1 label_correct=Y이고 v2 label_correct=N인 case_id ${regress.length}개를 뽑는다: ${regress.map((r) => r.id).join(', ')}. 이 가운데 v2 format_ok=N인 것이 ${regFmtN.length}건이라 채점 결과만으로는 일본어 리뷰를 고를 수 없다. ② 그 목록으로 reviews.csv에서 일본어 리뷰를 찾으면 ${josa(`case ${jaTarget.id}`, '이다/다')}(원문: "${jaTarget.text}"). ③ review_meta.csv에서 case ${jaTarget.id}의 product_code는 ${josa(productCode, '이다/다')}. 일본어 리뷰는 전체에 ${jaRev.length}건이라 회귀 목록 없이는 고를 수 없다.` },
  ];
  const plan = [
    { needs: [['test_results.csv'], ['reviews.csv']], pattern: 'case \\d+',
      path: [{ files: ['test_results.csv', 'ai_failure_note.md'], ask: 'ai_failure_note.md에 적힌 사례 4개의 v2 채점 결과(format_ok, label_correct)가 test_results.csv의 v2 결과와 맞는지 확인해서, 맞는 사례의 case 번호만 쉼표로 적어 줘.', carry: [a.id, c.id].map(String) },
        { files: ['reviews.csv', 'ai_failure_note.md'], ask: 'v2 채점 결과가 맞는 사례: {{prev}}\n\n{{question}}' }],
      bypass: [{ files: ['reviews.csv', 'ai_failure_note.md', 'prompt_v2.txt'], text: '메모의 4개 사례 중 리뷰 특징이 실제 원문과 맞는 사례는 무엇이고, 그중 v2 채점 결과까지 맞을 것 같은 사례 하나를 골라 줘.' }] },
    { needs: [['test_results.csv'], ['reviews.csv']], pattern: '\\b\\d{1,3}\\b',
      path: [{ files: ['test_results.csv'], ask: 'test_results.csv에서 prompt_version이 v2이고 format_ok=Y, label_correct=N인 case_id를 모두 쉼표로만 나열해 줘.', carry: v2Wrong.map((r) => String(r.id)) },
        { files: ['reviews.csv'], ask: 'v2에서 format_ok=Y, label_correct=N인 case_id: {{prev}}\n\n{{question}}' }],
      bypass: [{ files: ['reviews.csv', 'prompt_v2.txt'], text: 'reviews.csv에서 환불이 늦어지는 것을 불만으로 말한 리뷰의 case_id를 모두 알려 줘. 그중 칭찬도 함께 있는 리뷰는?' }] },
    { needs: [['test_results.csv'], ['reviews.csv'], ['review_meta.csv']], pattern: 'P-\\d{4}',
      path: [{ files: ['test_results.csv'], ask: 'test_results.csv에서 v1의 label_correct가 Y이면서 v2의 label_correct가 N인 case_id를 모두 쉼표로만 나열해 줘.', carry: regress.map((r) => String(r.id)) },
        { files: ['reviews.csv'], ask: '다음 case_id 가운데 일본어로 쓰인 리뷰의 case_id만 적어 줘: {{prev}}', carry: [String(jaTarget.id)] },
        { files: ['review_meta.csv'], ask: '일본어 리뷰의 case_id: {{prev}}\n\n{{question}}' }],
      bypass: [{ files: ['test_results.csv', 'prompt_v1.txt', 'prompt_v2.txt'], text: 'v1에서는 라벨이 맞고 v2에서 틀린 case_id를 알려 줘. 그중 일본어 리뷰일 것 같은 case와 그 리뷰가 달린 상품의 product_code를 추정해 줘.' },
        { files: ['reviews.csv'], text: '일본어로 쓰인 리뷰의 case_id를 모두 알려 줘. 그중 v1은 맞고 v2는 틀렸을 것 같은 리뷰는?' }] },
  ];
  plan.forEach((p, i) => { p.id = `2-${i + 1}`; });
  assertNoCrossLeak('상황 2', plan, (i) => (questions[i].type === 'mc' ? [String(a.id)] : questions[i].answers));
  return {
    bundle: {
      title: '리뷰 분석 프롬프트 v2 배포 판단',
      scenario: '당신은 리뷰 감정 분류 자동화를 맡은 기획자입니다. 프롬프트를 v1에서 v2로 고친 뒤 리뷰 420건으로 시험했고, 내일 아침까지 v2 배포 여부를 정해야 합니다.\n시험 결과에는 버전별 성공·실패 표시만 있고, 리뷰 원문과 상품 정보는 다른 파일에 있습니다.',
      files, questions,
    },
    plan,
  };
}
