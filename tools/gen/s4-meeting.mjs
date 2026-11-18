// 상황 4: 글로벌 제품팀 영어 회의록 정리
// 정보 분리: 회의록 하나가 7천 토큰 남짓이라 두 개를 함께 보낼 수 없다. 업무의 담당자는 6/3 회의록, 바뀐 기한·새 업무는 6/10, 완료 보고·새 기한은 6/17에만 있다.
// 기한 변경·완료 보고는 담당자 이름 없이 진행자(Minji)가 말한다. 담당자는 6/3 회의록에만 있다.
import { makeRng, need, dateKo, dateEn, dateAnswers, assertNoCrossLeak, josa } from './common.mjs';

const WHO = ['Minji', 'Sehun', 'Yura', 'Doyun', 'Taeo', 'Jian', 'Hana', 'Kai'];
const PEOPLE = 'Attendees: Minji, Sehun, Yura, Doyun, Taeo, Jian, Hana, Kai'; // 역할은 적지 않는다(업무 이름으로 담당자를 짐작하지 못하게)
const TOPICS = ['weekly active users', 'response latency', 'support ticket volume', 'server cost', 'signup conversion', 'app store rating', 'search success rate', 'payment failure rate', 'onboarding completion', 'push opt-in rate', 'crash-free sessions', 'refund requests', 'page load time', 'trial-to-paid conversion'];
const CAUSES = ['the release from last week', 'the marketing campaign', 'an error on a specific device model', 'a delay in an external integration', 'a change in usage over the holiday', 'the new placement of the feature entry point', 'a pricing experiment in one region', 'a change in the recommendation model'];
const EXTRA = ['The detailed numbers are on the dashboard if you want to look.', 'We are checking whether other metrics show the same pattern.', 'The same point came up in customer interviews.', 'A competitor reportedly saw a similar shift around the same time.',
  'We need to dig into the logs to know the exact reason.', 'Compared with last quarter it is still in a stable range.', 'Let us keep an eye on it for another week.', 'Nothing to act on yet.'];
// 업무 이름(세 회의록에서 똑같이 쓴다)
const OLD = ['response cache design doc', 'error message drafts', 'QA checklist', 'usage dashboard', 'launch announcement plan', 'support macro set', 'staging server upgrade', 'rate limit policy draft'];
const OLD_OWNER = ['Sehun', 'Yura', 'Doyun', 'Taeo', 'Jian', 'Hana', 'Kai', 'Sehun'];
const NEW10 = ['partner FAQ page', 'billing alert rules', 'beta feedback survey', 'log retention script', 'release notes draft', 'onboarding email copy'];
const NEW10_OWNER = ['Jian', 'Kai', 'Hana', 'Taeo', 'Yura', 'Doyun'];
const NEW17 = ['pricing comparison sheet', 'incident runbook', 'accessibility audit', 'regional launch checklist'];
const NEW17_OWNER = ['Minji', 'Kai', 'Yura', 'Hana'];

export function build({ fillerBlocks = 100 } = {}) {
  const R = makeRng(20261114);
  const filler = () => {
    const [a, b] = R.shuffle(WHO);
    return [`${a}: Quick update on ${R.pick(TOPICS)}. This week the number is ${R.int(12, 980)}, ${R.pick(['up', 'down'])} ${R.int(1, 19)} percent from last week.`, `${b}: We think it is mostly ${R.pick(CAUSES)}. ${R.pick(EXTRA)}`, `${a}: Got it. ${R.pick(EXTRA)}`];
  };
  const build1 = (head, keys) => {
    const blocks = Array.from({ length: fillerBlocks }, filler);
    const step = Math.floor(fillerBlocks / (keys.length + 1));
    keys.forEach((k, i) => blocks.splice((i + 1) * step + i, 0, k));
    return head + '\n\n' + blocks.map((b) => b.join('\n')).join('\n');
  };
  // 6/3 업무 8개: 객관식 4개(6/10에 기한 변경, 6/17에 완료), 6/10에 완료 2개, 6/17에 완료 1개, 끝까지 완료 보고 없음 1개(단답 2의 대상)
  const order = R.shuffle([...OLD.keys()]);
  const mcIdx = order.slice(0, 4), done10 = order.slice(4, 6), done17 = order[6], target = order[7];
  const due03 = new Map(OLD.map((_, i) => [i, [8, 9, 10, 11, 12][i % 5]]));
  // 객관식 업무의 바뀐 기한은 모두 6/17 뒤(완료 시점과 견줘 맞고 틀림을 짐작하지 못하게). 6/10 새 업무의 기한은 6/11~6/16
  const moved = new Map(mcIdx.map((i, k) => [i, [18, 19, 21, 22][k]]));
  const due10 = [11, 12, 13, 14, 15, 16];
  const newMissing = R.int(0, NEW10.length - 1); // 6/17에 언급이 없는 6/10 새 업무(단답 1의 대상)
  const due17 = new Map([[`old${target}`, 26], ...NEW17.map((t, k) => [t, [24, 25, 29, 30][k]])]);

  const m1 = build1(`[2026-06-03 Weekly Product Sync] ${PEOPLE}`, R.shuffle(OLD.map((t, i) => [`Minji: ${OLD_OWNER[i]}, please have the ${t} done by ${dateEn(6, due03.get(i))}.`, `${OLD_OWNER[i]}: Sure, I will have it by ${dateEn(6, due03.get(i))}.`])));
  const keys2 = [
    ...mcIdx.map((i) => [`Minji: The ${OLD[i]} moves to ${dateEn(6, moved.get(i))}.`]),
    ...done10.map((i) => [`Minji: The ${OLD[i]} is complete.`]),
    ...NEW10.map((t, k) => [`Minji: ${NEW10_OWNER[k]}, please take the ${t}. It is due ${dateEn(6, due10[k])}.`, `${NEW10_OWNER[k]}: OK, ${dateEn(6, due10[k])} works.`]),
  ];
  const m2 = build1(`[2026-06-10 Weekly Product Sync] ${PEOPLE}`, R.shuffle(keys2));
  const keys3 = [
    ...[...mcIdx, done17].map((i) => [`Minji: The ${OLD[i]} is complete.`]),
    ...NEW10.map((t, k) => (k === newMissing ? null : [`Minji: The ${t} is complete.`])).filter(Boolean),
    [`Minji: The ${OLD[target]} is due ${dateEn(6, 26)}. ${OLD_OWNER[target]} owns it.`],
    ...NEW17.map((t, k) => [`Minji: The ${t} is due ${dateEn(6, due17.get(t))}. ${NEW17_OWNER[k]} owns it.`]),
  ];
  const m3 = build1(`[2026-06-17 Weekly Product Sync] ${PEOPLE}`, R.shuffle(keys3));

  // 정답 재계산: 회의록 글에서 직접 다시 센다
  const completedIn = (text) => OLD.concat(NEW10).filter((t) => text.includes(`The ${t} is complete.`));
  const c2 = completedIn(m2), c3 = completedIn(m3);
  const neverDone = OLD.filter((t) => !c2.includes(t) && !c3.includes(t));
  need(neverDone.length === 1 && neverDone[0] === OLD[target], '상황 4: 6/3 업무 중 완료 보고 없는 업무 1개');
  const newMiss = NEW10.filter((t) => !m3.includes(t));
  need(newMiss.length === 1 && newMiss[0] === NEW10[newMissing], '상황 4: 6/10 새 업무 중 6/17 언급 없는 업무 1개');
  const q2Date = due10[newMissing], q3Date = 26;
  need((m2.match(/It is due June \d+/g) ?? []).length >= 4, '상황 4: 6/10 회의록만 볼 때 기한 후보 4개 이상');
  need((m3.match(/is due June \d+/g) ?? []).length >= 4, '상황 4: 6/17 회의록만 볼 때 새 기한 후보 4개 이상');
  need(!m1.includes('June 26') && !m2.includes('June 26'), '상황 4: 단답 2의 답 날짜는 6/17 회의록에만');
  need(!/is complete|is due|moves to/.test(m1) && !/owns it/.test(m2) && !/moves to|please take/.test(m3), '상황 4: 회의록별 문장 종류 분리');

  // 객관식(속성 3개): 담당자(6/3에만) × 6/10에 바뀐 기한(6/10에만) × 6/17 완료 보고 여부(6/17에만). 회의록 하나로는 후보가 3개 남는다.
  const [ia, ib, ic, id] = R.shuffle(mcIdx);
  const otherOwner = (i) => R.pick(WHO.filter((w) => w !== OLD_OWNER[i] && w !== 'Minji'));
  const otherDate = (i) => R.pick([18, 19, 20, 21, 22, 23].filter((d) => d !== moved.get(i) && d !== q2Date && d !== q3Date)); // 단답의 답 날짜는 현황표에 쓰지 않는다
  const rows = R.shuffle([
    { i: ia, owner: OLD_OWNER[ia], date: moved.get(ia), done: '있음', k: 'a' },
    { i: ib, owner: OLD_OWNER[ib], date: moved.get(ib), done: '없음', k: 'b' },
    { i: ic, owner: OLD_OWNER[ic], date: otherDate(ic), done: '있음', k: 'c' },
    { i: id, owner: otherOwner(id), date: moved.get(id), done: '있음', k: 'd' },
  ]);
  const truth = rows.map((r) => [m1.includes(`Minji: ${r.owner}, please have the ${OLD[r.i]}`), m2.includes(`The ${OLD[r.i]} moves to ${dateEn(6, r.date)}.`), m3.includes(`The ${OLD[r.i]} is complete.`) === (r.done === '있음')]);
  need(truth.filter((t) => t.every(Boolean)).length === 1 && truth.every((t) => t.filter(Boolean).length >= 2) && [0, 1, 2].every((k) => truth.filter((t) => t[k]).length === 3), '상황 4: 객관식 속성 3개 대조');
  const summary = `[AI가 회의록으로 만든 업무 현황표]\n${rows.map((r, n) => `${n + 1}. ${OLD[r.i]} - 담당: ${r.owner} - 6월 10일 회의에서 바뀐 기한: ${dateKo(6, r.date)} - 6월 17일 회의 완료 보고: ${r.done}`).join('\n')}`;
  const options = rows.map((_, n) => `${n + 1}번 항목`), answerIdx = rows.findIndex((r) => r.k === 'a');
  const ownerOk = rows.map((r, n) => (truth[n][0] ? `${n + 1}번` : null)).filter(Boolean);
  const bothOk = rows.map((r, n) => (truth[n][0] && truth[n][1] ? `${n + 1}번` : null)).filter(Boolean);

  const files = [{ name: 'meeting_0603.txt', body: m1 }, { name: 'meeting_0610.txt', body: m2 }, { name: 'meeting_0617.txt', body: m3 }, { name: 'ai_summary.md', body: summary }];
  const remain2 = OLD.filter((t) => !c2.includes(t));
  const questions = [
    { type: 'mc', text: 'ai_summary.md는 AI가 회의록으로 만든 업무 현황표다. 1~4번 항목 가운데 담당자, \'6월 10일 회의에서 바뀐 기한\', \'6월 17일 회의 완료 보고\'가 모두 회의록과 맞는 항목은?', options, answer: answerIdx,
      why: `회의록은 하나가 7천 토큰 남짓이라 두 개를 함께 보낼 수 없고, 담당자·바뀐 기한·완료 보고가 각각 다른 회의록에만 있다. ① meeting_0603.txt와 ai_summary.md로 담당자를 확인하면 ${ownerOk.join('·')} 항목이 맞다. ② 그 번호를 옮겨 적어 meeting_0610.txt로 바뀐 기한을 확인하면 ${bothOk.join('·')} 항목이 남는다. ③ 그 번호를 옮겨 적어 meeting_0617.txt로 완료 보고를 확인한다. 회의록 기준 실제 값은 다음과 같다. ${rows.map((r, n) => `${n + 1}번 항목(${OLD[r.i]}): 담당 ${OLD_OWNER[r.i]}, 바뀐 기한 ${dateKo(6, moved.get(r.i))}, 6월 17일 완료 보고 있음.`).join(' ')} 세 가지가 모두 맞는 것은 ${answerIdx + 1}번 항목이다.` },
    { type: 'short', text: '6월 10일 회의에서 새로 맡긴 업무(그 전 회의에 없던 업무) 가운데 6월 17일 회의에서 완료 보고가 없는 업무가 하나 있다. 그 업무의 기한은? (M월 D일 형식)', answers: dateAnswers(6, q2Date),
      why: `두 회의록을 함께 보낼 수 없다. ① meeting_0610.txt에서 새로 맡긴 업무 ${NEW10.length}개와 기한을 뽑는다: ${NEW10.map((t, k) => `${t} ${dateEn(6, due10[k])}`).join(', ')}. 6월 3일 업무의 기한 변경(moves to)은 새 업무가 아니다. ② 그 목록을 옮겨 적어 meeting_0617.txt에서 완료 보고를 찾으면 ${NEW10[newMissing]}만 완료 보고가 없다. 기한은 ${dateKo(6, q2Date)}이다.` },
    { type: 'short', text: '6월 3일 회의에서 기한과 함께 맡긴 업무 가운데 6월 17일 회의까지 한 번도 완료 보고가 없는 업무가 하나 있다. 6월 17일 회의에서 정한 그 업무의 새 기한은? (M월 D일 형식)', answers: dateAnswers(6, q3Date),
      why: `회의록 세 개를 하나씩만 보낼 수 있다. ① meeting_0603.txt에서 기한과 함께 맡긴 업무 ${OLD.length}개를 뽑는다. ② meeting_0610.txt에서 완료 보고가 있는 ${done10.map((i) => OLD[i]).join(', ')} 두 개를 뺀다. ③ 남은 ${remain2.length}개를 옮겨 적어 meeting_0617.txt를 본다: ${remain2.join(', ')}. ${OLD[target]}만 완료 보고가 없고, 새 기한은 ${dateKo(6, 26)}이다. 6월 17일 회의록에는 새 업무의 기한도 함께 나와 6월 3일 업무 목록 없이는 고를 수 없다.` },
  ];
  const plan = [
    { needs: [['meeting_0603.txt'], ['meeting_0610.txt'], ['meeting_0617.txt']], pattern: '[1-4]번',
      path: [{ files: ['meeting_0603.txt', 'ai_summary.md'], ask: 'ai_summary.md의 1~4번 항목에 적힌 담당자가 meeting_0603.txt에서 그 업무를 맡은 사람과 같은지 확인해서, 담당자가 맞는 항목 번호만 적어 줘.', carry: ownerOk },
        { files: ['meeting_0610.txt', 'ai_summary.md'], ask: '담당자가 회의록과 맞는 항목: {{prev}}\n이 항목들 가운데 \'6월 10일 회의에서 바뀐 기한\'이 meeting_0610.txt와 맞는 항목 번호만 적어 줘.', carry: bothOk },
        { files: ['meeting_0617.txt', 'ai_summary.md'], ask: '담당자와 6월 10일에 바뀐 기한이 회의록과 맞는 항목: {{prev}}\n\n{{question}}' }],
      bypass: [{ files: ['meeting_0610.txt', 'ai_summary.md'], text: 'ai_summary.md의 1~4번 항목 가운데 6월 10일 회의에서 바뀐 기한이 회의록과 맞는 항목을 알려 줘. 그중 담당자와 완료 보고까지 맞을 것 같은 항목 하나를 골라 줘.' },
        { files: ['meeting_0617.txt', 'ai_summary.md'], text: 'ai_summary.md의 각 항목에 적힌 6월 17일 완료 보고 여부가 회의록과 맞는지 알려 주고, 담당자와 기한까지 맞을 것 같은 항목 하나를 골라 줘.' }] },
    { needs: [['meeting_0610.txt'], ['meeting_0617.txt']], pattern: 'June \\d+|6월 \\d+일|6/\\d+',
      path: [{ files: ['meeting_0610.txt'], ask: 'meeting_0610.txt에서 이 회의에서 새로 맡긴 업무(이전 회의에서 정한 업무의 기한 변경은 빼고)의 이름과 기한을 모두 적어 줘.', carry: NEW10.map((t, k) => `${t} (${dateEn(6, due10[k])})`) },
        { files: ['meeting_0617.txt'], ask: '6월 10일 회의에서 새로 맡긴 업무와 기한: {{prev}}\n\n{{question}}' }],
      bypass: [{ files: ['meeting_0617.txt', 'ai_summary.md'], text: '6월 17일 회의에서 완료 보고가 나온 업무를 모두 적어 줘. 이 회의록만으로 6월 10일에 새로 맡겼는데 완료 보고가 없는 업무와 그 기한을 추정할 수 있을까?' },
        { files: ['meeting_0610.txt', 'ai_summary.md'], text: '6월 10일 회의에서 새로 맡긴 업무 가운데 6월 17일까지 끝나지 않았을 것 같은 업무의 기한 하나를 골라 줘.' }] },
    { needs: [['meeting_0603.txt'], ['meeting_0610.txt'], ['meeting_0617.txt']], pattern: 'June \\d+|6월 \\d+일|6/\\d+',
      path: [{ files: ['meeting_0603.txt'], ask: 'meeting_0603.txt에서 기한과 함께 맡긴 업무의 이름을 모두 쉼표로만 적어 줘.', carry: [...OLD] },
        { files: ['meeting_0610.txt'], ask: '다음 업무 가운데 meeting_0610.txt에서 완료 보고(is complete)가 있는 업무를 빼고, 나머지 업무 이름만 쉼표로 적어 줘: {{prev}}', carry: remain2 },
        { files: ['meeting_0617.txt'], ask: '6월 10일 회의까지 완료 보고가 없던 6월 3일 업무: {{prev}}\n\n{{question}}' }],
      bypass: [{ files: ['meeting_0617.txt', 'ai_summary.md'], text: '6월 17일 회의에서 기한이 정해진 업무와 기한을 모두 적어 줘. 그중 6월 3일부터 있던 업무일 것 같은 하나를 골라 줘.' },
        { files: ['meeting_0603.txt', 'ai_summary.md'], text: '6월 3일 회의에서 맡긴 업무 중 ai_summary.md에 없는 업무를 적어 줘. 그중 6월 17일까지 끝나지 않았을 것 같은 업무와 새 기한을 추정해 줘.' }] },
  ];
  plan.forEach((p, i) => { p.id = `4-${i + 1}`; });
  assertNoCrossLeak('상황 4', plan, (i) => (questions[i].type === 'mc' ? [options[answerIdx]] : questions[i].answers));
  return {
    bundle: {
      title: '글로벌 제품팀 영어 회의록 정리',
      scenario: '당신은 글로벌 제품팀의 PM 보조입니다. 지난 3주간의 주간 회의는 모두 영어로 진행됐고, 남은 것은 녹취록 세 개뿐입니다.\n내일 본사 보고에 업무별 담당자, 기한, 완료 여부를 정리해 올려야 합니다. AI가 녹취록으로 만든 업무 현황표도 함께 받았습니다.',
      files, questions,
    },
    plan,
  };
}
