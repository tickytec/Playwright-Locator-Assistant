// popup.js — extension popup. All page work goes through chrome.scripting so
// it works on tabs that were open before the extension was installed.
document.addEventListener('DOMContentLoaded', () => {
    const core = window.PWLocatorCore;
    const SCRIPTS = ['locator-core.js', 'content.js'];
    const $ = (id) => document.getElementById(id);

    const pickBtn = $('pickElementButton');
    const output = $('locatorOutput');
    const copyBtn = $('copyLocatorButton');
    const frameworkSelect = $('framework');
    const testIdSelect = $('testIdAttribute');
    const exactSelect = $('exactMode');
    const checkBtn = $('checkButton');
    const locatorInput = $('locatorInput');
    const message = $('message');
    const bulkResults = $('bulkResults');
    const historySection = $('historySection');
    const historyList = $('historyList');
    const clearHistoryBtn = $('clearHistoryBtn');
    const recordBtn = $('recordButton');
    const copyRecordingBtn = $('copyRecordingButton');
    const clearRecordingBtn = $('clearRecordingButton');
    const recordingList = $('recordingList');
    const poName = $('pageObjectName');
    const poList = $('pageObjectList');
    const copyPoBtn = $('copyPageObjectButton');
    const clearPoBtn = $('clearPageObjectButton');

    if (/mac/i.test(navigator.platform || navigator.userAgent)) $('pickShortcut').textContent = '⌘+Shift+L';

    let currentLocator = '';
    let selectedFramework = 'pytest';
    let recording = null;
    let pageObject = { className: 'AppPage', entries: [] };
    let history = [];

    const stripNote = core.stripNote;

    function setMessage(text, kind) {
        message.hidden = !text;
        message.textContent = text || '';
        message.className = `message ${kind || ''}`;
    }

    function showLocator(locator) {
        currentLocator = locator || '';
        output.textContent = currentLocator || 'Click "Pick element" to start.';
        copyBtn.hidden = !currentLocator;
    }

    function flash(btn, text, ms = 1500) {
        const original = btn.textContent;
        btn.textContent = text;
        setTimeout(() => { btn.textContent = original; }, ms);
    }

    const copy = (btn, text) => navigator.clipboard.writeText(text).then(() => flash(btn, 'Copied!'));

    function badge(count, error) {
        const b = document.createElement('span');
        b.className = `count ${error ? 'err' : count === 1 ? 'ok' : count === 0 ? 'zero' : 'many'}`;
        b.textContent = error ? '!' : count === 1 ? '✓ 1' : count === 0 ? '✗ 0' : `⚠ ${count}`;
        b.title = error || (count === 1 ? 'Unique on the current page' : count === 0 ? 'No match on the current page' : `${count} matches — not unique`);
        return b;
    }

    const injectable = (t) => !!t && !!t.url && /^(https?|file|ftp):/.test(t.url);

    async function activeTab() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (injectable(tab)) return tab;
        // The popup itself is the active tab when opened as a page (tests, pinned
        // tab): fall back to the most recently used web tab.
        const candidates = (await chrome.tabs.query({})).filter(injectable).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
        if (candidates[0]) return candidates[0];
        if (!tab) throw new Error('No active tab.');
        throw new Error('This page cannot be scripted (browser or extension page).');
    }

    // Inject into every frame; if one frame refuses (sandboxed / restricted),
    // fall back to the top frame so the page still works.
    async function ensureScripts(tabId) {
        try {
            await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: SCRIPTS });
        } catch (_) {
            await chrome.scripting.executeScript({ target: { tabId }, files: SCRIPTS });
        }
    }

    async function runInFrames(tabId, func, args, allFrames = true) {
        try {
            return await chrome.scripting.executeScript({ target: { tabId, allFrames }, func, args });
        } catch (_) {
            if (!allFrames) throw _;
            return chrome.scripting.executeScript({ target: { tabId }, func, args });
        }
    }

    // ---------------- settings & state ----------------
    chrome.storage.local.get(['lastGeneratedLocator', 'selectedFramework', 'testIdAttribute', 'exactMode', 'locatorHistory', 'recording', 'pageObject'], (r) => {
        showLocator(r.lastGeneratedLocator);
        selectedFramework = core.normalizeFramework(r.selectedFramework || 'pytest');
        frameworkSelect.value = selectedFramework;
        testIdSelect.value = r.testIdAttribute || 'data-testid';
        exactSelect.value = r.exactMode || 'always';
        history = r.locatorHistory || [];
        renderHistory();
        reverifyHistory();
        recording = r.recording || null;
        renderRecording();
        if (r.pageObject) pageObject = r.pageObject;
        poName.value = pageObject.className || 'AppPage';
        renderPageObject();
    });

    frameworkSelect.addEventListener('change', () => {
        selectedFramework = frameworkSelect.value;
        chrome.storage.local.set({ selectedFramework });
        renderRecording();
        renderPageObject();
    });
    testIdSelect.addEventListener('change', () => chrome.storage.local.set({ testIdAttribute: testIdSelect.value }));
    exactSelect.addEventListener('change', () => chrome.storage.local.set({ exactMode: exactSelect.value }));

    // ---------------- pick ----------------
    pickBtn.addEventListener('click', async () => {
        try {
            const tab = await activeTab();
            await ensureScripts(tab.id);
            const results = await runInFrames(tab.id, (fw) => (window.__pwTogglePicking ? window.__pwTogglePicking(fw, false) : 'missing'), [selectedFramework]);
            const states = results.map((r) => r && r.result);
            if (states.includes('enabled')) window.close();
            else if (states.includes('disabled')) output.textContent = 'Picking mode cancelled.';
            else output.textContent = 'Could not start picking on this page.';
        } catch (err) {
            output.textContent = `Error: ${err.message}`;
        }
    });

    copyBtn.addEventListener('click', () => { if (currentLocator) copy(copyBtn, stripNote(currentLocator)); });

    // ---------------- verify (single or bulk) ----------------
    async function verify() {
        const text = locatorInput.value.trim();
        bulkResults.hidden = true;
        bulkResults.textContent = '';
        if (!text) { setMessage('Enter a locator or selector first.', 'error'); return; }
        try {
            const tab = await activeTab();
            await ensureScripts(tab.id);
            const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
            if (lines.length === 1) {
                // Top frame only: page.getByRole(...) never searches inside iframes,
                // and frame-chained locators resolve into same-origin frames from here.
                const [top] = await runInFrames(tab.id, (sel) => (window.findAndHighlight ? window.findAndHighlight(sel) : { count: 0, error: 'not injected' }), [text], false);
                const { count = 0, error = null } = (top && top.result) || {};
                if (error) setMessage(`Could not parse: ${error}`, 'error');
                else if (count === 1) setMessage('Unique match — 1 element highlighted.', 'ok');
                else if (count > 1) setMessage(`${count} elements match — not unique. Highlighted on the page.`, 'warn');
                else setMessage('No element matches this locator on the current page.', 'warn');
                return;
            }
            const [top] = await runInFrames(tab.id, (src) => {
                const core = window.PWLocatorCore;
                core.clearHighlights();
                const results = core.countMany(src);
                core.highlight(results.flatMap((r) => r.elements));
                return results.map(({ input, count, error }) => ({ input, count, error }));
            }, [text], false);
            const results = (top && top.result) || [];
            if (!results.length) { setMessage('No locators found in the pasted text.', 'warn'); return; }
            const unique = results.filter((r) => r.count === 1).length;
            setMessage(`${results.length} locators checked — ${unique} unique, ${results.filter((r) => r.count === 0 && !r.error).length} missing, ${results.filter((r) => r.error).length} unparseable.`, unique === results.length ? 'ok' : 'warn');
            bulkResults.hidden = false;
            for (const r of results) {
                const row = document.createElement('div');
                row.className = 'bulk-row';
                const code = document.createElement('code');
                code.textContent = r.input;
                row.append(badge(r.count, r.error), code);
                bulkResults.appendChild(row);
            }
        } catch (err) {
            setMessage(`Error: ${err.message}`, 'error');
        }
    }

    checkBtn.addEventListener('click', verify);
    locatorInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !locatorInput.value.includes('\n')) { e.preventDefault(); verify(); } });

    // ---------------- history (with live re-verification) ----------------
    function renderHistory(counts = null) {
        historySection.hidden = !history.length;
        historyList.textContent = '';
        history.forEach((locator, i) => {
            const entry = document.createElement('div');
            entry.className = 'history-entry';
            if (counts && counts[i]) entry.appendChild(badge(counts[i].count, counts[i].error));

            const code = document.createElement('code');
            code.className = 'history-code';
            code.textContent = locator;
            code.title = 'Click to load into the verifier';
            code.addEventListener('click', () => { locatorInput.value = locator; verify(); });

            const btn = document.createElement('button');
            btn.className = 'btn history-copy';
            btn.textContent = 'Copy';
            btn.addEventListener('click', () => copy(btn, locator));

            entry.append(code, btn);
            historyList.appendChild(entry);
        });
    }

    async function reverifyHistory() {
        if (!history.length) return;
        try {
            const tab = await activeTab();
            await ensureScripts(tab.id);
            const [top] = await runInFrames(tab.id, (locs) => locs.map((l) => {
                try { return { count: window.PWLocatorCore.count(l), error: null }; } catch (e) { return { count: 0, error: e.message }; }
            }), [history], false);
            if (top && top.result) renderHistory(top.result);
        } catch (_) { /* restricted page: show history without counts */ }
    }

    clearHistoryBtn.addEventListener('click', () => {
        chrome.storage.local.set({ locatorHistory: [] });
    });

    // ---------------- recording ----------------
    function renderRecording() {
        const steps = (recording && recording.steps) || [];
        const active = !!(recording && recording.active);
        recordBtn.textContent = active ? 'Stop recording' : steps.length ? 'Resume recording' : 'Start recording';
        recordBtn.className = `btn ${active ? 'btn-danger-solid' : 'btn-danger'}`;
        copyRecordingBtn.hidden = !steps.length;
        clearRecordingBtn.hidden = !steps.length;
        recordingList.textContent = '';
        steps.forEach((s, i) => {
            const row = document.createElement('div');
            row.className = 'step';
            const n = document.createElement('span');
            n.className = 'step-n';
            n.textContent = String(i + 1);
            const code = document.createElement('code');
            code.textContent = core.renderAction(s.action, stripNote(core.translateLocator(s.locator, selectedFramework)), selectedFramework);
            row.append(n, code);
            recordingList.appendChild(row);
        });
    }

    recordBtn.addEventListener('click', async () => {
        try {
            const tab = await activeTab();
            await ensureScripts(tab.id);
            const active = !!(recording && recording.active);
            const fresh = !(recording && recording.steps && recording.steps.length);
            await runInFrames(tab.id, (on, fresh) => (window.__pwRecording ? window.__pwRecording(on, fresh) : 'missing'), [!active, fresh]);
            if (!active) window.close();
        } catch (err) {
            setMessage(`Error: ${err.message}`, 'error');
        }
    });

    copyRecordingBtn.addEventListener('click', () => {
        if (!recording) return;
        copy(copyRecordingBtn, core.renderRecording(recording.steps, selectedFramework, recording.url));
    });

    clearRecordingBtn.addEventListener('click', () => chrome.storage.local.set({ recording: { active: false, url: '', steps: [] } }));

    // ---------------- page object ----------------
    function renderPageObject() {
        const entries = pageObject.entries || [];
        poList.textContent = '';
        copyPoBtn.disabled = !entries.length;
        clearPoBtn.disabled = !entries.length;
        entries.forEach((e) => {
            const row = document.createElement('div');
            row.className = 'step';
            const name = document.createElement('input');
            name.type = 'text';
            name.className = 'po-name';
            name.value = e.name;
            name.setAttribute('aria-label', 'Member name');
            name.addEventListener('change', () => {
                e.name = name.value.trim() || e.name;
                chrome.storage.local.set({ pageObject });
            });
            const code = document.createElement('code');
            code.textContent = stripNote(core.translateLocator(e.locator, selectedFramework));
            const remove = document.createElement('button');
            remove.className = 'btn history-copy';
            remove.textContent = '×';
            remove.title = 'Remove';
            remove.addEventListener('click', () => {
                pageObject.entries = pageObject.entries.filter((x) => x !== e);
                chrome.storage.local.set({ pageObject });
            });
            row.append(name, code, remove);
            poList.appendChild(row);
        });
    }

    poName.addEventListener('change', () => {
        pageObject.className = poName.value.trim() || 'AppPage';
        chrome.storage.local.set({ pageObject });
    });
    copyPoBtn.addEventListener('click', () => copy(copyPoBtn, core.renderPageObject(pageObject.entries, selectedFramework, poName.value.trim() || 'AppPage')));
    clearPoBtn.addEventListener('click', () => chrome.storage.local.set({ pageObject: { className: pageObject.className, entries: [] } }));

    // ---------------- live updates ----------------
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.locatorHistory) { history = changes.locatorHistory.newValue || []; renderHistory(); reverifyHistory(); }
        if (changes.lastGeneratedLocator) showLocator(changes.lastGeneratedLocator.newValue);
        if (changes.recording) { recording = changes.recording.newValue || null; renderRecording(); }
        if (changes.pageObject) { pageObject = changes.pageObject.newValue || { className: 'AppPage', entries: [] }; renderPageObject(); }
    });
});
