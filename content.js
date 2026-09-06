/*
 * content.js — page-side UI for the extension.
 *
 * Runs in every frame (manifest: all_frames). Responsibilities:
 *   - always-on cursor tracking so the keyboard shortcut knows what is under
 *     the pointer the instant it fires (dropdowns stay open, no click needed)
 *   - picking mode: hover/focus outline, click / Enter to capture, Esc to cancel
 *   - recording mode: clicks, fills and selections become test steps
 *   - the on-page result overlay (top frame only): uniqueness badge, stability,
 *     alternatives, copy locator / action / assertion, "{ }" variables,
 *     add-to-page-object, remembered position
 *   - frame plumbing: a sub-frame prefixes its locator with the parent chain
 *     (page.locator("iframe").contentFrame()) and hands the result to the top
 *     frame through the background service worker.
 *
 * All locator logic lives in locator-core.js (window.PWLocatorCore).
 */
(function () {
    'use strict';
    const core = window.PWLocatorCore;
    if (!core) return;

    const isTopFrame = (() => { try { return window.top === window; } catch (_) { return false; } })();

    // ------------------------------------------------------------------
    // Cursor tracking (idempotent, always on)
    // ------------------------------------------------------------------
    if (!window.__pwCursorTracking) {
        window.__pwCursorTracking = true;
        window.__pwMouseCoords = null;
        window.__pwHoveredEl = null;
        window.__pwLastInteractedSelect = null;

        document.addEventListener('mousemove', (e) => {
            window.__pwMouseCoords = { x: e.clientX, y: e.clientY };
        }, { capture: true, passive: true });
        document.addEventListener('mouseover', (e) => {
            window.__pwHoveredEl = e.composedPath()[0] || e.target;
        }, { capture: true, passive: true });
        // Pointer left this document (window edge or another frame): forget
        // stale coordinates so a shortcut fired elsewhere never captures here.
        document.addEventListener('mouseout', (e) => {
            if (!e.relatedTarget) { window.__pwMouseCoords = null; window.__pwHoveredEl = null; }
        }, { capture: true, passive: true });
        // Native <select> popups swallow keyboard events at the OS level, so
        // remember the last select the user touched and fall back to it.
        const rememberSelect = (e) => {
            const t = e.composedPath()[0] || e.target;
            if (t && t.tagName && t.tagName.toLowerCase() === 'select') window.__pwLastInteractedSelect = t;
        };
        document.addEventListener('mousedown', rememberSelect, { capture: true, passive: true });
        document.addEventListener('change', rememberSelect, { capture: true, passive: true });
    }

    // ------------------------------------------------------------------
    // Stateful part (guarded so re-injection is a no-op)
    // ------------------------------------------------------------------
    if (window.__playwrightLocatorAssistantLoaded) return;
    window.__playwrightLocatorAssistantLoaded = true;

    const HOVER_ATTR = 'data-pw-picking-hover';
    const PREV_OUTLINE = 'data-pw-picking-prev-outline';
    const Z = '2147483647';
    const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Inter,Roboto,sans-serif";
    const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,monospace";
    // One-Dark-ish palette for on-page UI (must read on any site background).
    const C = { bg: '#1f232b', bg2: '#2a2f39', hair: 'rgba(255,255,255,0.10)', text: '#e6e9ee', text2: '#aab2bf', text3: '#7f8896', accent: '#7aa2f7', ok: '#7ccf9a', warn: '#e6b451', bad: '#f0857a', purple: '#c792ea', amber: '#e0a458' };

    let isPickingMode = false;
    let isRecording = false;
    let hoveredElement = null;
    let badgeEl = null;
    let recBadgeEl = null;
    let overlayEl = null;

    const stripNote = core.stripNote;

    // Settings mirror (chrome.storage is async; capture must be sync).
    const settings = { framework: 'pytest', testIdAttribute: 'data-testid', exactMode: 'always', overlayPos: null };
    const applySettings = (r) => {
        if (r.selectedFramework) settings.framework = core.normalizeFramework(r.selectedFramework);
        if (r.testIdAttribute) settings.testIdAttribute = r.testIdAttribute;
        if (r.exactMode) settings.exactMode = r.exactMode;
        if ('overlayPos' in r) settings.overlayPos = r.overlayPos || null;
    };
    try {
        chrome.storage.local.get(['selectedFramework', 'testIdAttribute', 'exactMode', 'overlayPos'], applySettings);
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local') return;
            const r = {};
            for (const k of Object.keys(changes)) r[k] = changes[k].newValue;
            applySettings(r);
            if (changes.recording && !changes.recording.newValue?.active && isRecording) stopRecording(false);
        });
    } catch (_) { /* not in an extension context */ }

    const analyzeOptions = () => ({ testIdAttribute: settings.testIdAttribute, exactMode: settings.exactMode });

    // ---------------- hover outline ----------------
    function clearHoverHighlight() {
        if (!hoveredElement) return;
        hoveredElement.style.outline = hoveredElement.getAttribute(PREV_OUTLINE) || '';
        hoveredElement.removeAttribute(PREV_OUTLINE);
        hoveredElement.removeAttribute(HOVER_ATTR);
        hoveredElement = null;
    }

    function isOurUI(el) {
        return !!el && (el === badgeEl || el === recBadgeEl || (overlayEl && overlayEl.contains(el)) || (recBadgeEl && recBadgeEl.contains(el)));
    }

    function setHover(el) {
        if (el === hoveredElement) return;
        clearHoverHighlight();
        if (!el || el.nodeType !== 1 || isOurUI(el) || el === document.documentElement || el === document.body) return;
        hoveredElement = el;
        el.setAttribute(PREV_OUTLINE, el.style.outline || '');
        el.style.outline = '2px dashed #4299e1';
        el.setAttribute(HOVER_ATTR, 'true');
    }

    // ---------------- badges ----------------
    const b = (t, c) => { const s = document.createElement('b'); s.style.color = c; s.textContent = t; return s; };

    function pill(extra = '') {
        const el = document.createElement('div');
        el.style.cssText = `position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:${C.bg};color:${C.text2};padding:9px 16px;border-radius:999px;border:1px solid ${C.hair};font-family:${FONT};font-size:12.5px;line-height:1.3;z-index:${Z};box-shadow:0 2px 4px rgba(0,0,0,0.25),0 12px 32px -8px rgba(0,0,0,0.6);white-space:nowrap;display:flex;align-items:center;gap:6px;${extra}`;
        return el;
    }

    function showBadge() {
        if (badgeEl || !isTopFrame) return;
        badgeEl = pill('pointer-events:none;');
        badgeEl.setAttribute('data-pw-ui', 'badge');
        const dot = document.createElement('span');
        dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${C.accent};box-shadow:0 0 0 3px rgba(122,162,247,0.25);`;
        badgeEl.append(dot, b('Picking', C.text), ' — hover or Tab to an element, then ', b('click', C.text), ' or ', b('Enter', C.text), ' · ', b('Esc', C.bad), ' to cancel');
        document.documentElement.appendChild(badgeEl);
    }

    function hideBadge() {
        if (badgeEl) { badgeEl.remove(); badgeEl = null; }
    }

    function showRecBadge(stepCount) {
        if (!isTopFrame) return;
        if (!recBadgeEl) {
            recBadgeEl = pill('');
            recBadgeEl.setAttribute('data-pw-ui', 'recording');
            document.documentElement.appendChild(recBadgeEl);
        }
        recBadgeEl.textContent = '';
        const dot = document.createElement('span');
        dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${C.bad};box-shadow:0 0 0 3px rgba(240,133,122,0.25);display:inline-block;`;
        const count = document.createElement('span');
        count.setAttribute('data-pw-rec-count', String(stepCount));
        count.textContent = `Recording — ${stepCount} step${stepCount === 1 ? '' : 's'}`;
        const stop = button('Stop', C.bad, '#1a1010');
        stop.style.marginLeft = '6px';
        stop.setAttribute('data-pw-ui', 'stop-recording');
        stop.onclick = () => stopRecording(true);
        recBadgeEl.append(dot, count, stop);
    }

    function hideRecBadge() {
        if (recBadgeEl) { recBadgeEl.remove(); recBadgeEl = null; }
    }

    // ---------------- result overlay ----------------
    function hideOverlay() {
        if (overlayEl) {
            if (overlayEl.__pwCleanup) overlayEl.__pwCleanup();
            overlayEl.remove();
            overlayEl = null;
        }
        core.clearHighlights();
    }

    function button(label, bg, fg) {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.cssText = `background:${bg};color:${fg};border:1px solid ${bg === C.bg2 ? C.hair : 'transparent'};padding:0 11px;height:28px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;font-family:${FONT};line-height:1;white-space:nowrap;`;
        return btn;
    }

    function countBadge(count) {
        const ok = count === 1;
        const badge = document.createElement('span');
        badge.textContent = ok ? '✓ 1' : count === 0 ? '✗ 0' : `⚠ ${count}`;
        badge.title = ok ? 'Unique match' : count === 0 ? 'No element matches on this page' : `${count} elements match — not unique`;
        const tone = ok ? C.ok : count === 0 ? C.bad : C.warn;
        badge.style.cssText = `flex-shrink:0;display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;font-family:${FONT};font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;color:${tone};background:${tone}22;border:1px solid ${tone}55;cursor:default;`;
        return badge;
    }

    const STABILITY = {
        strong: [C.ok, 'Stable: developer-owned handle (test id, label, role + name)'],
        good: [C.warn, 'Depends on visible content — breaks if the copy changes'],
        fragile: [C.bad, 'Positional or styling-based — add a data-testid'],
    };

    function stabilityTag(stability) {
        const [color, title] = STABILITY[stability] || STABILITY.good;
        const tag = document.createElement('span');
        tag.setAttribute('data-pw-stability', stability);
        tag.textContent = stability;
        tag.title = title;
        tag.style.cssText = `flex-shrink:0;display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:999px;font-family:${FONT};font-size:10.5px;font-weight:600;letter-spacing:0.02em;color:${color};border:1px solid ${color}66;cursor:default;`;
        return tag;
    }

    function copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
        return new Promise((resolve, reject) => {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;opacity:0;';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand && document.execCommand('copy');
            ta.remove();
            ok ? resolve() : reject(new Error('copy failed'));
        });
    }

    function copyButton(label, bg, fg, getText) {
        const btn = button(label, bg, fg);
        btn.onclick = () => {
            const text = getText();
            if (!text) return;
            copyToClipboard(text).then(() => {
                const prev = btn.style.backgroundColor;
                btn.textContent = 'Copied!'; btn.style.backgroundColor = C.ok; btn.style.color = '#0b1a10';
                setTimeout(() => { btn.textContent = label; btn.style.backgroundColor = prev; btn.style.color = fg; }, 1500);
            }).catch(() => { btn.textContent = 'Select & copy manually'; });
        };
        return btn;
    }

    function saveOverlayPosition() {
        if (!overlayEl) return;
        const r = overlayEl.getBoundingClientRect();
        const pos = { left: Math.round(r.left), top: Math.round(r.top) };
        settings.overlayPos = pos;
        try { chrome.storage.local.set({ overlayPos: pos }); } catch (_) { /* ignore */ }
    }

    // result: { locator, count, stability, column, alternatives:[{locator,label,count,stability}],
    //           framework, action, assertion, name, jsLocator, url, error? }
    function showOverlay(result) {
        if (!isTopFrame) return;
        hideOverlay();
        const isError = !!result.error;
        overlayEl = document.createElement('div');
        overlayEl.setAttribute('data-pw-ui', 'overlay');
        overlayEl.style.cssText = `position:fixed;top:20px;right:20px;background:${C.bg};color:${C.text};padding:14px 16px 12px;border-radius:10px;border:1px solid ${C.hair};font-family:${MONO};font-size:12.5px;z-index:${Z};box-shadow:0 2px 6px rgba(0,0,0,0.3),0 24px 48px -12px rgba(0,0,0,0.65);max-width:580px;min-width:300px;text-align:left;line-height:1.45;`;
        const pos = settings.overlayPos;
        if (pos && pos.left >= 0 && pos.top >= 0 && pos.left < window.innerWidth - 100 && pos.top < window.innerHeight - 60) {
            overlayEl.style.right = 'auto';
            overlayEl.style.left = `${pos.left}px`;
            overlayEl.style.top = `${pos.top}px`;
        }

        // Drag
        let drag = null;
        const onMove = (e) => {
            if (!drag) return;
            overlayEl.style.right = 'auto';
            overlayEl.style.left = `${drag.left + e.clientX - drag.x}px`;
            overlayEl.style.top = `${drag.top + e.clientY - drag.y}px`;
        };
        const onUp = () => { if (drag) { drag = null; saveOverlayPosition(); } };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        overlayEl.__pwCleanup = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        const top = document.createElement('div');
        top.style.cssText = 'display:flex;align-items:flex-start;gap:8px;margin-bottom:12px;cursor:move;';
        const status = document.createElement('span');
        status.style.cssText = `flex-shrink:0;width:8px;height:8px;margin-top:6px;border-radius:50%;background:${isError ? C.bad : C.accent};box-shadow:0 0 0 3px ${isError ? 'rgba(240,133,122,0.22)' : 'rgba(122,162,247,0.22)'};`;
        top.appendChild(status);
        top.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'CODE') return;
            const r = overlayEl.getBoundingClientRect();
            drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
            e.preventDefault();
        });

        const code = document.createElement('code');
        code.textContent = isError ? result.error : result.locator;
        code.style.cssText = `white-space:pre-wrap;word-break:break-all;user-select:all;flex-grow:1;line-height:1.55;cursor:text;color:${C.text};`;
        top.appendChild(code);
        if (!isError) {
            if (result.stability) top.appendChild(stabilityTag(result.stability));
            if (typeof result.count === 'number') top.appendChild(countBadge(result.count));
        }
        overlayEl.appendChild(top);

        if (!isError && result.column) {
            const col = document.createElement('div');
            col.style.cssText = `font-family:${FONT};font-size:11px;color:${C.text3};margin:-6px 0 10px 16px;`;
            col.textContent = `Column "${result.column}" — the index breaks if columns are reordered.`;
            overlayEl.appendChild(col);
        }

        const buttons = document.createElement('div');
        buttons.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;';

        if (!isError) {
            let displayed = result.locator;
            buttons.appendChild(copyButton('Copy', C.accent, '#0b1220', () => stripNote(displayed)));
            if (result.action) buttons.appendChild(copyButton('Copy action', C.bg2, C.text, () => result.action.replace(stripNote(result.locator), stripNote(displayed))));
            if (result.assertion) buttons.appendChild(copyButton('Copy assert', C.bg2, C.text, () => result.assertion.replace(stripNote(result.locator), stripNote(displayed))));

            if (core.canParameterize(result.locator)) {
                const isPy = result.framework === 'pytest';
                let varMode = false;
                const varBtn = button('{ }', C.bg2, C.purple);
                varBtn.title = 'Replace content values with variable names for parameterised tests';
                varBtn.onclick = () => {
                    varMode = !varMode;
                    displayed = varMode ? core.parameterizeLocator(result.locator, isPy) : result.locator;
                    code.textContent = displayed;
                    varBtn.textContent = varMode ? 'Original' : '{ }';
                    varBtn.style.color = varMode ? C.ok : C.purple;
                };
                buttons.appendChild(varBtn);
            }

            if (result.jsLocator) {
                const poBtn = button('+ Page object', C.bg2, C.amber);
                poBtn.setAttribute('data-pw-ui', 'add-page-object');
                poBtn.title = `Add as "${result.name}" to the page object (see popup)`;
                poBtn.onclick = () => {
                    addToPageObject({ name: result.name || 'element', locator: stripNote(result.jsLocator), url: location.href });
                    poBtn.textContent = `Added as ${result.name}`;
                    poBtn.disabled = true;
                    poBtn.style.opacity = '0.7';
                };
                buttons.appendChild(poBtn);
            }
        }

        const closeBtn = button('Close', 'transparent', C.text3);
        closeBtn.style.marginLeft = 'auto';
        closeBtn.onclick = hideOverlay;
        buttons.appendChild(closeBtn);
        overlayEl.appendChild(buttons);

        const alts = (result.alternatives || []);
        if (!isError && alts.length) {
            const toggle = document.createElement('button');
            toggle.style.cssText = `margin-top:12px;background:none;border:none;color:${C.text3};cursor:pointer;font-size:11px;padding:0;display:block;font-family:${FONT};`;
            const list = document.createElement('div');
            list.style.cssText = 'display:none;margin-top:6px;';
            for (const alt of alts) {
                const row = document.createElement('div');
                row.style.cssText = `display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid ${C.hair};`;
                const lbl = document.createElement('span');
                lbl.textContent = alt.label;
                lbl.style.cssText = `flex-shrink:0;font-family:${FONT};font-size:10.5px;color:${C.text3};white-space:nowrap;min-width:86px;`;
                const altCode = document.createElement('code');
                altCode.textContent = alt.locator;
                altCode.style.cssText = `flex-grow:1;font-size:11px;white-space:pre-wrap;word-break:break-all;user-select:all;color:${C.text2};line-height:1.5;`;
                row.append(lbl, altCode);
                if (alt.stability) { const st = stabilityTag(alt.stability); st.style.fontSize = '9px'; row.appendChild(st); }
                if (typeof alt.count === 'number') { const cb = countBadge(alt.count); cb.style.fontSize = '10px'; row.appendChild(cb); }
                const altCopy = copyButton('Copy', C.bg2, C.text2, () => stripNote(alt.locator));
                altCopy.style.height = '24px';
                altCopy.style.padding = '0 8px';
                altCopy.style.fontSize = '11px';
                row.appendChild(altCopy);
                list.appendChild(row);
            }
            let open = false;
            const render = () => {
                toggle.textContent = `${open ? '▼' : '▶'} ${alts.length} alternative${alts.length > 1 ? 's' : ''}`;
                list.style.display = open ? 'block' : 'none';
            };
            render();
            toggle.onclick = () => { open = !open; render(); };
            overlayEl.append(toggle, list);
        }

        document.documentElement.appendChild(overlayEl);
        if (!isError && result.locator) {
            try { core.highlight(core.resolve(stripNote(result.locator)), '#98c379'); } catch (_) { /* cross-frame locator */ }
        }
    }

    function addToPageObject(entry) {
        try {
            chrome.storage.local.get(['pageObject'], (r) => {
                const po = r.pageObject || { className: 'AppPage', entries: [] };
                if (!po.entries.some((e) => e.locator === entry.locator)) po.entries.push({ ...entry, id: Date.now() });
                chrome.storage.local.set({ pageObject: po });
            });
        } catch (_) { /* ignore */ }
    }

    // ------------------------------------------------------------------
    // Frame chain: locator for this frame's <iframe> element(s) in ancestors
    // ------------------------------------------------------------------
    function frameChain(framework) {
        const f = core.createFormatter(framework);
        const parts = [];
        let w = window;
        try {
            while (w !== w.top) {
                const fe = w.frameElement; // null when the parent is cross-origin
                if (!fe) return { prefix: parts.length ? joinFrames(parts, f) : null, crossOrigin: true };
                const loc = stripNote(core.analyzeElement(fe, framework, { ...analyzeOptions(), maxAlternatives: 0 }).locator);
                parts.unshift(loc);
                w = w.parent;
            }
        } catch (_) {
            return { prefix: parts.length ? joinFrames(parts, f) : null, crossOrigin: true };
        }
        return { prefix: parts.length ? joinFrames(parts, f) : null, crossOrigin: false };
    }

    function joinFrames(parts, f) {
        return parts.map((p, i) => (i === 0 ? p : p.replace(/^page\./, '')) + f.contentFrame()).join('.');
    }

    // Full analysis in the current framework, with frame prefix applied.
    function analyze(target, framework) {
        const fw = core.normalizeFramework(framework || settings.framework);
        const analysis = core.analyzeElement(target, fw, analyzeOptions());
        let { locator, alternatives, action, assertion, jsLocator } = analysis;
        if (!isTopFrame) {
            const chain = frameChain(fw);
            if (chain.prefix) {
                const f = core.createFormatter(fw);
                const bare = stripNote(locator);
                const prefixed = (loc) => f.chain(chain.prefix, loc);
                const newBare = prefixed(bare);
                action = action && action.replace(bare, newBare);
                assertion = assertion && assertion.replace(bare, newBare);
                locator = prefixed(locator);
                alternatives = alternatives.map((a) => ({ ...a, locator: prefixed(a.locator) }));
                const jsChain = fw === 'js' ? chain : frameChain('js');
                jsLocator = jsChain.prefix ? core.createFormatter('js').chain(jsChain.prefix, stripNote(jsLocator)) : jsLocator;
            }
            if (chain.crossOrigin) {
                locator = stripNote(locator) + core.createFormatter(fw).note('inside a cross-origin iframe — prefix with page.frameLocator("<iframe selector>")');
            }
        }
        return { ...analysis, locator, alternatives, action, assertion, jsLocator, url: location.href };
    }

    // ------------------------------------------------------------------
    // Capture
    // ------------------------------------------------------------------
    function captureElement(target) {
        disablePickingMode();
        window.__pwLastInteractedSelect = null;
        let result;
        try {
            result = analyze(target, settings.framework);
        } catch (err) {
            result = { error: `Could not generate a locator: ${err && err.message ? err.message : err}`, locator: '', count: 0, alternatives: [], framework: settings.framework };
        }

        if (isTopFrame) showOverlay(result);
        safeSend({ action: 'elementPicked', result, fromTopFrame: isTopFrame });
        if (!result.error) {
            const clean = stripNote(result.locator);
            try {
                chrome.storage.local.get(['locatorHistory'], (r) => {
                    const history = (r.locatorHistory || []).filter((h) => h !== clean);
                    history.unshift(clean);
                    chrome.storage.local.set({ locatorHistory: history.slice(0, 8), lastGeneratedLocator: result.locator });
                });
            } catch (_) { /* ignore */ }
        }
    }

    function safeSend(msg) {
        try {
            const p = chrome.runtime.sendMessage(msg);
            if (p && p.catch) p.catch(() => {});
        } catch (_) { /* extension reloaded */ }
    }

    // ------------------------------------------------------------------
    // Picking mode
    // ------------------------------------------------------------------
    const deepTarget = (e) => e.composedPath()[0] || e.target;

    function onMouseOver(e) { if (isPickingMode) setHover(deepTarget(e)); }
    // Keyboard-only picking: Tab moves focus, the focused element becomes the target.
    function onFocusIn(e) { if (isPickingMode) setHover(deepTarget(e)); }

    // Swallow the press/release so the page's own handlers (menu close on
    // pointerdown, focus changes, link navigation) never see the pick.
    function swallow(e) {
        if (!isPickingMode) return;
        e.preventDefault();
        e.stopPropagation();
    }

    function onClick(e) {
        if (!isPickingMode) return;
        e.preventDefault();
        e.stopPropagation();
        captureElement(deepTarget(e));
    }

    function onKeyDown(e) {
        if (!isPickingMode) return;
        if (e.key === 'Escape') {
            e.preventDefault(); e.stopPropagation();
            disablePickingMode();
            safeSend({ action: 'pickingCancelled' });
        } else if (e.key === 'Enter' && hoveredElement) {
            e.preventDefault(); e.stopPropagation();
            captureElement(hoveredElement);
        }
        // Tab and arrows pass through so focus can move.
    }

    const PICK_EVENTS = [['mouseover', onMouseOver], ['focusin', onFocusIn], ['mousedown', swallow], ['mouseup', swallow], ['pointerdown', swallow], ['pointerup', swallow], ['click', onClick], ['auxclick', swallow], ['keydown', onKeyDown]];

    function enablePickingMode(framework) {
        if (isPickingMode) return;
        isPickingMode = true;
        if (framework) settings.framework = core.normalizeFramework(framework);
        hoveredElement = null;
        hideOverlay();
        showBadge();
        for (const [type, fn] of PICK_EVENTS) document.addEventListener(type, fn, { capture: true });
        document.documentElement.style.setProperty('cursor', 'crosshair', 'important');
        if (window.__pwHoveredEl) setHover(window.__pwHoveredEl);
    }

    function disablePickingMode() {
        if (!isPickingMode) return;
        isPickingMode = false;
        clearHoverHighlight();
        hideBadge();
        for (const [type, fn] of PICK_EVENTS) document.removeEventListener(type, fn, { capture: true });
        document.documentElement.style.removeProperty('cursor');
    }

    // ------------------------------------------------------------------
    // Recording mode
    // ------------------------------------------------------------------
    const INTERACTIVE = 'button, a[href], input, select, textarea, summary, label, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="option"], [role="treeitem"], [contenteditable="true"]';

    // Storage writes are serialised: two steps in one tick (fill → press) must
    // not both read the same snapshot and overwrite each other.
    let recordQueue = Promise.resolve();

    function recordStep(el, action) {
        if (!el || isOurUI(el)) return;
        let jsLocator;
        try { jsLocator = stripNote(analyze(el, 'js').locator); } catch (_) { return; }
        recordQueue = recordQueue.then(() => new Promise((done) => {
        try {
            chrome.storage.local.get(['recording'], (r) => {
                const rec = r.recording || { active: true, url: isTopFrame ? location.href : '', steps: [] };
                // Only the top frame knows the page URL; a step on a page other
                // than the last one means the user navigated.
                const lastUrl = rec.steps.length ? rec.steps[rec.steps.length - 1].url : rec.url;
                const pageUrl = isTopFrame ? location.href : lastUrl;
                if (isTopFrame && lastUrl && lastUrl !== pageUrl) {
                    rec.steps.push({ locator: '', action: { kind: 'goto', value: pageUrl }, url: pageUrl, at: Date.now() });
                }
                const last = rec.steps[rec.steps.length - 1];
                const recentSameFill = action.kind === 'fill' && rec.steps.slice(-2).find((st) => st.locator === jsLocator && st.action.kind === 'fill');
                // Typing produces one fill per change; collapse repeats on the same
                // element (a blur after Enter re-fires change with the same value).
                if (last && last.locator === jsLocator && last.action.kind === 'fill' && action.kind === 'fill') last.action = action;
                else if (recentSameFill && recentSameFill.action.value === action.value) { /* duplicate */ }
                else rec.steps.push({ locator: jsLocator, action, url: pageUrl, at: Date.now() });
                chrome.storage.local.set({ recording: rec }, done);
                showRecBadge(rec.steps.length);
            });
        } catch (_) { done(); }
        }));
    }

    function onRecordClick(e) {
        if (!isRecording || isPickingMode) return;
        const raw = deepTarget(e);
        const el = raw && raw.closest ? raw.closest(INTERACTIVE) : null;
        if (!el) return;
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (tag === 'input' && ['checkbox', 'radio'].includes(type)) return;        // recorded on change
        if ((tag === 'input' && !['button', 'submit', 'reset', 'image', 'file'].includes(type)) || tag === 'textarea' || tag === 'select' || tag === 'label') return;
        recordStep(el, { kind: 'click' });
    }

    function onRecordChange(e) {
        if (!isRecording || isPickingMode) return;
        const el = deepTarget(e);
        if (!el || !el.tagName) return;
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (tag === 'select') {
            const selected = el.options[el.selectedIndex];
            recordStep(el, { kind: 'select', value: selected ? selected.text.trim() : '' });
        } else if (tag === 'input' && ['checkbox', 'radio'].includes(type)) {
            recordStep(el, { kind: el.checked ? 'check' : 'uncheck' });
        } else if (tag === 'input' && ['button', 'submit', 'reset', 'image', 'hidden'].includes(type)) {
            // nothing
        } else if (tag === 'input' || tag === 'textarea' || el.isContentEditable) {
            recordStep(el, { kind: 'fill', value: el.isContentEditable ? el.textContent : el.value });
        }
    }

    // Enter in a text field is how forms get submitted; record it as a press.
    function onRecordKey(e) {
        if (!isRecording || isPickingMode || e.key !== 'Enter') return;
        const el = deepTarget(e);
        if (!el || !el.tagName) return;
        const tag = el.tagName.toLowerCase();
        if (tag === 'textarea' || (tag === 'input' && !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'hidden'].includes((el.getAttribute('type') || '').toLowerCase()))) {
            // Flush the typed value first so the order is fill → press.
            if (el.value) recordStep(el, { kind: 'fill', value: el.value });
            recordStep(el, { kind: 'press', value: 'Enter' });
        }
    }

    const REC_EVENTS = [['click', onRecordClick], ['change', onRecordChange], ['keydown', onRecordKey]];

    function startRecording(fresh) {
        if (isRecording) return;
        isRecording = true;
        disablePickingMode();
        hideOverlay();
        for (const [type, fn] of REC_EVENTS) document.addEventListener(type, fn, { capture: true, passive: true });
        if (!isTopFrame) return; // the top frame owns the recording record
        try {
            chrome.storage.local.get(['recording'], (r) => {
                const rec = fresh || !r.recording ? { active: true, url: location.href, steps: [] } : { ...r.recording, active: true };
                chrome.storage.local.set({ recording: rec });
                showRecBadge(rec.steps.length);
            });
        } catch (_) { showRecBadge(0); }
    }

    function stopRecording(persist) {
        if (!isRecording) return;
        isRecording = false;
        for (const [type, fn] of REC_EVENTS) document.removeEventListener(type, fn, { capture: true });
        hideRecBadge();
        if (persist) {
            try { chrome.storage.local.get(['recording'], (r) => { if (r.recording) chrome.storage.local.set({ recording: { ...r.recording, active: false } }); }); } catch (_) { /* ignore */ }
        }
    }

    // Resume an active recording after navigation.
    try {
        chrome.storage.local.get(['recording'], (r) => {
            if (r.recording && r.recording.active) startRecording(false);
        });
    } catch (_) { /* ignore */ }

    window.__pwRecording = (on, fresh = true) => {
        if (on) startRecording(fresh); else stopRecording(true);
        return isRecording ? 'recording' : 'stopped';
    };

    // ------------------------------------------------------------------
    // Shortcut / popup entry point
    // ------------------------------------------------------------------

    // Deepest element under the pointer, descending into open shadow roots.
    function elementAtPoint(x, y) {
        let el = document.elementFromPoint(x, y);
        while (el && el.shadowRoot) {
            const inner = el.shadowRoot.elementFromPoint(x, y);
            if (!inner || inner === el) break;
            el = inner;
        }
        return el;
    }

    const isChrome = (el) => !el || el === document.body || el === document.documentElement || el.tagName.toLowerCase() === 'iframe' || el.tagName.toLowerCase() === 'frame' || el.hasAttribute('data-pw-ui') || isOurUI(el);

    // fromShortcut → capture what is under the cursor right now (dropdowns stay
    // open); otherwise enter interactive picking mode. Returns the new state.
    window.__pwTogglePicking = (framework, fromShortcut = false) => {
        if (isPickingMode) { disablePickingMode(); return 'disabled'; }
        if (framework) settings.framework = core.normalizeFramework(framework);

        if (fromShortcut) {
            const c = window.__pwMouseCoords;
            let target = c ? elementAtPoint(c.x, c.y) : null;
            if (isChrome(target) && c) target = window.__pwHoveredEl;
            if (isChrome(target) && document.activeElement && document.activeElement.tagName.toLowerCase() === 'select') target = document.activeElement;
            if (isChrome(target) && window.__pwLastInteractedSelect && document.contains(window.__pwLastInteractedSelect)) target = window.__pwLastInteractedSelect;
            if (!isChrome(target)) { captureElement(target); return 'captured'; }
            // Pointer is not over this frame: only the top frame falls back to
            // picking mode so the user sees exactly one badge.
            if (!isTopFrame && !c) return 'idle';
        }
        enablePickingMode(settings.framework);
        return 'enabled';
    };

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        switch (msg && msg.action) {
            case 'togglePickingMode':
                sendResponse({ status: window.__pwTogglePicking(msg.framework, false) });
                break;
            case 'disablePickingMode':
                disablePickingMode();
                break;
            case 'showLocator':
                if (isTopFrame) showOverlay(msg.result);
                break;
            case 'hideOverlay':
                hideOverlay();
                break;
            case 'toggleRecording':
                sendResponse({ status: window.__pwRecording(!!msg.on, msg.fresh !== false) });
                break;
            default:
                break;
        }
    });
})();
