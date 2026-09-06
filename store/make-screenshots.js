// Produces Chrome Web Store screenshots (1280×800 JPEG, no alpha) from the
// real extension: `npm run screenshots` → store/screenshots/*.jpg
const { chromium } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'screenshots');
const FILES = ['manifest.json', 'background.js', 'content.js', 'locator-core.js', 'popup.html', 'popup.js', 'styles.css', 'devtools.html', 'devtools.js', 'sidebar.html', 'sidebar.js', 'icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png', 'icons/icon128.png'];
const W = 1280, H = 800;

function serve(dir) {
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const file = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
            if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
            res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
            fs.createReadStream(file).pipe(res);
        });
        server.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
    });
}

function stage() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-locator-store-'));
    for (const rel of FILES) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.copyFileSync(path.join(ROOT, rel), path.join(dir, rel));
    }
    return dir;
}

// Composition: caption on the left, a captured image on the right, on a quiet gradient.
function compose({ title, subtitle, image, imageWidth, align = 'right' }) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;width:${W}px;height:${H}px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",Inter,Roboto,sans-serif;color:#0f172a;
        background:radial-gradient(1200px 700px at 85% 10%,#dbe7ff 0%,rgba(219,231,255,0) 60%),linear-gradient(180deg,#f8fafc,#eef2f7);}
      .wrap{position:absolute;inset:0;display:flex;align-items:center;padding:0 72px;gap:56px;flex-direction:${align === 'right' ? 'row' : 'row-reverse'}}
      .text{flex:1;max-width:460px}
      .brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:15px;color:#334155;margin-bottom:26px}
      .brand img{width:26px;height:26px;border-radius:7px}
      h1{font-size:40px;line-height:1.1;letter-spacing:-0.025em;margin:0 0 16px;text-wrap:balance}
      p{font-size:18px;line-height:1.5;color:#475569;margin:0}
      .shot{flex:0 0 auto;width:${imageWidth}px;max-height:720px;border-radius:14px;box-shadow:0 2px 6px rgba(15,23,42,.10),0 40px 80px -24px rgba(15,23,42,.35);overflow:hidden;background:#fff;border:1px solid rgba(15,23,42,.08);position:relative}
      .shot img{display:block;width:100%}
      .shot::after{content:"";position:absolute;left:0;right:0;bottom:0;height:90px;background:linear-gradient(rgba(255,255,255,0),#fff);pointer-events:none}
    </style></head><body><div class="wrap">
      <div class="text"><div class="brand"><img src="${iconData()}">Playwright Locator Assistant</div><h1>${title}</h1><p>${subtitle}</p></div>
      <div class="shot"><img src="${image}"></div>
    </div></body></html>`;
}

const iconData = () => `data:image/png;base64,${fs.readFileSync(path.join(ROOT, 'icons/icon128.png')).toString('base64')}`;
const dataUri = (buf) => `data:image/png;base64,${buf.toString('base64')}`;

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const site = await serve(ROOT);
    const ext = stage();
    const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-locator-store-udd-')), {
        channel: 'chromium', headless: true, viewport: { width: W, height: H }, deviceScaleFactor: 1,
        args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    const extId = new URL(sw.url()).host;
    const tabIdOf = (page) => sw.evaluate(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url).id, page.url());
    const inTab = (page, func, ...args) => tabIdOf(page).then((tabId) => sw.evaluate(async ([tabId, src, args]) => {
        const fn = new Function(`return (${src})`)();
        const r = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: fn, args });
        return r.map((x) => x.result);
    }, [tabId, func.toString(), args]));
    const save = async (page, name) => { await page.screenshot({ path: path.join(OUT, name), type: 'jpeg', quality: 92 }); console.log('wrote', name); };
    const composeShot = async (name, opts) => { const p = await ctx.newPage(); await p.setContent(compose(opts)); await p.waitForTimeout(150); await save(p, name); await p.close(); };

    await sw.evaluate(() => chrome.storage.local.set({ selectedFramework: 'js', exactMode: 'always', testIdAttribute: 'data-testid', overlayPos: null, locatorHistory: [], pageObject: { className: 'OrdersPage', entries: [] }, recording: { active: false, url: '', steps: [] } }));

    // 1 — overlay on the demo page
    const demo = await ctx.newPage();
    await demo.goto(`${site.base}/store/demo.html`);
    await demo.waitForTimeout(400);
    await inTab(demo, () => window.__pwTogglePicking('js', false));
    await demo.getByRole('cell', { name: 'Toms Spezialitäten' }).click();
    await demo.locator('[data-pw-ui="overlay"]').waitFor();
    await demo.locator('[data-pw-ui="overlay"] button', { hasText: 'alternative' }).click();
    await demo.waitForTimeout(250);
    await save(demo, '01-overlay.jpg');

    // Collect a few more picks for history / page object
    for (const pick of [
        () => demo.getByLabel('Customer email').click(),
        () => demo.getByRole('button', { name: 'New order' }).click(),
        () => demo.getByRole('row').filter({ hasText: 'Hanari Carnes' }).first().getByRole('cell').nth(3).click(),
    ]) {
        await inTab(demo, () => window.__pwTogglePicking('js', false));
        await pick();
        await demo.locator('[data-pw-ui="overlay"]').waitFor();
        await demo.locator('[data-pw-ui="add-page-object"]').click();
    }
    await inTab(demo, () => window.__pwTogglePicking('js', false));
    await demo.getByRole('row').filter({ hasText: 'Toms Spezialitäten' }).getByRole('button', { name: 'Edit' }).click();
    await demo.locator('[data-pw-ui="overlay"]').waitFor();
    await demo.locator('[data-pw-ui="add-page-object"]').click();
    await demo.waitForTimeout(200);

    // 2 — popup with result, settings, history
    const popup = await ctx.newPage();
    await popup.setViewportSize({ width: 400, height: 900 });
    await demo.bringToFront();
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    await popup.locator('.history-entry .count').first().waitFor();
    await popup.waitForTimeout(300);
    const clip = async (sel) => popup.locator(sel).screenshot({ type: 'png', scale: 'device' });
    await popup.evaluate(() => {
        document.getElementById('recordingSection').hidden = true;
        document.getElementById('pageObjectSection').hidden = true;
        document.querySelectorAll('.history-entry').forEach((e, i) => { if (i > 2) e.remove(); });
    });
    await composeShot('02-popup.jpg', {
        title: 'The locator Playwright would choose, verified on the live page',
        subtitle: 'Role, label, test id, text, scoped chains — the first unique strategy wins. Recent locators are re-checked every time you open the popup.',
        image: dataUri(await clip('body')), imageWidth: 400,
    });
    await popup.evaluate(() => { document.getElementById('recordingSection').hidden = false; document.getElementById('pageObjectSection').hidden = false; });

    // 3 — bulk verify
    await popup.evaluate(() => { document.getElementById('historySection').hidden = true; document.getElementById('recordingSection').hidden = true; document.getElementById('pageObjectSection').hidden = true; document.querySelector('section').hidden = true; });
    await popup.locator('#locatorInput').fill([
        'await page.getByRole("button", { name: "New order" }).click();',
        'await page.getByLabel("Customer email").fill("anna@northwind.io");',
        'await page.getByRole("row").filter({ hasText: "Hanari Carnes" }).getByRole("button", { name: "Edit" }).click();',
        'await expect(page.getByText("Order created")).toBeVisible();',
    ].join('\n'));
    await popup.getByRole('button', { name: 'Check on page' }).click();
    await popup.locator('.bulk-row').first().waitFor();
    await popup.evaluate(() => { document.getElementById('locatorInput').scrollTop = 0; });
    await popup.waitForTimeout(200);
    await composeShot('03-verify.jpg', {
        title: 'Paste a whole test. Every locator checked at once.',
        subtitle: 'JS and Python syntax, await and expect() wrappers, filter(), nth(), frameLocator(), CSS and XPath. Matches are highlighted on the page; parse errors are named, not hidden as “0 matches”.',
        image: dataUri(await clip('body')), imageWidth: 400,
    });

    // 4 — recording + page object
    await sw.evaluate(() => chrome.storage.local.set({
        recording: { active: false, url: 'https://northwind.example/orders', steps: [
            { locator: 'page.getByLabel("Customer email", { exact: true })', action: { kind: 'fill', value: 'anna@northwind.io' } },
            { locator: 'page.getByLabel("Currency", { exact: true })', action: { kind: 'select', value: 'GBP' } },
            { locator: 'page.getByLabel("Send a copy to me", { exact: true })', action: { kind: 'check' } },
            { locator: 'page.getByRole("button", { name: "Create invoice", exact: true })', action: { kind: 'click' } },
        ] },
    }));
    await popup.evaluate(() => { document.querySelector('section').hidden = false; });
    await popup.locator('#framework').selectOption('pytest');
    await popup.evaluate(() => {
        document.getElementById('historySection').hidden = true; document.getElementById('recordingSection').hidden = false; document.getElementById('pageObjectSection').hidden = false;
        document.querySelector('section').hidden = true; document.querySelectorAll('section')[1].hidden = true;
        document.querySelector('#recordingSection .hint').hidden = true;
        document.querySelectorAll('#pageObjectList .step').forEach((e, i) => { if (i > 2) e.remove(); });
    });
    await popup.waitForTimeout(250);
    await composeShot('04-record-pageobject.jpg', {
        title: 'Record a flow. Build a page object. Copy the class.',
        subtitle: 'Clicks, typed values, selections and navigations become steps with the generated locators. Collected elements become a class in Python, TypeScript, Java or C#.',
        image: dataUri(await clip('body')), imageWidth: 400,
    });

    // 5 — DevTools sidebar (rendered from sidebar.html with real analysis data)
    const side = await ctx.newPage();
    await side.setViewportSize({ width: 420, height: 420 });
    const analysis = await inTab(demo, () => {
        const el = document.querySelector('tbody tr:nth-child(3) button');
        const r = window.PWLocatorCore.analyzeElement(el, 'js');
        return { locator: r.locator, count: r.count, stability: r.stability, column: r.column, action: r.action, assertion: r.assertion, alternatives: r.alternatives.slice(0, 3).map((a) => ({ locator: a.locator, label: a.label, count: a.count })) };
    }).then((r) => r[0]);
    await side.goto(`${site.base}/sidebar.html`);
    await side.evaluate((r) => {
        const $ = (id) => document.getElementById(id);
        $('empty').hidden = true; $('result').hidden = false;
        $('locator').textContent = r.locator;
        $('count').textContent = '✓ 1'; $('count').className = 'count ok';
        $('stability').textContent = r.stability; $('stability').className = `stab ${r.stability}`;
        $('column').hidden = !r.column; $('column').textContent = r.column ? `Column "${r.column}" — the index breaks if columns are reordered.` : '';
        $('action').textContent = r.action; $('action').hidden = !r.action; $('copyAction').hidden = !r.action;
        $('assertion').textContent = r.assertion;
        $('framework').value = 'js';
        $('altSummary').textContent = `${r.alternatives.length} alternatives`;
        document.querySelector('details').open = true;
        for (const a of r.alternatives) {
            const row = document.createElement('div'); row.className = 'alt';
            row.innerHTML = `<span class="lbl"></span><code></code><span class="count ${a.count === 1 ? 'ok' : 'many'}">${a.count === 1 ? '✓ 1' : '⚠ ' + a.count}</span><button>Copy</button>`;
            row.querySelector('.lbl').textContent = a.label; row.querySelector('code').textContent = a.locator;
            $('alternatives').appendChild(row);
        }
    }, analysis);
    await side.waitForTimeout(200);
    await composeShot('05-devtools.jpg', {
        title: 'Right inside DevTools',
        subtitle: 'Select any node in the Elements panel and the Playwright Locator sidebar shows its locator, match count, stability, action and assertion — with alternatives.',
        image: dataUri(await side.screenshot({ type: 'png', scale: 'device', fullPage: true })), imageWidth: 420, align: 'left',
    });

    await ctx.close();
    site.close();
})().catch((e) => { console.error(e); process.exit(1); });
