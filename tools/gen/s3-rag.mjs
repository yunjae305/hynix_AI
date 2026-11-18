// 상황 3: 사내 규정 챗봇 답변 검증
// 정보 분리: 청크 내용·점수·doc_id는 retrieved_chunks.json에만, 문서 상태·대체 관계는 doc_registry.csv에만 있다.
// 답변 초안은 doc_id가 아니라 청크 번호를 인용하므로 대장만으로는 초안을 판정할 수 없다.
import { makeRng, csv, need, idAnswers, assertNoCrossLeak, josa } from './common.mjs';

const DEPTS = ['HR', 'FIN', 'IT', 'SEC', 'OPS', 'LEG'];
const TITLES = { HR: ['연차 운영 지침', '채용 절차', '근태 관리 기준', '교육비 지원 안내', '재택근무 운영 기준', '경조사 지원 기준', '휴가 신청 안내', '휴직 운영 기준'], FIN: ['출장비 정산 기준', '법인카드 사용 지침', '예산 편성 절차', '구매 품의 기준'], IT: ['계정 발급 절차', '장비 반납 기준', '원격 접속 가이드', '소프트웨어 설치 기준'],
  SEC: ['출입 통제 기준', '문서 반출 절차', '비밀번호 관리 기준'], OPS: ['회의실 예약 안내', '사무용품 신청 절차', '주차 등록 안내'], LEG: ['계약 검토 절차', '인장 사용 기준', '대외 공문 발송 기준'] };
// 채움 문장: 숫자·양식 번호·시점 단서가 문제와 섞이지 않게 고른다
const FILL = ['부서장 승인 후 담당 부서가 최종 확인한다.', '증빙 서류는 전자 문서로 첨부한다.', '기준을 초과하는 경우 사전에 품의를 받아야 한다.', '분기마다 사용 현황을 점검하고 결과를 공지한다.', '신규 입사자는 입사 첫 주에 안내 교육을 받는다.',
  '위반 시 1차 경고 후 재발하면 권한을 회수한다.', '외부 반출이 필요한 경우 보안 담당자의 확인을 받는다.', '담당자가 바뀌면 인수인계 내용을 문서로 남긴다.', '비용은 건당 한도 내에서 실비로 정산한다.', '예약은 미사용 시 자동 취소된다.',
  '장비는 퇴사일 전날까지 반납하고 확인서를 받는다.', '계약서는 서명 전에 법무 검토를 거친다.', '문의는 담당 부서 메일로 보낸다.', '세부 기준은 부서별 안내를 따른다.'];

export function build({ nDocs = 340, nChunks = 90 } = {}) {
  const R = makeRng(20261113);
  const docs = [], ids = new Set();
  // doc_id에는 연도를 넣지 않는다(번호로 신·구를 짐작하지 못하게). 갱신일은 대장에만 있다.
  const add = (id, title, status, replaced = '', year = R.int(2019, 2025)) => { need(!ids.has(id), `상황 3: doc_id 중복 ${id}`); ids.add(id); docs.push({ id, title, dept: id.split('-')[0], status, updated: `${year}-${String(R.int(1, 12)).padStart(2, '0')}-${String(R.int(1, 28)).padStart(2, '0')}`, replaced }); };
  const nums = R.shuffle([...Array(9000).keys()].map((x) => 1000 + x));
  let ni = 0;
  const nid = (dept) => `${dept}-${nums[ni++]}`;
  const D = {}; // 이름 붙인 문서
  for (const k of ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'M1', 'M2', 'M3', 'M4', 'M2r', 'M3r', 'H1', 'H2', 'H3', 'H4', 'H5', 'F1', 'F2', 'F3', 'F4']) D[k] = nid(k === 'H5' ? 'FIN' : k === 'H1' ? 'OPS' : 'HR');
  // 사슬 A(단답 1): 점수 높은 청크의 폐기 문서 A1 → A2(폐기) → A3(현행). A2·A3는 청크에 없다.
  add(D.A1, '연차 운영 지침', '폐기', D.A2, 2021); add(D.A2, '연차 운영 지침', '폐기', D.A3, 2023); add(D.A3, '연차 운영 지침', '현행', '', 2025);
  // 사슬 B(단답 2): 점수 0.75 미만 청크의 폐기 문서 B1 → B2(폐기) → B3(현행). B3의 청크는 점수가 낮은 쪽에 있다.
  add(D.B1, '휴가 신청 안내', '폐기', D.B2, 2020); add(D.B2, '휴가 신청 안내', '폐기', D.B3, 2023); add(D.B3, '휴가 신청 안내', '현행', '', 2024);
  // 객관식: 초안이 인용하는 청크의 문서. M1 일치·현행, M2·M3 일치·폐기, M4 불일치·현행
  add(D.M1, '반차·시간 단위 휴가 기준', '현행'); add(D.M4, '휴직 운영 기준', '현행');
  add(D.M2, '반차·시간 단위 휴가 기준', '폐기', D.M2r); add(D.M2r, '반차·시간 단위 휴가 기준', '현행'); add(D.M3, '연차 운영 지침', '폐기', D.M3r); add(D.M3r, '연차 운영 지침', '현행');
  // 점수 0.75 이상인 다른 현행 문서들
  ['H1', 'H2', 'H3', 'H4', 'H5'].forEach((k) => add(D[k], R.pick(TITLES[D[k].split('-')[0]]), '현행'));
  // 연차 신청 양식 번호 미끼 청크의 문서(현행·폐기 섞임)
  add(D.F1, '휴가 신청 안내', '폐기', D.H3); add(D.F2, '근태 관리 기준', '현행'); add(D.F3, '휴가 신청 안내', '현행'); add(D.F4, '연차 운영 지침', '폐기', D.H2);
  while (docs.length < nDocs) {
    const d = R.pick(DEPTS), id = nid(d);
    add(id, R.pick(TITLES[d]), R.rnd() < 0.3 ? '폐기' : '현행');
  }
  // 무작위 폐기 문서는 같은 부서의 현행 문서를 바로 가리킨다(한 단계)
  for (const d of docs) if (d.status === '폐기' && !d.replaced) d.replaced = R.pick(docs.filter((x) => x.status === '현행' && x.dept === d.dept && ![D.A3, D.B3].includes(x.id))).id;
  const doc = (id) => docs.find((d) => d.id === id);
  const fill = (n = 2) => R.shuffle(FILL).slice(0, n).join(' ');

  const NB_SCORE = 0.68;
  const fixed = [
    // 점수 0.75 이상: 문서 6종 중 폐기는 A1 하나
    [D.H1, 0.88, '휴가 일정은 팀 캘린더에 사용일 전날까지 공유한다. ' + fill()], [D.H2, 0.86, '연차는 입사일 기준으로 매년 부여한다. ' + fill()],
    [D.A1, 0.83, '미사용 연차는 최대 5일까지 다음 해로 이월할 수 있다. ' + fill(1)], [D.H3, 0.8, '연차 사용 신청은 사용일 3일 전까지 인사 시스템에 등록한다. ' + fill(1)],
    [D.H4, 0.78, '경조 휴가는 연차와 별도로 부여한다. ' + fill()], [D.H5, 0.76, '출장 중 연차를 쓰면 그날의 출장비는 정산하지 않는다. ' + fill()],
    // 객관식 청크(점수 0.75 미만): 일치 3개(현행 1, 폐기 2), 불일치 1개(현행)
    [D.M1, 0.73, '시간 단위 휴가는 하루 최대 4시간까지 쓸 수 있다. ' + fill()], [D.M2, 0.71, '반차 신청은 사용 전날 18시까지 인사 시스템에 등록한다. ' + fill()],
    [D.M3, 0.7, '연차 이월 신청은 매년 12월 20일까지 한다. ' + fill()], [D.M4, 0.66, '휴직에서 복귀한 직원은 복귀 후 5일 이내에 복직 신고서를 낸다. ' + fill()],
    // 사슬 B 시작 청크와 끝 청크, 양식 번호 미끼
    [D.B1, NB_SCORE, '연차 신청은 신청서 양식 HR-F-11을 작성해 부서장에게 제출한다. ' + fill(1)], [D.B3, 0.41, '연차 신청은 신청서 양식 HR-F-14를 인사 시스템에 올려 제출한다. ' + fill(1)],
    [D.F1, 0.63, '연차 신청은 신청서 양식 HR-F-07을 작성해 제출한다. ' + fill(1)], [D.F2, 0.55, '연차 신청은 신청서 양식 HR-F-15를 쓴다. ' + fill(1)],
    [D.F3, 0.47, '연차 신청은 신청서 양식 HR-F-19를 인사 시스템에 올린다. ' + fill(1)], [D.F4, 0.44, '연차 신청은 신청서 양식 HR-F-04를 출력해 제출한다. ' + fill(1)],
  ];
  const special = new Set([...fixed.map((f) => f[0]), D.A2, D.A3, D.B2, D.M2r, D.M3r]);
  const pool = docs.filter((d) => !special.has(d.id));
  const rest = [];
  while (fixed.length + rest.length < nChunks) rest.push([R.pick(pool).id, R.int(30, 74) / 100, fill(3)]);
  const chunks = [...fixed, ...rest].sort((x, y) => y[1] - x[1]).map(([doc_id, score, text], i) => ({ chunk: i + 1, doc_id, score, text }));
  const chunkOf = (id) => chunks.find((c) => c.doc_id === id);
  const nb = chunkOf(D.B1).chunk;
  const follow = (id) => { let d = doc(id); while (d.status === '폐기') d = doc(d.replaced); return d.id; };

  // 정답 재계산
  const hi = chunks.filter((c) => c.score >= 0.75), hiDocs = [...new Set(hi.map((c) => c.doc_id))];
  const hiDead = hiDocs.filter((id) => doc(id).status === '폐기');
  need(hiDead.length === 1 && hiDead[0] === D.A1, '상황 3: 점수 0.75 이상 중 폐기는 A1 하나');
  const ansA = follow(D.A1);
  need(ansA === D.A3 && !chunks.some((c) => c.doc_id === ansA), '상황 3: 사슬 A 끝(청크에 없음)');
  need(hiDocs.length >= 4 && hiDocs.length <= 20, '상황 3: 옮겨 적는 doc_id 4~20개');
  const endB = follow(D.B1);
  const formB = chunkOf(endB).text.match(/HR-F-\d+/)[0];
  need(endB === D.B3 && formB === 'HR-F-14', '상황 3: 사슬 B 끝의 양식 번호');
  const forms = new Set(chunks.flatMap((c) => c.text.match(/HR-F-\d+/g) ?? []));
  const formNums = [...forms].map((f) => +f.split('-')[2]);
  need(+formB.split('-')[2] > Math.min(...formNums) && +formB.split('-')[2] < Math.max(...formNums), '상황 3: 정답 양식 번호는 후보 중 최댓값도 최솟값도 아니다');
  need(forms.size >= 5, '상황 3: 청크만 볼 때 양식 번호 후보 4개 이상');
  need(chunks.filter((c) => /HR-F-/.test(c.text)).every((c) => c.score < 0.75), '상황 3: 양식 청크는 점수 0.75 미만');
  need(docs.filter((d) => d.status === '폐기').length >= 50, '상황 3: 대장만 볼 때 폐기 사슬 후보가 많아야 한다');

  // ── 보강(별도 난수 줄기): 청크와 위의 문서들을 정한 뒤, 청크에 없는 여러 단계 대체 사슬 3개를 대장에만 더한다.
  // 대장만 볼 때 '두 단계 이상 따라가야 하는 사슬'의 끝이 사슬 A 하나로 좁혀지지 않게(후보 4개 이상).
  const R2 = makeRng(20261213);
  const extra = [];
  const xid = () => { let id; do id = `HR-${R2.int(1000, 9999)}`; while (ids.has(id)); ids.add(id); return id; };
  for (const title of ['연차 운영 지침', '연차 운영 지침', '휴가 신청 안내']) {
    const [x1, x2, x3] = [xid(), xid(), xid()];
    const upd = (y) => `${y}-${String(R2.int(1, 12)).padStart(2, '0')}-${String(R2.int(1, 28)).padStart(2, '0')}`;
    extra.push({ id: x1, title, dept: 'HR', status: '폐기', updated: upd(R2.int(2019, 2021)), replaced: x2 }, { id: x2, title, dept: 'HR', status: '폐기', updated: upd(R2.int(2022, 2023)), replaced: x3 }, { id: x3, title, dept: 'HR', status: '현행', updated: upd(R2.int(2024, 2025)), replaced: '' });
  }
  const allDocs = [...docs, ...extra];
  const docAll = (id) => allDocs.find((d) => d.id === id);
  const hops = (id) => { let n = 0, d = docAll(id); while (d.status === '폐기') { n++; d = docAll(d.replaced); } return n; };
  const multiEnds = new Set(allDocs.filter((d) => d.status === '폐기' && hops(d.id) >= 2).map((d) => { let x = d; while (x.status === '폐기') x = docAll(x.replaced); return x.id; }));
  need(multiEnds.size >= 4 && multiEnds.has(ansA) && !extra.some((d) => chunks.some((c) => c.doc_id === d.id)), '상황 3: 대장만 볼 때 여러 단계 사슬 끝 후보 4개 이상');
  // 객관식 초안: 청크 번호를 인용한다
  const cite = (id) => chunkOf(id).chunk;
  const draftRows = [
    { k: 'a', id: D.M1, s: '시간 단위 휴가는 하루 최대 4시간까지 쓸 수 있습니다.', match: true },
    { k: 'b', id: D.M2, s: '반차 신청은 사용 전날 18시까지 인사 시스템에 등록합니다.', match: true },
    { k: 'c', id: D.M3, s: '연차 이월 신청은 매년 12월 20일까지 합니다.', match: true },
    { k: 'd', id: D.M4, s: '휴직에서 복귀하면 복귀 후 7일 이내에 복직 신고서를 냅니다.', match: false },
  ];
  const shuffled = R.shuffle(draftRows);
  const order = [...shuffled.filter((r) => r.k !== 'a'), shuffled.find((r) => r.k === 'a')]; // 정답을 첫 보기에 두지 않는다(파일 없이 찍게 하면 모델이 A로 쏠린다)
  const mark = ['①', '②', '③', '④'];
  for (const r of draftRows) need((r.k === 'a' || r.k === 'd') === (doc(r.id).status === '현행'), `상황 3: 객관식 문서 상태 ${r.id}`);
  need(draftRows.filter((r) => r.match && doc(r.id).status === '현행').length === 1, '상황 3: 객관식 정답 하나');
  const draft = `[챗봇이 생성한 답변 초안]\n${order.map((r, i) => `${mark[i]} ${r.s} [chunk ${cite(r.id)}]`).join('\n')}`;
  const answerIdx = order.findIndex((r) => r.k === 'a');
  const options = order.map((r, i) => `${mark[i]} ${r.s}`);

  // 대장 행 순서: 원래 순서(주 난수 줄기)에 보강 문서를 별도 줄기로 끼워 넣는다
  const regRows = R.shuffle(docs);
  for (const d of R2.shuffle(extra)) regRows.splice(R2.int(0, regRows.length), 0, d);
  const files = [
    { name: 'user_question.txt', body: '[사내 규정 챗봇에 들어온 질문]\n반차나 시간 단위 휴가는 어떻게 쓰고 언제까지 신청하나요? 연차 이월 신청 기한과, 휴직 후 복귀할 때 낼 서류도 알려 주세요.' },
    { name: 'answer_draft.md', body: draft },
    { name: 'retrieved_chunks.json', body: '[\n' + chunks.map((c) => '  ' + JSON.stringify(c)).join(',\n') + '\n]' },
    { name: 'doc_registry.csv', body: csv(['doc_id', 'title', 'dept', 'status', 'updated', 'replaced_by'], regRows.map((d) => [d.id, d.title, d.dept, d.status, d.updated, d.replaced])) },
  ];
  const mcWhy = order.map((r, i) => `${josa(mark[i], '은/는')} ${josa(`chunk ${cite(r.id)}`, '을/를')} 인용했고 내용이 ${r.match ? '일치하며' : '다르며'}, 그 문서 ${josa(r.id, '은/는')} ${doc(r.id).status} 상태다`).join('. ');
  const questions = [
    { type: 'mc', text: 'answer_draft.md의 문장 ①~④는 각각 retrieved_chunks.json의 청크를 인용한다. 인용한 청크의 내용과 일치하면서, 그 청크의 문서가 doc_registry.csv에서 \'현행\'인 문장은?', options, answer: answerIdx,
      why: `retrieved_chunks.json과 doc_registry.csv를 함께 보내면 1만 3천 토큰을 넘는다. ① 초안과 retrieved_chunks.json을 보내 인용한 청크와 내용이 일치하는지, 그 청크의 doc_id가 무엇인지 확인한다. ② 일치하는 문장의 doc_id를 옮겨 적어 doc_registry.csv에서 상태를 본다. ${mcWhy}. 두 가지가 모두 맞는 것은 ${josa(mark[answerIdx], '이다/다')}.` },
    { type: 'short', text: 'retrieved_chunks.json에서 score가 0.75 이상인 청크들의 문서 가운데 doc_registry.csv에서 status가 \'폐기\'인 문서가 하나 있다. 그 문서의 대체 관계(replaced_by)를 status가 \'현행\'인 문서가 나올 때까지 따라가면 나오는 doc_id는? (XX-0000 형식)', answers: idAnswers(ansA),
      why: `두 파일을 함께 보내면 1만 3천 토큰을 넘는다. ① retrieved_chunks.json에서 score 0.75 이상인 청크의 doc_id ${hiDocs.length}개를 뽑는다: ${hiDocs.join(', ')}. ② 그 목록을 옮겨 적어 doc_registry.csv에서 상태를 본다. 폐기는 ${D.A1} 하나이고, replaced_by를 따라가면 ${D.A2}(폐기), ${D.A3}(현행) 순서로 이어진다. 한 단계에서 멈추면 답을 ${josa(D.A2, '으로/로')} 잘못 적게 된다. ${josa(D.A3, '은/는')} 청크에 없어 대장을 따라가야만 나온다. 대장에는 두 단계 이상 이어지는 대체 사슬이 ${multiEnds.size}개 있어 청크의 점수 없이는 고를 수 없다.` },
    { type: 'short', text: `retrieved_chunks.json에서 chunk 번호가 ${nb}인 청크의 문서(doc_id)에서 doc_registry.csv의 대체 관계(replaced_by)를 status가 '현행'인 문서가 나올 때까지 따라가면, 그 현행 문서의 청크도 retrieved_chunks.json에 들어 있다. 그 청크에 적힌 연차 신청서 양식 번호는? (XX-X-00 형식)`, answers: idAnswers(formB),
      why: `두 파일을 함께 보내면 1만 3천 토큰을 넘는다. ① retrieved_chunks.json에서 chunk ${nb}의 doc_id인 ${josa(D.B1, '을/를')} 확인한다. ② doc_registry.csv에서 ${D.B1}(폐기), ${D.B2}(폐기), ${D.B3}(현행) 순서로 따라간다. ③ retrieved_chunks.json에서 ${D.B3}의 청크를 찾으면 ${josa(`chunk ${chunkOf(endB).chunk}`, '이고/고')} 양식 번호는 ${josa(formB, '이다/다')}. 청크에는 연차 신청서 양식 번호가 ${forms.size}개 있어 대장 없이는 고를 수 없다.` },
  ];
  for (const q of questions) need(!/[A-Z]{2,3}-\d{4}/.test((q.text + (q.options ?? []).join(' ')).replace(/XX-0000/g, '')), '상황 3: 문제 글·보기에 doc_id를 쓰지 않는다(다른 문제의 후보를 좁히지 않게)');
  const plan = [
    { needs: [['retrieved_chunks.json'], ['doc_registry.csv']], pattern: '[①②③④]',
      path: [{ files: ['answer_draft.md', 'retrieved_chunks.json'], ask: 'answer_draft.md의 문장 ①~④가 각각 인용한 청크의 내용과 일치하는지 확인해서, 일치하는 문장의 번호와 그 청크의 doc_id만 적어 줘.', carry: draftRows.filter((r) => r.match).map((r) => r.id) },
        { files: ['answer_draft.md', 'doc_registry.csv'], ask: '인용한 청크와 내용이 일치하는 문장과 그 청크의 doc_id: {{prev}}\n\n{{question}}' }],
      bypass: [{ files: ['answer_draft.md', 'retrieved_chunks.json', 'user_question.txt'], text: '초안 ①~④ 중 인용한 청크와 내용이 일치하는 문장을 알려 주고, 그중 현행 규정일 가능성이 높은 문장 하나를 골라 줘.' }] },
    { needs: [['retrieved_chunks.json'], ['doc_registry.csv']], pattern: '[A-Z]{2,3}-\\d{4}',
      path: [{ files: ['retrieved_chunks.json'], ask: 'retrieved_chunks.json에서 score가 0.75 이상인 청크의 doc_id를 중복 없이 쉼표로만 나열해 줘.', carry: hiDocs },
        { files: ['doc_registry.csv'], ask: 'score 0.75 이상 청크의 doc_id: {{prev}}\n\n{{question}}' }],
      bypass: [{ files: ['doc_registry.csv', 'answer_draft.md', 'user_question.txt'], text: 'doc_registry.csv에서 폐기 문서의 replaced_by가 두 단계 이상 이어지는 사슬을 모두 찾아, 끝의 현행 문서 doc_id를 알려 줘. 그중 연차 이월 규정과 관련 있어 보이는 하나를 골라 줘.' },
        { files: ['retrieved_chunks.json', 'answer_draft.md', 'user_question.txt'], text: 'score 0.75 이상 청크 가운데 옛 규정으로 보이는 문서와, 그 문서를 대체했을 현행 문서의 doc_id를 추정해 줘.' }] },
    { needs: [['retrieved_chunks.json'], ['doc_registry.csv']], pattern: 'HR-F-\\d+',
      path: [{ files: ['retrieved_chunks.json'], ask: `retrieved_chunks.json에서 chunk ${nb}의 doc_id만 적어 줘.`, carry: [D.B1] },
        { files: ['doc_registry.csv'], ask: '{{prev}} 문서에서 replaced_by를 status가 \'현행\'인 문서가 나올 때까지 따라가서, 그 현행 문서의 doc_id만 적어 줘.', carry: [endB] },
        { files: ['retrieved_chunks.json'], ask: '대체 관계를 따라가 나온 현행 문서의 doc_id: {{prev}}\n\n{{question}}' }],
      bypass: [{ files: ['retrieved_chunks.json', 'answer_draft.md', 'user_question.txt'], text: `연차 신청서 양식 번호가 적힌 청크를 모두 찾아 doc_id와 양식 번호를 알려 줘. chunk ${nb}의 문서를 대체한 최신 문서의 양식 번호는 무엇일 것 같아?` }] },
  ];
  plan.forEach((p, i) => { p.id = `3-${i + 1}`; });
  assertNoCrossLeak('상황 3', plan, (i) => (questions[i].type === 'mc' ? [D.M1] : questions[i].answers));
  return {
    bundle: {
      title: '사내 규정 챗봇 답변 검증',
      scenario: `당신은 사내 규정 챗봇의 품질 담당자입니다. 한 직원이 "챗봇 답변이 실제 규정과 다른 것 같다"고 신고했습니다.\n챗봇이 검색해 온 청크 ${nChunks}개, 문서 대장 ${nDocs}건, 답변 초안을 대조해 초안을 그대로 내보내도 되는지 판정해야 합니다.`,
      files, questions,
    },
    plan,
  };
}
