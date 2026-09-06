// End-to-end: load the unpacked extension in Chromium and drive the real
// content script through the extension's service worker — the same
// chrome.scripting path the popup and the keyboard shortcut use. (Content
// scripts live in an isolated world, so page.evaluate cannot reach them.)
const { test, expect, chromium } = require('@playwright/test');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { ROOT, startServer, toLocator, stripNote } = require('./helpers');

test.describe.configure({ mode: 'serial' });

let server;
let context;
let sw;

const EXTENSION_FILES = ['manifest.json', 'background.js', 'content.js', 'locator-core.js', 'popup.html', 'popup.js', 'styles.css', 'devtools.html', 'devtools.js', 'sidebar.html', 'sidebar.js', 'icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png'];

// Chrome trims whitespace around --load-extension paths, so a checkout whose
// directory name contains spaces cannot be loaded in place. Copy it.
function stageExtension() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-locator-ext-src-'));
    for (const rel of EXTENSION_FILES) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.copyFileSync(path.join(ROOT, rel), path.join(dir, rel));
    }
    return dir;
}

test.beforeAll(async () => {
    server = await startServer();
    const extensionDir = stageExtension();
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-locator-ext-'));
    context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chromium',
        headless: true,
        args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
    });
    sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
});

test.afterAll(async () => {
    await context?.close();
    await server.close();
});

async function tabIdOf(page) {
    return sw.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((t) => t.url === url);
        if (!tab) throw new Error(`no tab for ${url}`);
        return tab.id;
    }, page.url());
}

// Runs a named operation inside the content-script world of every frame of
// the tab (the extension CSP forbids eval there, so operations are real
// functions defined inside the service worker call). Returns [{ frameId, result }].
async function inFrames(page, op, ...args) {
    const tabId = await tabIdOf(page);
    return sw.evaluate(async ([tabId, op, args]) => {
        const ops = {
            typeofToggle: () => typeof window.__pwTogglePicking,
            info: () => [typeof window.PWLocatorCore, typeof window.__pwTogglePicking, location.pathname],
            toggle: (fw, shortcut) => (window.__pwTogglePicking ? window.__pwTogglePicking(fw, shortcut) : 'missing'),
            verify: (selector) => window.findAndHighlight(selector),
            record: (on, fresh) => (window.__pwRecording ? window.__pwRecording(on, fresh) : 'missing'),
        };
        const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: ops[op], args });
        return results.map((r) => ({ frameId: r.frameId, result: r.result }));
    }, [tabId, op, args]);
}

const topResult = (results) => results.find((r) => r.frameId === 0).result;

async function togglePicking(page, framework, fromShortcut = false) {
    return inFrames(page, 'toggle', framework, fromShortcut);
}

async function openApp() {
    const page = await context.newPage();
    await page.goto(`${server.baseURL}/app.html`);
    await expect.poll(async () => topResult(await inFrames(page, 'typeofToggle'))).toBe('function');
    return page;
}

test('content script is injected in the top frame and in the iframe', async () => {
    const page = await openApp();
    const results = await inFrames(page, 'info');
    expect(results.length).toBe(2);
    for (const r of results) expect(r.result.slice(0, 2)).toEqual(['object', 'function']);
    await page.close();
});

test('picking mode: click captures the element, shows the overlay and stops the page handler', async () => {
    const page = await openApp();
    await page.evaluate(() => {
        window.__clicked = 0;
        document.querySelector('[data-pick="save-a"]').addEventListener('click', () => { window.__clicked++; });
    });
    expect(topResult(await togglePicking(page, 'js'))).toBe('enabled');
    await expect(page.locator('[data-pw-ui="badge"]')).toBeVisible();

    await page.locator('[data-pick="save-a"]').click();

    const overlay = page.locator('[data-pw-ui="overlay"]');
    await expect(overlay).toBeVisible();
    const text = await overlay.locator('code').first().textContent();
    expect(text).toBe('page.locator("#card-a").getByRole("button", { name: "Save", exact: true })');
    await expect(overlay.getByText('✓ 1').first()).toBeVisible();
    expect(await page.evaluate(() => window.__clicked)).toBe(0);
    await expect(page.locator('[data-pw-ui="badge"]')).toHaveCount(0);

    // The picked element is highlighted, and Close restores it.
    expect(await page.locator('[data-pick="save-a"]').getAttribute('data-pw-verifier-highlight')).toBe('true');
    await overlay.getByRole('button', { name: 'Close' }).click();
    await expect(overlay).toHaveCount(0);
    expect(await page.locator('[data-pick="save-a"]').getAttribute('data-pw-verifier-highlight')).toBeNull();

    // Storage: history and last locator were written by the content script.
    const stored = await sw.evaluate(() => chrome.storage.local.get(['locatorHistory', 'lastGeneratedLocator']));
    expect(stored.lastGeneratedLocator).toBe(text);
    expect(stored.locatorHistory[0]).toBe(text);
    await page.close();
});

test('Escape cancels picking mode', async () => {
    const page = await openApp();
    await togglePicking(page, 'js');
    await expect(page.locator('[data-pw-ui="badge"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-pw-ui="badge"]')).toHaveCount(0);
    await page.close();
});

test('picking inside an iframe shows a contentFrame() locator in the top-frame overlay', async () => {
    const page = await openApp();
    const states = await togglePicking(page, 'js');
    expect(states.map((s) => s.result).sort()).toEqual(['enabled', 'enabled']);

    await page.frameLocator('#child-frame').getByRole('button', { name: 'Pay now' }).click();

    const overlay = page.locator('[data-pw-ui="overlay"]');
    await expect(overlay).toBeVisible();
    const text = await overlay.locator('code').first().textContent();
    expect(text).toBe('page.getByTitle("Payment frame", { exact: true }).contentFrame().getByRole("button", { name: "Pay now", exact: true })');
    await expect(toLocator(page, stripNote(text))).toHaveCount(1);
    // Picking mode ended in the top frame too (relayed by the service worker).
    await expect(page.locator('[data-pw-ui="badge"]')).toHaveCount(0);
    await page.close();
});

test('shortcut path captures the element under the cursor without a click', async () => {
    const page = await openApp();
    await page.locator('[data-pick="testid"]').scrollIntoViewIfNeeded();
    const box = await page.locator('[data-pick="testid"]').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const states = await togglePicking(page, 'pytest', true);
    expect(topResult(states)).toBe('captured');
    // The iframe never saw the pointer, so it must stay idle rather than enter picking mode.
    expect(states.find((s) => s.frameId !== 0).result).toBe('idle');
    const text = await page.locator('[data-pw-ui="overlay"] code').first().textContent();
    expect(text).toBe('page.get_by_test_id("checkout")');
    await page.close();
});

test('shadow DOM element is picked directly, not its host', async () => {
    const page = await openApp();
    await togglePicking(page, 'js');
    await page.locator('my-widget').getByRole('button', { name: 'Shadow save' }).click();
    const text = await page.locator('[data-pw-ui="overlay"] code').first().textContent();
    expect(text).toBe('page.getByRole("button", { name: "Shadow save", exact: true })');
    await page.close();
});

test('verifier entry point highlights matches from the popup path', async () => {
    const page = await openApp();
    const results = await inFrames(page, 'verify', 'page.getByRole("button", { name: "Edit" })');
    expect(topResult(results)).toEqual({ count: 3, error: null });
    await expect(page.locator('[data-pw-verifier-highlight]')).toHaveCount(3);
    await page.close();
});

test('overlay offers action/assert copies, stability tag and page-object add', async () => {
    const page = await openApp();
    await sw.evaluate(() => chrome.storage.local.set({ pageObject: { className: 'AppPage', entries: [] }, selectedFramework: 'js' }));
    await togglePicking(page, 'js');
    await page.locator('[data-pick="email"]').click();
    const overlay = page.locator('[data-pw-ui="overlay"]');
    await expect(overlay).toBeVisible();
    await expect(overlay.getByRole('button', { name: 'Copy action' })).toBeVisible();
    await expect(overlay.getByRole('button', { name: 'Copy assert' })).toBeVisible();
    await expect(overlay.locator('[data-pw-stability]').first()).toHaveText('strong');
    await overlay.locator('[data-pw-ui="add-page-object"]').click();
    await expect.poll(async () => (await sw.evaluate(() => chrome.storage.local.get('pageObject'))).pageObject.entries.length).toBe(1);
    const po = (await sw.evaluate(() => chrome.storage.local.get('pageObject'))).pageObject;
    expect(po.entries[0]).toMatchObject({ name: 'emailAddressInput', locator: 'page.getByLabel("Email address", { exact: true })' });
    await page.close();
});

test('recording mode turns interactions into steps', async () => {
    const page = await openApp();
    await sw.evaluate(() => chrome.storage.local.set({ recording: { active: false, url: '', steps: [] } }));
    const states = await inFrames(page, 'record', true, true);
    expect(topResult(states)).toBe('recording');
    await expect(page.locator('[data-pw-ui="recording"]')).toBeVisible();

    await page.locator('[data-pick="email"]').fill('a@b.c');
    await page.locator('[data-pick="email"]').blur();
    await page.locator('[data-pick="country"]').selectOption('Spain');
    await page.locator('[data-pick="newsletter"]').check();
    await page.locator('[data-pick="save-a"]').click();

    await expect.poll(async () => JSON.stringify((await sw.evaluate(() => chrome.storage.local.get('recording'))).recording.steps.map((s) => [s.action.kind, s.action.value, s.locator])), 'recorded steps').toBe(JSON.stringify([
        ['fill', 'a@b.c', 'page.getByLabel("Email address", { exact: true })'],
        ['select', 'Spain', 'page.getByLabel("Country", { exact: true })'],
        ['check', undefined, 'page.getByLabel("Subscribe to newsletter", { exact: true })'],
        ['click', undefined, 'page.locator("#card-a").getByRole("button", { name: "Save", exact: true })'],
    ]));
    await expect(page.locator('[data-pw-rec-count]')).toHaveAttribute('data-pw-rec-count', '4');
    const rec = (await sw.evaluate(() => chrome.storage.local.get('recording'))).recording;
    expect(rec.steps.map((s) => [s.locator, s.action.kind, s.action.value])).toEqual([
        ['page.getByLabel("Email address", { exact: true })', 'fill', 'a@b.c'],
        ['page.getByLabel("Country", { exact: true })', 'select', 'Spain'],
        ['page.getByLabel("Subscribe to newsletter", { exact: true })', 'check', undefined],
        ['page.locator("#card-a").getByRole("button", { name: "Save", exact: true })', 'click', undefined],
    ]);

    await page.locator('[data-pw-ui="stop-recording"]').click();
    await expect(page.locator('[data-pw-ui="recording"]')).toHaveCount(0);
    expect((await sw.evaluate(() => chrome.storage.local.get('recording'))).recording.active).toBe(false);
    await page.close();
});

test('keyboard-only picking: Tab focuses, Enter captures', async () => {
    const page = await openApp();
    await togglePicking(page, 'js');
    await page.locator('[data-pick="nav-home"]').focus();
    await page.keyboard.press('Tab');           // → Products link
    await page.keyboard.press('Enter');
    const text = await page.locator('[data-pw-ui="overlay"] code').first().textContent();
    expect(text).toBe('page.getByRole("link", { name: "Products", exact: true })');
    await page.close();
});

test('recording captures Enter presses and navigation between pages', async () => {
    const page = await openApp();
    await sw.evaluate(() => chrome.storage.local.set({ recording: { active: false, url: '', steps: [] } }));
    await inFrames(page, 'record', true, true);
    await page.locator('[data-pick="quick-search"]').fill('shoes');
    await page.locator('[data-pick="quick-search"]').press('Enter');
    await expect.poll(async () => (await sw.evaluate(() => chrome.storage.local.get('recording'))).recording.steps.length).toBe(2);

    await page.goto(`${server.baseURL}/frame.html`);
    await expect(page.locator('[data-pw-ui="recording"]')).toBeVisible();   // resumed after navigation
    await page.getByRole('button', { name: 'Pay now' }).click();
    await expect.poll(async () => (await sw.evaluate(() => chrome.storage.local.get('recording'))).recording.steps.length).toBe(4);
    const rec = (await sw.evaluate(() => chrome.storage.local.get('recording'))).recording;
    expect(rec.steps.map((s) => [s.action.kind, s.action.value, s.locator])).toEqual([
        ['fill', 'shoes', 'page.getByPlaceholder("Quick search", { exact: true })'],
        ['press', 'Enter', 'page.getByPlaceholder("Quick search", { exact: true })'],
        ['goto', `${server.baseURL}/frame.html`, ''],
        ['click', undefined, 'page.getByRole("button", { name: "Pay now", exact: true })'],
    ]);
    await inFrames(page, 'record', false, false);
    await page.close();
});

test('popup: history counts, bulk verify, page object and recording sections render against the active page', async () => {
    const app = await openApp();
    await sw.evaluate(() => chrome.storage.local.set({
        selectedFramework: 'js',
        locatorHistory: ['page.getByRole("button", { name: "Save" })', 'page.getByTestId("checkout")', 'page.getByText("Nope")'],
        pageObject: { className: 'Dashboard', entries: [{ id: 1, name: 'checkoutButton', locator: 'page.getByTestId("checkout")' }] },
        recording: { active: false, url: 'http://x/', steps: [{ locator: 'page.getByTestId("checkout")', action: { kind: 'click' } }] },
    }));
    const extId = new URL(sw.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html`);

    // History re-verified against the app tab (the popup itself is not scriptable).
    const entries = popup.locator('.history-entry');
    await expect(entries).toHaveCount(3);
    await expect(entries.nth(0).locator('.count')).toHaveText('⚠ 3');   // Save, Save, Shadow save (substring match)
    await expect(entries.nth(1).locator('.count')).toHaveText('✓ 1');
    await expect(entries.nth(2).locator('.count')).toHaveText('✗ 0');

    // Bulk verify.
    await popup.locator('#locatorInput').fill([
        'await page.getByRole("heading", { name: "Dashboard" }).click();',
        'page.getByLabel("Email address")',
        'page.getByText("Nothing here")',
    ].join('\n'));
    await popup.getByRole('button', { name: 'Check on page' }).click();
    await expect(popup.locator('#message')).toContainText('3 locators checked — 2 unique, 1 missing');
    await expect(popup.locator('.bulk-row')).toHaveCount(3);
    await expect(app.locator('[data-pw-verifier-highlight]')).toHaveCount(2);

    // Page object and recording render in the selected language.
    await expect(popup.locator('#pageObjectName')).toHaveValue('Dashboard');
    await expect(popup.locator('#pageObjectList .po-name')).toHaveValue('checkoutButton');
    await expect(popup.locator('#recordingList code')).toHaveText('await page.getByTestId("checkout").click();');
    await popup.locator('#framework').selectOption('pytest');
    await expect(popup.locator('#recordingList code')).toHaveText('page.get_by_test_id("checkout").click()');

    // Settings persist.
    await popup.locator('#exactMode').selectOption('needed');
    await expect.poll(async () => (await sw.evaluate(() => chrome.storage.local.get('exactMode'))).exactMode).toBe('needed');
    await sw.evaluate(() => chrome.storage.local.set({ exactMode: 'always', selectedFramework: 'js' }));
    await popup.close();
    await app.close();
});
