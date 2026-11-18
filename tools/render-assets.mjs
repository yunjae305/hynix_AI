// 상황 5의 PDF·이미지를 HTML로 그려 Playwright 크로미움으로 렌더링한다(gen-data.mjs가 부른다).
// playwright-core는 프로젝트 의존성에 넣지 않는다. 설치한 폴더를 PLAYWRIGHT_CORE_DIR로 알려 준다.
//   PLAYWRIGHT_CORE_DIR=<playwright-core를 설치한 폴더>  (그 아래 node_modules/playwright-core)
//   PW_LIBS=<크로미움에 필요한 공유 라이브러리 폴더>      (WSL에 libnspr4·libnss3·libasound2가 없을 때, apt download 후 dpkg -x로 푼 usr/lib/x86_64-linux-gnu)
// 한글 글꼴: 시스템의 Noto Sans CJK KR을 쓰고, 없으면 Windows의 맑은 고딕(/mnt/c/Windows/Fonts/malgun.ttf)을 쓴다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const FONT = `@font-face { font-family: 'KR'; src: local('Noto Sans CJK KR'), local('Noto Sans KR'), url('file:///mnt/c/Windows/Fonts/malgun.ttf'); }
@font-face { font-family: 'KR'; font-weight: 700; src: local('Noto Sans CJK KR Bold'), local('Noto Sans KR Bold'), url('file:///mnt/c/Windows/Fonts/malgunbd.ttf'); }
* { box-sizing: border-box; margin: 0; padding: 0; } body { font-family: 'KR', sans-serif; background: #fff; color: #111; }`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function policyHtml({ title, meta, articles }) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${FONT}
.doc { width: 1240px; padding: 90px 96px 80px; } h1 { font-size: 40px; font-weight: 700; } .meta { color: #555; font-size: 19px; margin: 14px 0 26px; padding-bottom: 26px; border-bottom: 3px solid #111; }
h2 { font-size: 23px; font-weight: 700; margin: 30px 0 10px; } p { font-size: 20px; line-height: 1.6; }
@page { size: A4; margin: 0; }</style></head><body><div class="doc"><h1>${esc(title)}</h1><div class="meta">${esc(meta)}</div>
${articles.map(([h, p]) => `<h2>${esc(h)}</h2><p>${esc(p)}</p>`).join('\n')}</div></body></html>`;
}

// 판독이 쉬운 평면 표: 큰 글자, 검은 선, 그림자·그라데이션 없음
export function tableHtml({ title, head, rows }) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${FONT}
.wrap { display: inline-block; padding: 36px 40px; background: #fff; } .t { font-size: 26px; font-weight: 700; margin-bottom: 20px; }
table { border-collapse: collapse; font-size: 28px; } th, td { border: 2px solid #111; padding: 14px 26px; text-align: left; white-space: nowrap; }
th { background: #e6e6e6; font-weight: 700; } td.mono { font-family: 'DejaVu Sans Mono', 'Consolas', monospace; letter-spacing: 0.5px; }</style></head>
<body><div class="wrap"><div class="t">${esc(title)}</div><table><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>
${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i > 0 && i < 4 ? 'mono' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('\n')}</table></div></body></html>`;
}

function loadChromium() {
  const base = process.env.PLAYWRIGHT_CORE_DIR;
  const req = createRequire(base ? path.join(base, 'noop.js') : import.meta.url);
  try {
    return req('playwright-core').chromium;
  } catch {
    throw new Error('playwright-core를 찾지 못했습니다. 스크래치 폴더에 설치하고 PLAYWRIGHT_CORE_DIR로 알려 주세요(render-assets.mjs 머리말 참고).');
  }
}

// jobs: [{ html, pdf?: 경로, png?: 경로, selector }]
export async function render(jobs) {
  const chromium = loadChromium();
  const env = { ...process.env, LD_LIBRARY_PATH: [process.env.PW_LIBS, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') };
  const browser = await chromium.launch({ env });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exam-assets-'));
  try {
    const page = await browser.newPage({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 1 });
    for (const [i, job] of jobs.entries()) {
      const file = path.join(dir, `p${i}.html`);
      fs.writeFileSync(file, job.html);
      await page.goto('file://' + file);
      await page.evaluate(() => document.fonts.ready);
      if (job.pdf) await page.pdf({ path: job.pdf, format: 'A4', printBackground: true, preferCSSPageSize: true, scale: 0.64 });
      if (job.png) await page.locator(job.selector).screenshot({ path: job.png });
    }
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
