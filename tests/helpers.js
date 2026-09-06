// Shared test helpers: static fixture server, core injection, and evaluation of
// generated locator strings with the real Playwright API.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');
const CORE_PATH = path.join(ROOT, 'locator-core.js');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

// Fixtures are served over http so that iframes are same-origin (file:// frames are not).
function startServer() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, 'http://localhost');
            const file = path.join(FIXTURES, url.pathname === '/' ? 'app.html' : url.pathname);
            if (!file.startsWith(FIXTURES) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
            fs.createReadStream(file).pipe(res);
        });
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ server, baseURL: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
        });
    });
}

async function injectCore(page) {
    for (const frame of page.frames()) await frame.addScriptTag({ path: CORE_PATH });
}

async function openFixture(page, baseURL, file = 'app.html') {
    await page.goto(`${baseURL}/${file}`);
    await page.waitForLoadState('load');
    await injectCore(page);
}

// In-page: deep lookup by data-pick (pierces shadow roots).
const findPickFn = `(pick) => {
    const find = (root) => {
        for (const el of root.querySelectorAll('*')) {
            if (el.getAttribute('data-pick') === pick) return el;
            if (el.shadowRoot) { const r = find(el.shadowRoot); if (r) return r; }
        }
        return null;
    };
    return find(document);
}`;

async function analyze(frame, pick, framework) {
    return frame.evaluate(([pick, fw, findSrc]) => {
        const el = eval(findSrc)(pick);
        if (!el) throw new Error(`fixture has no [data-pick="${pick}"]`);
        return window.PWLocatorCore.analyzeElement(el, fw);
    }, [pick, framework, findPickFn]);
}

async function coreResolvePicks(frame, locator) {
    return frame.evaluate((loc) => window.PWLocatorCore.resolve(loc).map((el) => el.getAttribute('data-pick') || el.tagName.toLowerCase()), locator);
}

async function coreCount(frame, locator) {
    return frame.evaluate((loc) => window.PWLocatorCore.count(loc), locator);
}

function stripNote(locator) {
    return String(locator).replace(/\s+(#|\/\/)\s.*$/s, '').trim();
}

// Turns a generated JS locator string into a real Playwright Locator.
function toLocator(page, locatorString) {
    const clean = stripNote(locatorString).replace(/\.selectOption\(.*\)$/s, '');
    // eslint-disable-next-line no-new-func
    return new Function('page', `return ${clean};`)(page);
}

module.exports = { ROOT, CORE_PATH, startServer, openFixture, injectCore, analyze, coreResolvePicks, coreCount, toLocator, stripNote };
