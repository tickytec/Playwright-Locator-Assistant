// sidebar.js — Elements-panel sidebar: locator for the inspected node ($0).
//
// Two-step evaluation: $0 only exists in the page's main world, while the
// engine lives in the content-script world. We mark $0 with an attribute in
// the main world, then analyze the marked element from the content-script
// world and remove the marker.
(() => {
    const $ = (id) => document.getElementById(id);
    const MARK = 'data-pw-devtools-selected';
    let framework = 'pytest';
    let testIdAttribute = 'data-testid';
    let exactMode = 'always';
    let last = null;

    chrome.storage.local.get(['selectedFramework', 'testIdAttribute', 'exactMode'], (r) => {
        framework = r.selectedFramework || 'pytest';
        testIdAttribute = r.testIdAttribute || 'data-testid';
        exactMode = r.exactMode || 'always';
        $('framework').value = framework;
        refresh();
    });

    $('framework').addEventListener('change', () => {
        framework = $('framework').value;
        chrome.storage.local.set({ selectedFramework: framework });
        refresh();
    });

    const evalIn = (expr, options) => new Promise((resolve, reject) => {
        chrome.devtools.inspectedWindow.eval(expr, options || {}, (result, info) => {
            if (info && (info.isException || info.isError)) reject(new Error(info.value || info.description || info.code || 'eval failed'));
            else resolve(result);
        });
    });

    async function refresh() {
        try {
            const marked = await evalIn(`(() => { document.querySelectorAll('[${MARK}]').forEach(e => e.removeAttribute('${MARK}')); if (!$0 || $0.nodeType !== 1) return false; $0.setAttribute('${MARK}', ''); return true; })()`);
            if (!marked) return show(null);
            const analysis = await evalIn(`(() => {
                const core = window.PWLocatorCore;
                const el = core && core.deepQuerySelector('[${MARK}]');
                if (!el) return { error: 'Extension not loaded on this page — reload it.' };
                el.removeAttribute('${MARK}');
                const r = core.analyzeElement(el, ${JSON.stringify(framework)}, { testIdAttribute: ${JSON.stringify(testIdAttribute)}, exactMode: ${JSON.stringify(exactMode)} });
                return { locator: r.locator, count: r.count, stability: r.stability, column: r.column, action: r.action, assertion: r.assertion,
                         alternatives: r.alternatives.map(a => ({ locator: a.locator, label: a.label, count: a.count })) };
            })()`, { useContentScriptContext: true });
            show(analysis);
        } catch (err) {
            show({ error: err.message });
        }
    }

    function show(result) {
        last = result;
        $('empty').hidden = !!result;
        $('result').hidden = !result || !!result.error;
        $('error').hidden = !(result && result.error);
        if (!result) return;
        if (result.error) { $('error').textContent = result.error; return; }
        $('locator').textContent = result.locator;
        const count = $('count');
        count.textContent = result.count === 1 ? '✓ 1' : result.count === 0 ? '✗ 0' : `⚠ ${result.count}`;
        count.className = `count ${result.count === 1 ? 'ok' : result.count === 0 ? 'zero' : 'many'}`;
        const stab = $('stability');
        stab.textContent = result.stability || '';
        stab.className = `stab ${result.stability || ''}`;
        $('column').hidden = !result.column;
        $('column').textContent = result.column ? `Column "${result.column}" — the index breaks if columns are reordered.` : '';
        $('action').textContent = result.action || '';
        $('action').hidden = !result.action;
        $('assertion').textContent = result.assertion || '';
        $('assertion').hidden = !result.assertion;
        $('copyAction').hidden = !result.action;
        $('copyAssert').hidden = !result.assertion;
        const alts = $('alternatives');
        alts.textContent = '';
        $('altSummary').textContent = `${result.alternatives.length} alternative${result.alternatives.length === 1 ? '' : 's'}`;
        for (const a of result.alternatives) {
            const row = document.createElement('div');
            row.className = 'alt';
            const lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = a.label;
            const code = document.createElement('code'); code.textContent = a.locator;
            const c = document.createElement('span'); c.className = `count ${a.count === 1 ? 'ok' : a.count === 0 ? 'zero' : 'many'}`; c.textContent = a.count === 1 ? '✓ 1' : a.count === 0 ? '✗ 0' : `⚠ ${a.count}`;
            const btn = document.createElement('button'); btn.textContent = 'Copy'; btn.onclick = () => copy(btn, stripNote(a.locator));
            row.append(lbl, code, c, btn);
            alts.appendChild(row);
        }
    }

    const stripNote = (s) => (window.PWLocatorCore ? window.PWLocatorCore.stripNote(s) : String(s).replace(/\s+(#|\/\/)\s.*$/s, ''));

    function copy(btn, text) {
        navigator.clipboard.writeText(text).then(() => {
            const prev = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = prev; }, 1200);
        });
    }

    $('copy').onclick = () => last && copy($('copy'), stripNote(last.locator));
    $('copyAction').onclick = () => last && copy($('copyAction'), last.action);
    $('copyAssert').onclick = () => last && copy($('copyAssert'), last.assertion);

    chrome.devtools.panels.elements.onSelectionChanged.addListener(refresh);
})();
