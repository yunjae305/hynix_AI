const TOTAL = BUNDLES.length * 3;
const LIMIT = 13000; // 질문 한 번에 보낼 수 있는 토큰(서버 api/chat.js의 MAX_INPUT_TOKENS와 같은 값)
const fmt = (n) => n.toLocaleString('ko-KR');

// ───────── AI 연결 지점. 키는 서버(api/chat.js)에만 있고, 여기서는 대화만 보낸다.
// 글자 파일과 엑셀(표 내용)은 텍스트로, PDF·이미지는 원본 그대로 AI에 전달한다.
// ponytail: 이미지는 PNG만 가정. JPG 등을 쓰게 되면 확장자로 media_type을 고를 것.
const MEDIA = { pdf: ['document', 'application/pdf'], image: ['image', 'image/png'] };
const b64Cache = {};
const toBase64 = (url) => b64Cache[url] ??= fetch(url)
  .then((r) => { if (!r.ok) throw new Error('첨부파일을 불러오지 못했습니다.'); return r.blob(); })
  .then((blob) => new Promise((ok, no) => {
    const fr = new FileReader();
    fr.onload = () => ok(fr.result.split(',')[1]);
    fr.onerror = () => no(new Error('첨부파일을 읽지 못했습니다.'));
    fr.readAsDataURL(blob);
  }))
  .catch((e) => { delete b64Cache[url]; throw e; });

// 질문 { text, files:[파일명] } 을 API 메시지로 바꾼다
async function toApi(m, files) {
    const blocks = [];
  for (const f of (m.files || []).map((n) => files.find((x) => x.name === n)).filter(Boolean)) {
    if (MEDIA[f.kind]) {
      const [type, media_type] = MEDIA[f.kind];
      blocks.push({ type: 'text', text: `[첨부파일: ${f.name}]` }, { type, source: { type: 'base64', media_type, data: await toBase64(f.url) } });
    } else blocks.push({ type: 'text', text: `<file name="${f.name}">\n${f.body}\n</file>` });
  }
  return { role: 'user', content: [...blocks, { type: 'text', text: m.text }] };
}
// 질문 글의 토큰 어림값. 글자 종류마다 무게를 달리 준다(한글·영문·숫자·ID 목록 질문 표본을 서버와 같은 방법으로 재서 맞춘 값).
const TOKEN_WEIGHT = { cjk: 0.75, letter: 0.2, digit: 0.65, space: 0.15, other: 0.9 };
function guessTokens(text) {
  const n = (re) => (text.match(re) || []).length;
  const cjk = n(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7a3]/g), letter = n(/[A-Za-z]/g), digit = n(/[0-9]/g), space = n(/\s/g);
  const other = text.length - cjk - letter - digit - space;
  return Math.ceil(cjk * TOKEN_WEIGHT.cjk + letter * TOKEN_WEIGHT.letter + digit * TOKEN_WEIGHT.digit + space * TOKEN_WEIGHT.space + other * TOKEN_WEIGHT.other);
}
// 원샷: 이번 질문 하나만 보낸다. 이전 질문·답은 화면에만 남고 AI에는 전달되지 않는다.
async function askAI(question, files) {
  if (location.protocol === 'file:') { // 파일을 직접 열었을 때는 서버가 없으므로 데모 응답
    return '[데모 응답] 파일을 직접 열어 AI 서버가 없습니다.\n전달될 파일: ' + (question.files.join(', ') || '없음');
  }
  const r = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [await toApi(question, files)] }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `AI 서버 오류 (${r.status})`);
  return data.reply;
}

// ───────── 채점
// NFKC: 한글·일본어 입력기로 친 전각 숫자·영문(５, ＨＲ－２０２５)을 반각으로 맞춘다
const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
function isCorrect(q, a) {
  if (q.type === 'mc') return a === q.answer;
  return a != null && norm(a) !== '' && q.answers.some((x) => norm(x) === norm(a));
}
console.assert(isCorrect({ type: 'short', answers: ['박준'] }, '  박 준 '), '공백 무시');
console.assert(isCorrect({ type: 'short', answers: ['GPT'] }, 'gpt'), '대소문자 무시');
console.assert(isCorrect({ type: 'short', answers: ['HR-2025-03'] }, 'ＨＲ－２０２５－０３') && isCorrect({ type: 'short', answers: ['5'] }, '５'), '전각 문자 무시');
console.assert(!isCorrect({ type: 'short', answers: ['3'] }, ''), '빈 답은 오답');
console.assert(!isCorrect({ type: 'mc', answer: 1 }, undefined), '미응답은 오답');

// ───────── 상태
// 시험 중 화면을 벗어나면(전체화면 해제 · 탭 전환 · 창 전환) 한 번에 3점 감점, 누적 21점이면 자동 탈락
const PENALTY = 3, FAIL_AT = 21;
const fresh = () => ({ screen: 'home', q: 0, b: 0, tab: 'q', exits: 0, inFull: false, warn: false, lastV: 0, answers: {}, chats: BUNDLES.map(() => []), drafts: BUNDLES.map(() => ''), file: BUNDLES.map(() => 0) });
let S = fresh();
// 새로고침·탭 전환으로 답이 사라지지 않도록 세션에 저장해 둔다
const SAVE_KEY = 'ai-exam-mock-v6';
// 저장된 값을 검사해 정리한 상태를 돌려준다. 쓸 수 없으면 null(새로 시작).
// 손상되거나 손으로 고친 값 때문에 화면이 깨지지 않게 하려는 것일 뿐 부정행위 방지는 아니다. 응시자는 여전히 자기 상태를 고칠 수 있다.
function restore(v) {
  const n = BUNDLES.length, isArr = Array.isArray, inRange = (x, len) => Number.isInteger(x) && x >= 0 && x < len;
  if (!v || typeof v !== 'object') return null;
  if (!['home', 'exam', 'result'].includes(v.screen) || !inRange(v.q, TOTAL) || v.b !== Math.floor(v.q / 3) || !['q', 'f', 'c'].includes(v.tab)) return null;
  if (!Number.isInteger(v.exits) || v.exits < 0 || typeof v.inFull !== 'boolean' || typeof v.warn !== 'boolean' || !Number.isFinite(v.lastV)) return null;
  const okMsg = (m) => !!m && typeof m === 'object' && ['me', 'ai'].includes(m.who) && typeof m.text === 'string' && (!('files' in m) || isArr(m.files) && m.files.every((f) => typeof f === 'string'));
  if (!isArr(v.chats) || v.chats.length !== n || !v.chats.every(isArr)) return null;
  if (!isArr(v.drafts) || v.drafts.length !== n || !v.drafts.every((d) => typeof d === 'string')) return null;
  if (!isArr(v.file) || v.file.length !== n || !v.file.every((i, k) => inRange(i, BUNDLES[k].files.length))) return null;
  const answers = {}; // 답과 대화는 맞지 않는 항목만 버리고 나머지는 살린다(서버가 reply 없이 답하면 text 없는 말이 저장될 수 있다)
  BUNDLES.forEach((B, bi) => B.questions.forEach((q, qi) => {
    const k = `${bi}-${qi}`, a = v.answers && typeof v.answers === 'object' && Object.hasOwn(v.answers, k) ? v.answers[k] : undefined;
    if (q.type === 'mc' ? inRange(a, q.options.length) : typeof a === 'string') answers[k] = a;
  }));
  return {
    screen: v.screen, q: v.q, b: v.b, tab: v.tab, exits: v.exits, inFull: v.inFull, warn: v.warn, lastV: v.lastV, answers,
    chats: v.chats.map((c) => c.filter(okMsg).map((m) => ({ who: m.who, text: m.text, ...('files' in m ? { files: [...m.files] } : {}), ...(Number.isFinite(m.at) ? { at: m.at } : {}) }))),
    drafts: [...v.drafts], file: [...v.file],
  };
}
try {
  const saved = restore(JSON.parse(sessionStorage.getItem(SAVE_KEY)));
  if (saved) S = saved;
} catch (e) { /* 저장소를 못 쓰는 환경이거나 값이 깨졌으면 새로 시작 */ }
// AI 답을 기다리는 상황의 대화 목록. 다시 그려도(render) 남아야 해서 bindExam 밖에 둔다.
// 대화 목록 자체를 키로 쓰므로 fresh()로 새로 시작하면(goHome·startExam) 이전 시험의 표시가 따라오지 않는다.
const busy = new WeakSet();
const penalty = () => S.exits * PENALTY;
// 전체화면 상태에서 새로고침하면 전체화면이 풀리므로 이탈 1회로 센다(새로고침 직전에 탭 숨김으로 이미 셌으면 다시 세지 않는다)
if (S.screen === 'exam' && S.inFull) {
  S.inFull = false;
  if (Date.now() - S.lastV > 3000) { S.exits++; S.warn = true; }
  if (penalty() >= FAIL_AT) S.screen = 'result';
}
const save = () => {
  const inp = document.getElementById('inp');
  if (inp) S.drafts[S.b] = inp.value;
  try { sessionStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* 저장 실패는 시험 진행을 막지 않는다 */ }
};
addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => document.hidden && save());
const app = document.getElementById('app');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const answered = () => Object.values(S.answers).filter((v) => v !== '' && v != null).length;
const ext = (name) => name.split('.').pop();

// ───────── 창 배치: 경계선을 끌어 크기를 바꾸고, 창 머리줄을 다른 창에 끌어다 놓아 자리를 맞바꾼다
// order = [왼쪽, 오른쪽 위, 오른쪽 아래]에 놓일 창. cx·ry = 세로·가로 경계 위치(%), sw = 탐색기 폭(px)
const LAYOUT0 = { cx: 51, ry: 46, sw: 232, order: ['pq', 'pf', 'pc'] };
const L = { ...LAYOUT0, order: [...LAYOUT0.order] };
try {
  const saved = JSON.parse(localStorage.getItem('layout'));
  if (saved && [...saved.order].sort().join() === 'pc,pf,pq' && [saved.cx, saved.ry, saved.sw].every(Number.isFinite)) Object.assign(L, saved);
} catch (e) { /* 저장된 배치가 없거나 깨졌으면 기본 배치 */ }
const saveLayout = () => { try { localStorage.setItem('layout', JSON.stringify(L)); } catch (e) { /* 저장 못 해도 이번 화면에는 적용된다 */ } };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ───────── 테마 · 전체화면
const ICON = {
  sun: '<svg class="i-sun" viewBox="0 0 16 16"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/></svg>',
  moon: '<svg class="i-moon" viewBox="0 0 16 16"><path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8z"/></svg>',
  x: '<svg viewBox="0 0 16 16"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>',
  files: '<svg viewBox="0 0 16 16"><path d="M5.5 4.5V2.5h5l3 3v6h-2.5M2.5 4.5h5l3 3v6h-8z"/></svg>',
  play: '<svg viewBox="0 0 16 16"><path d="M4.5 2.8l8 5.2-8 5.2z" fill="currentColor"/></svg>',
};
const canFull = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
// 폰·태블릿(터치 전용 기기)은 전체화면을 쓰지 않는다. 탭·앱 전환 감지만 적용한다.
const useFull = canFull && !matchMedia('(hover: none) and (pointer: coarse)').matches;
const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
function enterFull() { // 끝나면 풀리는 약속을 돌려준다. 미지원·거부여도 오류를 내지 않는다
  const el = document.documentElement;
  try { return Promise.resolve((el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)).catch(() => {}); } catch (e) { return Promise.resolve(); }
}
function exitFull() {
  if (!isFull()) return;
  try { Promise.resolve((document.exitFullscreen || document.webkitExitFullscreen)?.call(document)).catch(() => {}); } catch (e) { /* 미지원 */ }
}
function toggleTheme() {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch (e) { /* 저장 못 해도 이번 화면에는 적용된다 */ }
}
async function startExam() {
  S = fresh(); S.screen = 'exam'; S.lastV = Date.now(); // 시작 직후 화면 전환 중에 생기는 신호는 이탈로 세지 않는다
  if (useFull) await enterFull();
  S.inFull = isFull(); render();
}
function goHome() { S = fresh(); exitFull(); render(); }

// 가림막: 전체화면이 아니거나(PC) 화면 이탈이 감지된 직후에 시험 화면을 가리고 누적 감점을 보여준다
function syncGuard() {
  const g = document.getElementById('guard'); if (!g) return;
  const needFull = useFull && !isFull();
  g.hidden = !(needFull || S.warn);
  g.querySelector('h2').textContent = needFull ? '전체화면에서만 응시할 수 있습니다' : '시험 화면을 벗어났습니다';
  g.querySelector('button').textContent = needFull ? '전체화면으로 돌아가기' : '시험으로 돌아가기';
  document.getElementById('guardMsg').textContent = S.exits ? `화면 이탈 ${S.exits}회 · 감점 ${penalty()}점 (누적 ${FAIL_AT}점이면 탈락)` : '';
  document.getElementById('pen').textContent = S.exits ? `화면 이탈 ${S.exits}회 · −${penalty()}점` : '';
}
// 이탈 1회 기록. 한 번의 이탈이 여러 신호(창 포커스 잃음 · 탭 숨김 · 전체화면 해제)로 겹쳐 들어오므로 짧은 시간 안의 중복은 버린다.
function violate() {
  if (S.screen !== 'exam') return;
  const now = Date.now();
  if (now - S.lastV < 1500) return;
  S.lastV = now; S.exits++; S.warn = true;
  if (penalty() >= FAIL_AT) { save(); S.screen = 'result'; exitFull(); render(); save(); return; }
  save(); syncGuard();
}
// 전체화면 해제(Esc 등). 제출·나가기로 풀리는 것은 시험 화면이 아니므로 세지 않는다.
function onFullChange() {
  if (S.screen !== 'exam') return;
  if (isFull()) S.inFull = true;
  else if (S.inFull) { S.inFull = false; violate(); }
  if (S.screen === 'exam') { save(); syncGuard(); }
}
document.addEventListener('fullscreenchange', onFullChange);
document.addEventListener('webkitfullscreenchange', onFullChange);
// 탭 전환 · 창 전환(다른 프로그램, 다른 앱). 돌아올 때까지는 한 번으로 센다.
let away = false;
const leftView = () => { if (!away) { away = true; violate(); } };
const backToView = () => { if (!document.hidden && document.hasFocus()) away = false; };
addEventListener('blur', leftView);
addEventListener('focus', backToView);
document.addEventListener('visibilitychange', () => (document.hidden ? leftView() : backToView()));
// 가림막의 돌아가기 버튼
async function resumeExam() {
  S.warn = false; S.lastV = Date.now();
  if (useFull && !isFull()) await enterFull();
  save(); syncGuard();
}

// 화면 안 확인 창. 브라우저 기본 확인 창은 전체화면을 풀어 버리므로 쓰지 않는다.
function ask(message, okLabel) {
  return new Promise((done) => {
    const d = document.createElement('div');
    d.className = 'modal';
    d.innerHTML = `<div class="box" role="alertdialog" aria-modal="true"><p>${esc(message)}</p><div class="row"><button class="btn ghost" data-v="0">취소</button><button class="btn" data-v="1">${esc(okLabel)}</button></div></div>`;
    d.addEventListener('click', (e) => { const v = e.target.closest('[data-v]')?.dataset.v; if (v == null) return; d.remove(); done(v === '1'); });
    document.body.append(d);
    d.querySelector('[data-v="1"]').focus();
  });
}
document.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'theme') toggleTheme();
  if (act === 'full') resumeExam();
  if (act === 'start') startExam();
  if (act === 'home') goHome();
});

// 제목 표시줄 · 본문 · 상태 표시줄로 된 공통 틀
function shell(title, body, status) {
  return `<div class="vs">
    <header class="titlebar"><span class="logo" aria-hidden="true">AI</span><span class="ttl">${esc(title)}</span>
      <button class="tb" data-act="theme" aria-label="라이트 모드/다크 모드 전환" title="라이트/다크 전환">${ICON.sun}${ICON.moon}</button>
      ${S.screen === 'exam' ? `<button class="tb" id="quit" aria-label="시험 나가기" title="나가기">${ICON.x}</button>` : ''}
    </header>
    <div class="pbar"><b id="pb"></b></div>
    ${body}
    <footer class="statusbar">${status}</footer>
  </div>`;
}
const page = (tab, x, inner) => `<main class="editor"><div class="gtabs"><span class="gtab on"><i class="ft" data-x="${x}"></i>${tab}</span></div><div class="scroll"><div class="page">${inner}</div></div></main>`;

function render() {
  app.innerHTML = { home, exam, result }[S.screen]();
  if (S.screen === 'exam') bindExam();
}

function home() { // 표시줄 없이 제목, 응시하기 버튼, 시험지 표지 같은 유의 사항. 테마 버튼은 구석에 둔다.
  const notes = [
    `문항 수(${TOTAL}문항)를 확인하시오. 문항은 번호를 눌러 순서와 관계없이 풀 수 있습니다.`,
    '객관식 문항은 보기 하나를 고르고, 단답형 문항은 답을 직접 입력하시오.',
    '답안은 제출하기 전까지 고칠 수 있으며, 제출한 뒤에는 고칠 수 없습니다.',
    useFull ? '시험은 전체화면으로 진행됩니다. 시험 중에는 전체화면을 해제하지 마시오.' : '',
    `시험 중에는 다른 ${useFull ? '탭이나 창' : '탭이나 앱'}으로 이동하지 마시오. 화면을 벗어나면 <b>1회당 ${PENALTY}점이 감점</b>되며, 감점이 <b>누적 ${FAIL_AT}점</b>이 되면 <b>자동으로 탈락</b> 처리됩니다.`,
    `${useFull ? '새로고침, 주소창 누르기, 찾기(Ctrl+F)' : '주소창 누르기, 알림 창 내리기'}도 화면 이탈로 처리될 수 있으니 유의하시오.`,
  ].filter(Boolean);
  return `<div class="vs"><main class="editor pattern"><div class="hero">
    <button class="tb corner" data-act="theme" aria-label="라이트 모드/다크 모드 전환" title="라이트/다크 전환">${ICON.sun}${ICON.moon}</button>
    <div class="hero-in">
      <h1>AI 역량 모의시험</h1>
      <button class="btn start" data-act="start">${ICON.play}응시하기</button>
      <section class="notes" aria-labelledby="notesTitle">
        <h2 id="notesTitle">응시자 유의 사항</h2>
        <ul>${notes.map((n) => `<li>${n}</li>`).join('')}</ul>
        <p>※ 응시하기를 누르면 시험이 바로 시작됩니다.</p>
      </section>
      <p class="credit">SK Hynix의 해커톤을 참고해서 만들었습니다.</p>
    </div>
  </div></main></div>`;
}

function exam() {
  const B = BUNDLES[S.b];
  return shell(`${B.title} — AI 역량 모의시험`, `<div class="guard" id="guard" hidden><h2></h2><p id="guardMsg"></p><button class="btn start" data-act="full"></button></div>
  <div class="work">
    <nav class="activity" aria-label="보기 전환">
      <button class="ab on" id="abSide" aria-label="탐색기 열기/닫기" title="탐색기">${ICON.files}</button>
    </nav>
    <aside class="sidebar" aria-label="탐색기"><div class="tree" id="tree"></div></aside><div class="rz s" data-rz="sw"></div>
    <div class="col">
      <div class="tabs" role="tablist">${[['q', '문제'], ['f', '파일'], ['c', 'AI 채팅']].map(([k, t]) => `<button role="tab" data-tab="${k}">${t}</button>`).join('')}</div>
      <div class="main">
        <section class="panel" id="pq">
          <div class="gtabs qtabs" id="qtabs" aria-label="문제 번호" draggable="true" data-drag="pq"></div>
          <div class="scroll" id="qbox"></div>
        </section>
        <section class="panel" id="pf"><div class="gtabs" id="files" draggable="true" data-drag="pf"></div><div class="scroll" id="fv"></div></section>
        <section class="panel pattern" id="pc">
          <div class="ph" draggable="true" data-drag="pc">AI 채팅</div>
          <div class="msgs" id="msgs" aria-live="polite"></div>
          <div class="composer"><div class="pop" id="pop" hidden></div>
          <div class="att" id="att" hidden aria-live="polite"></div>
          <form class="send" id="send">
            <textarea id="inp" placeholder="@로 파일을 멘션해 물어보세요" aria-label="AI에게 질문"></textarea>
            <button class="btn" id="go">전송</button></form></div>
        </section>
        <div class="rz v" data-rz="cx"></div><div class="rz h" data-rz="ry"></div>
      </div>
      <div class="foot"><button class="btn ghost" id="prev">이전 문제</button><button class="btn" id="next">다음 문제</button></div>
    </div>
  </div>`, `<span id="stt"></span><span id="pen"></span><span class="sp"></span><span>원샷 · 1만 3천 토큰</span>`);
}

function bindExam() {
  const B = BUNDLES[S.b], $ = (id) => document.getElementById(id);
  const inp = $('inp'), pop = $('pop');
  const Q = (n) => BUNDLES[Math.floor(n / 3)].questions[n % 3];
  const qid = (n) => `${Math.floor(n / 3)}-${n % 3}`;
  const isDone = (n) => { const v = S.answers[qid(n)]; return v !== '' && v != null; };

  // 답한 문제 표시(번호 탭 · 탐색기)와 맨 위 진행 선
  const progress = () => {
    $('pb').style.width = (answered() / TOTAL * 100) + '%';
    document.querySelectorAll('[data-go]').forEach((el) => el.classList.toggle('done', isDone(+el.dataset.go)));
  };
  const setTab = (t) => {
    S.tab = t;
    document.querySelectorAll('.tabs button').forEach((b) => { const on = b.dataset.tab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    ['pq', 'pf', 'pc'].forEach((id) => $(id).classList.toggle('on', id === 'p' + t));
  };
  // 지금 문제: 맨 위에 상황(보기), 그 아래 문제 하나
  const drawQ = () => {
    const n = S.q, q = Q(n), a = S.answers[qid(n)];
    const body = q.type === 'mc'
      ? q.options.map((o, k) => `<button class="opt ${a === k ? 'on' : ''}" data-q="${qid(n)}" data-k="${k}" aria-pressed="${a === k}"><k>${'ABCD'[k]}</k><span>${esc(o)}</span></button>`).join('')
      : `<input data-q="${qid(n)}" value="${esc(a ?? '')}" placeholder="답을 입력하세요" autocomplete="off" aria-label="단답형 답">`;
    $('qbox').innerHTML = `<div class="scn"><h2>${esc(B.title)}</h2>${B.scenario ? `<p>${esc(B.scenario)}</p>` : ''}</div>
      <div class="q"><span class="qno">문제 ${n + 1}</span><h3>${esc(q.text)}</h3>${body}</div>`;
    $('qbox').scrollTop = 0;
    $('qtabs').innerHTML = Array.from({ length: TOTAL }, (_, i) => `<button class="gtab qn ${i === n ? 'on' : ''}" data-go="${i}" aria-label="문제 ${i + 1}" ${i === n ? 'aria-current="true"' : ''}>${i + 1}</button>`).join('');
    $('qtabs').querySelector('.on').scrollIntoView({ block: 'nearest', inline: 'nearest' });
    document.querySelectorAll('#tree [data-go]').forEach((el) => el.classList.toggle('on', +el.dataset.go === n));
    $('prev').disabled = n === 0;
    $('next').textContent = n === TOTAL - 1 ? '제출하기' : '다음 문제';
    progress();
  };
  // 문제 이동. 같은 상황 안에서는 파일·채팅 화면을 그대로 두고 문제만 바꾼다.
  const go = (n) => {
    if (n < 0 || n >= TOTAL) return;
    const sameScene = Math.floor(n / 3) === S.b;
    leave(); S.q = n; S.b = Math.floor(n / 3); S.tab = 'q';
    if (sameScene) { setTab('q'); drawQ(); } else render();
  };
  // 탐색기: 문제 1~15(상황별로 묶어 표시)와 지금 상황의 첨부파일
  const drawTree = () => {
    $('tree').innerHTML = `<div class="sh">문제</div>` + BUNDLES.map((X, bi) => `<div class="grp">${esc(X.title)}</div>` +
      X.questions.map((_, qi) => { const n = bi * 3 + qi; return `<button class="node qnode" data-go="${n}"><span class="dot"></span><span class="nm">문제 ${n + 1}</span></button>`; }).join('')).join('') +
      `<div class="sh">첨부파일</div>` + B.files.map((f, k) => `<button class="node file" data-f="${k}"><i class="ft" data-x="${ext(f.name)}"></i><span class="nm mono">${esc(f.name)}</span><span class="n">${fmt(f.tokens)}</span></button>`).join('');
  };
  const showFile = (i) => {
    S.file[S.b] = i;
    $('files').innerHTML = B.files.map((f, k) => `<button class="gtab chip mono ${k === i ? 'on' : ''}" data-f="${k}"><i class="ft" data-x="${ext(f.name)}"></i>${esc(f.name)}</button>`).join('');
    document.querySelectorAll('#tree .file').forEach((n) => n.classList.toggle('on', +n.dataset.f === i));
    const f = B.files[i];
    if (f.kind === 'image' || f.kind === 'pdf') { // PDF는 모바일에서 바로 안 보이는 경우가 많아 미리보기 이미지로 보여준다
      $('fv').innerHTML = `<div class="shotbox" tabindex="0"><img class="shot" src="${esc(f.preview || f.url)}" alt="${esc(f.name)} 미리보기"></div>`;
    } else if (f.kind === 'sheet') {
      const rows = f.body.split('\n').map((l) => l.split(','));
      $('fv').innerHTML = `<div class="sheet"><table>${rows.map((r, k) => `<tr>${r.map((c) => (k ? `<td>${esc(c)}</td>` : `<th>${esc(c)}</th>`)).join('')}</tr>`).join('')}</table></div>`;
    } else { // 줄 번호가 붙은 코드 보기. 표(CSV)만 가로 스크롤, 나머지 글자 파일은 줄바꿈
      $('fv').innerHTML = `<div class="code${f.name.endsWith('.csv') ? '' : ' wrap'}">${f.body.split('\n').map((l) => `<div class="l">${esc(l) || ' '}</div>`).join('')}</div>`;
    }
    $('fv').scrollTop = 0;
  };
  // 메신저처럼 AI의 말은 왼쪽(얼굴·이름·말풍선), 내가 보낸 말은 오른쪽에 둔다. 시각은 말풍선 아래쪽 옆에 붙는다.
  const clock = (at) => { const d = new Date(at), h = d.getHours(); return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const AI_NAME = 'Doro팀장';
  const AI_FACE = '<img class="who" src="doro.png" alt="" width="164" height="124">'; // 받은 그림은 자르지 않고 통째로 보인다(object-fit:contain)
  const bubble = (m) => {
    const tx = `<div class="tx">${esc(m.text).replace(/@([^\s@]+)/g, (all, n) => B.files.some((f) => f.name === n) ? `<span class="at mono">@${n}</span>` : all)}</div>`;
    const row = `<div class="row">${tx}${Number.isFinite(m.at) ? `<time class="tm">${clock(m.at)}</time>` : ''}</div>`;
    return m.who === 'me'
      ? `<div class="msg me"><span class="sr">나</span>${row}</div>`
      : `<div class="msg ai">${AI_FACE}<div class="col"><span class="nm">${AI_NAME}</span>${row}</div></div>`;
  };
  const drawMsgs = (waiting) => {
    const list = S.chats[S.b], msgs = $('msgs'); // 답을 기다리는 사이 다시 그렸을 수 있어 지금 화면의 대화 창을 찾는다
    msgs.innerHTML = list.map(bubble).join('')
      + (waiting ? `<div class="msg ai">${AI_FACE}<div class="col"><span class="nm">${AI_NAME}</span><div class="row"><div class="tx wait" role="status" aria-label="답변을 만드는 중"><i></i><i></i><i></i></div></div></div></div>` : '');
    msgs.scrollTop = msgs.scrollHeight;
  };
  const leave = () => { S.drafts[S.b] = inp.value; };

  // 문제 답
  $('pq').addEventListener('click', (e) => {
    const o = e.target.closest('.opt'); if (!o) return;
    S.answers[o.dataset.q] = +o.dataset.k;
    document.querySelectorAll(`.opt[data-q="${o.dataset.q}"]`).forEach((x) => { const on = x === o; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
    progress();
  });
  $('pq').addEventListener('input', (e) => { if (e.target.dataset.q) { S.answers[e.target.dataset.q] = e.target.value; progress(); } });

  // 문제 번호 · 탭 · 파일 · 탐색기
  $('qtabs').addEventListener('click', (e) => { const t = e.target.closest('[data-go]'); if (t) go(+t.dataset.go); });
  document.querySelector('.tabs').addEventListener('click', (e) => e.target.dataset.tab && setTab(e.target.dataset.tab));
  $('files').addEventListener('click', (e) => { const t = e.target.closest('[data-f]'); if (t) showFile(+t.dataset.f); });
  $('tree').addEventListener('click', (e) => {
    const f = e.target.closest('[data-f]'), g = e.target.closest('[data-go]');
    if (f) return showFile(+f.dataset.f);
    if (g) go(+g.dataset.go);
  });
  $('abSide').onclick = () => $('abSide').classList.toggle('on', !document.querySelector('.work').classList.toggle('noside'));

  // 입력창에 멘션된 파일과 질문 글의 토큰 크기를 합쳐 보여준다. 서버(api/chat.js)도 둘을 합쳐 한도를 잰다.
  // 질문 글은 서버만 정확히 셀 수 있어 화면에서는 어림값('약')으로 더한다.
  // 합계가 한도를 넘으면 전송 버튼을 꺼서 보내지 못하게 한다(AI가 답하는 중에도 꺼 둔다).
  // 넘었는지는 화면(#att의 over 표시)에서 읽는다. 답을 기다리는 동안 화면을 다시 그려도 지금 입력창 기준으로 맞는다.
  const isOver = () => $('att').classList.contains('over');
  const syncGo = () => { $('go').disabled = busy.has(S.chats[S.b]) || isOver(); };
  const drawAtt = () => {
    const files = B.files.filter((f) => inp.value.includes('@' + f.name));
    const typed = guessTokens(inp.value.trim());
    const sum = files.reduce((s, f) => s + f.tokens, 0) + typed;
    $('att').hidden = !files.length && !typed;
    $('att').classList.toggle('over', sum > LIMIT);
    $('att').innerHTML = files.map((f) => `<span class="mono">${esc(f.name)} <b>${fmt(f.tokens)}</b></span>`).join('') +
      (typed ? `<span>질문 <b>약 ${fmt(typed)}</b></span>` : '') +
      `<div class="meter"><b style="width:${Math.min(100, sum / LIMIT * 100)}%"></b></div><em>합계 약 ${fmt(sum)} / ${fmt(LIMIT)} 토큰${sum > LIMIT ? ' · 한도 초과' : ''}</em>`;
    syncGo();
  };

  // @멘션: 커서 앞이 "@글자"로 끝나면 이 상황의 파일만 후보로 띄운다
  const mention = () => {
    const m = inp.value.slice(0, inp.selectionStart).match(/@([^\s@]*)$/);
    const hits = m ? B.files.filter((f) => f.name.toLowerCase().includes(m[1].toLowerCase())) : [];
    pop.hidden = !hits.length;
    pop.innerHTML = hits.map((f) => `<button type="button" class="mono" data-n="${esc(f.name)}"><i class="ft" data-x="${ext(f.name)}"></i>@${esc(f.name)} <small>${fmt(f.tokens)}토큰</small></button>`).join('');
    drawAtt();
  };
  inp.addEventListener('input', mention);
  pop.addEventListener('click', (e) => {
    const n = e.target.closest('button')?.dataset.n; if (!n) return;
    const at = inp.selectionStart, head = inp.value.slice(0, at).replace(/@[^\s@]*$/, '@' + n + ' ');
    inp.value = head + inp.value.slice(at);
    inp.focus(); inp.setSelectionRange(head.length, head.length); pop.hidden = true; drawAtt();
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') pop.hidden = true;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('send').requestSubmit(); }
  });

  // 전송
  $('send').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy.has(S.chats[S.b]) || isOver()) return; // Enter의 requestSubmit()은 꺼진 전송 버튼과 상관없이 제출되므로 여기서 막는다
    const text = inp.value.trim(); if (!text) return;
    const b = S.b, chat = S.chats[b];
    const files = B.files.filter((f) => text.includes('@' + f.name));
    chat.push({ who: 'me', text, files: files.map((f) => f.name), at: Date.now() }); inp.value = ''; pop.hidden = true; drawMsgs(true); drawAtt();
    busy.add(chat); syncGo();
    try { chat.push({ who: 'ai', text: await askAI(chat.at(-1), B.files), at: Date.now() }); }
    catch (err) { chat.push({ who: 'ai', text: err.message || '응답을 받지 못했습니다. 다시 시도해 주세요.', at: Date.now() }); console.error(err); }
    finally { busy.delete(chat); }
    if (S.chats[b] === chat && S.screen === 'exam' && S.b === b) { drawMsgs(); syncGo(); }
  });

  // 창 배치 적용과 조절
  const main = document.querySelector('.main'), work = document.querySelector('.work');
  const applyLayout = () => {
    L.order.forEach((id, i) => { $(id).classList.remove('s0', 's1', 's2'); $(id).classList.add('s' + i); });
    main.style.setProperty('--cx', L.cx + '%'); main.style.setProperty('--ry', L.ry + '%'); work.style.setProperty('--sw', L.sw + 'px');
  };
  document.querySelectorAll('.rz').forEach((h) => {
    const k = h.dataset.rz;
    h.onpointerdown = (e) => {
      e.preventDefault(); h.setPointerCapture(e.pointerId); h.classList.add('drag');
      h.onpointermove = (m) => {
        const r = main.getBoundingClientRect();
        if (k === 'cx') L.cx = clamp((m.clientX - r.left) / r.width * 100, 20, 80);
        if (k === 'ry') L.ry = clamp((m.clientY - r.top) / r.height * 100, 15, 85);
        if (k === 'sw') L.sw = clamp(m.clientX - document.querySelector('.sidebar').getBoundingClientRect().left, 150, 480);
        applyLayout();
      };
      h.onpointerup = h.onpointercancel = () => { h.onpointermove = null; h.classList.remove('drag'); saveLayout(); };
    };
    h.ondblclick = () => { L[k] = LAYOUT0[k]; applyLayout(); saveLayout(); }; // 두 번 누르면 기본 크기로
  });
  let dragId = null;
  main.addEventListener('dragstart', (e) => {
    dragId = e.target.closest?.('[data-drag]')?.dataset.drag || null;
    if (dragId) { e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; }
  });
  const clearDrop = () => document.querySelectorAll('.panel.drop').forEach((p) => p.classList.remove('drop'));
  main.addEventListener('dragover', (e) => {
    const p = e.target.closest('.panel');
    if (!dragId || !p || p.id === dragId) return;
    e.preventDefault(); clearDrop(); p.classList.add('drop');
  });
  main.addEventListener('drop', (e) => {
    const p = e.target.closest('.panel');
    if (!dragId || !p || p.id === dragId) return;
    e.preventDefault();
    const a = L.order.indexOf(dragId), b = L.order.indexOf(p.id);
    [L.order[a], L.order[b]] = [L.order[b], L.order[a]];
    applyLayout(); saveLayout();
  });
  main.addEventListener('dragend', () => { dragId = null; clearDrop(); });

  // 이전 · 다음 · 제출
  $('prev').onclick = () => go(S.q - 1);
  $('next').onclick = async () => {
    if (S.q < TOTAL - 1) return go(S.q + 1);
    leave();
    const left = TOTAL - answered();
    if (left && !(await ask(`아직 ${left}문제를 풀지 않았습니다. 제출할까요?`, '제출하기'))) return;
    S.screen = 'result'; exitFull(); render();
  };
  $('quit').onclick = async () => { if (await ask('시험을 그만둘까요? 입력한 답은 사라집니다.', '나가기')) goHome(); };

  $('stt').textContent = B.title; applyLayout();
  inp.value = S.drafts[S.b]; drawTree(); drawAtt(); setTab(S.tab); showFile(S.file[S.b]); drawMsgs(busy.has(S.chats[S.b])); drawQ(); syncGuard();
  syncGo();
}

function result() {
  let total = 0;
  const rows = BUNDLES.map((B, bi) => {
    const marks = B.questions.map((q, qi) => isCorrect(q, S.answers[`${bi}-${qi}`]));
    const n = marks.filter(Boolean).length; total += n;
    return { B, bi, marks, n };
  });
  const show = (q, a) => a == null || a === '' ? '미응답' : q.type === 'mc' ? q.options[a] : a;
  const pen = penalty(), failed = pen >= FAIL_AT, final = failed ? 0 : Math.max(0, total - pen);
  return shell('결과 — AI 역량 모의시험', page('결과.md', 'md', `
    <div class="sum">
      <div><div class="ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="tr" cx="60" cy="60" r="52"/><circle class="fg" cx="60" cy="60" r="52" stroke-dasharray="${(2 * Math.PI * 52).toFixed(1)}" stroke-dashoffset="${(2 * Math.PI * 52 * (1 - final / TOTAL)).toFixed(1)}"/></svg>
        ${failed ? `<div class="score fail">탈락</div>` : `<div class="score">${final}<small> / ${TOTAL}</small></div>`}</div>
        <p class="lead">정답 ${total}개${pen ? `<br><span class="pen">화면 이탈 ${S.exits}회 · 감점 ${pen}점${failed ? ' · 자동 탈락' : ''}</span>` : ''}</p></div>
      <div class="bars">${rows.map((r) => `<div class="bar"><span>${esc(r.B.title)}</span><i><b style="width:${r.n / 3 * 100}%"></b></i><span class="mono">${r.n}/3</span></div>`).join('')}</div>
    </div>
    <h2>문제별 해설</h2>
    ${rows.map((r) => r.B.questions.map((q, qi) => `<div class="review">
      <span class="${r.marks[qi] ? 'ok' : 'no'}">${r.marks[qi] ? '✓ 정답' : '✗ 오답'}</span> <span class="qno">문제 ${r.bi * 3 + qi + 1}</span>
      <div class="qt">${esc(q.text)}</div>
      <p>내 답: ${esc(show(q, S.answers[`${r.bi}-${qi}`]))} / 정답: ${esc(q.type === 'mc' ? q.options[q.answer] : q.answers[0])}</p>
      <p>${esc(q.why)}</p></div>`).join('')).join('')}
    <button class="btn start" style="margin-top:24px" data-act="home">처음으로</button>`),
  `<span>${failed ? '탈락' : `점수 ${final}/${TOTAL}`}</span><span class="sp"></span>`);
}

render();
