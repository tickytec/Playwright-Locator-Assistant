/*
 * locator-core.js — the pure locator engine.
 *
 * Shared by the content script (generation + uniqueness badge), the popup
 * verifier (chrome.scripting.executeScript → findAndHighlight) and the test
 * suite. It has no chrome.* dependencies and mutates the page only through the
 * explicit highlight helpers.
 *
 * The role, accessible-name and text semantics below deliberately mirror
 * Playwright's own implementation (roleUtils / selectorUtils), so that a
 * locator this file rates as unique resolves to the same single element in a
 * real Playwright run. tests/ verifies exactly that against real Chromium.
 */
(function (global) {
    'use strict';
    if (global.PWLocatorCore) return;

    // ------------------------------------------------------------------
    // Constants
    // ------------------------------------------------------------------

    // data-testid is Playwright's default; the others are common overrides via
    // `use: { testIdAttribute }`. We generate getByTestId for all of them and
    // add a note when the attribute is not the default.
    const TEST_ID_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy', 'data-automation-id'];

    const HIGHLIGHT_ATTR = 'data-pw-verifier-highlight';
    const PREV_OUTLINE_ATTR = 'data-pw-prev-outline';

    // Never matched or highlighted: their textContent is code, not UI.
    const NON_RENDERED_TAGS = new Set(['SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK', 'TITLE', 'BASE', 'NOSCRIPT', 'TEMPLATE']);

    // Roles whose accessible name may be computed from descendant content
    // (accname §2F). Playwright uses the same set.
    const NAME_FROM_CONTENT_ROLES = new Set([
        'button', 'cell', 'checkbox', 'columnheader', 'gridcell', 'heading', 'link',
        'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'row',
        'rowheader', 'switch', 'tab', 'tooltip', 'treeitem',
    ]);

    const KNOWN_ROLES = new Set([
        'alert', 'alertdialog', 'application', 'article', 'banner', 'blockquote', 'button', 'caption',
        'cell', 'checkbox', 'code', 'columnheader', 'combobox', 'complementary', 'contentinfo',
        'definition', 'deletion', 'dialog', 'directory', 'document', 'emphasis', 'feed', 'figure',
        'form', 'generic', 'grid', 'gridcell', 'group', 'heading', 'img', 'insertion', 'link', 'list',
        'listbox', 'listitem', 'log', 'main', 'mark', 'marquee', 'math', 'meter', 'menu', 'menubar',
        'menuitem', 'menuitemcheckbox', 'menuitemradio', 'navigation', 'none', 'note', 'option',
        'paragraph', 'presentation', 'progressbar', 'radio', 'radiogroup', 'region', 'row',
        'rowgroup', 'rowheader', 'scrollbar', 'search', 'searchbox', 'separator', 'slider',
        'spinbutton', 'status', 'strong', 'subscript', 'superscript', 'switch', 'tab', 'table',
        'tablist', 'tabpanel', 'term', 'textbox', 'time', 'timer', 'toolbar', 'tooltip', 'tree',
        'treegrid', 'treeitem',
    ]);

    const LOCATOR_STEPS = new Set([
        'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByAltText', 'getByTitle',
        'getByTestId', 'locator', 'filter', 'nth', 'first', 'last', 'and', 'or',
        'frameLocator', 'contentFrame',
    ]);

    // Trailing calls that act on a locator rather than narrowing it.
    const ACTION_STEPS = new Set([
        'click', 'dblclick', 'fill', 'type', 'press', 'pressSequentially', 'check', 'uncheck',
        'selectOption', 'setInputFiles', 'hover', 'focus', 'blur', 'tap', 'clear', 'dragTo',
        'selectText', 'scrollIntoViewIfNeeded', 'waitFor', 'evaluate', 'evaluateAll', 'evaluateHandle',
        'screenshot', 'getAttribute', 'dispatchEvent', 'boundingBox', 'count', 'all', 'allTextContents',
        'allInnerTexts', 'innerText', 'innerHTML', 'textContent', 'inputValue', 'isVisible', 'isHidden',
        'isEnabled', 'isDisabled', 'isChecked', 'isEditable', 'highlight', 'describe', 'ariaSnapshot',
        'elementHandle', 'elementHandles', 'contentFrame_', 'toBeVisible',
    ]);

    // ------------------------------------------------------------------
    // Small utilities
    // ------------------------------------------------------------------

    const norm = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
    const tagOf = (el) => el.tagName ? el.tagName.toLowerCase() : '';
    const docOf = (node) => (node.nodeType === 9 ? node : node.ownerDocument);
    const winOf = (node) => docOf(node).defaultView || global;
    const isElement = (n) => !!n && n.nodeType === 1;
    const isShadowRoot = (n) => !!n && n.nodeType === 11 && !!n.host;

    // Parent that crosses shadow boundaries (host of a shadow root).
    function parentOf(el) {
        const p = el.parentNode;
        if (!p) return null;
        if (isShadowRoot(p)) return p.host;
        return p.nodeType === 1 ? p : null;
    }

    // Slot-less approximation of the flat tree children used for name computation.
    function contentChildren(el) {
        if (el.shadowRoot) return Array.from(el.shadowRoot.childNodes);
        if (tagOf(el) === 'slot' && typeof el.assignedNodes === 'function') {
            const assigned = el.assignedNodes({ flatten: true });
            if (assigned.length) return assigned;
        }
        return Array.from(el.childNodes);
    }

    // Per-operation caches. Created once per generate/resolve call so repeated
    // uniqueness checks over the same DOM stay cheap.
    function createContext() {
        return {
            elements: new Map(),   // root → Element[]
            hidden: new WeakMap(), // Element → boolean
            names: new WeakMap(),  // Element → {name, source}
            text: new WeakMap(),   // Element → string
            style: new WeakMap(),  // Element → CSSStyleDeclaration
        };
    }

    function styleOf(el, ctx) {
        let cs = ctx.style.get(el);
        if (!cs) {
            try { cs = winOf(el).getComputedStyle(el); } catch (_) { cs = null; }
            ctx.style.set(el, cs || {});
        }
        return cs || {};
    }

    // All elements under root (Document, ShadowRoot or Element), in document
    // order, piercing open shadow roots — like Playwright's selector engines.
    function allElements(root, ctx) {
        const cached = ctx.elements.get(root);
        if (cached) return cached;
        const out = [];
        const scan = (r) => {
            if (isElement(r) && r.shadowRoot) scan(r.shadowRoot);
            for (const el of r.querySelectorAll('*')) {
                if (NON_RENDERED_TAGS.has(el.tagName)) continue;
                out.push(el);
                if (el.shadowRoot) scan(el.shadowRoot);
            }
        };
        scan(root);
        ctx.elements.set(root, out);
        return out;
    }

    // ------------------------------------------------------------------
    // Visibility for ARIA purposes (Playwright: isElementHiddenForAria)
    // ------------------------------------------------------------------

    // aria-hidden / display:none / closed <details> propagate down the tree.
    function isSubtreeHidden(el, ctx) {
        const cached = ctx.hidden.get(el);
        if (cached !== undefined) return cached;
        let hidden = el.getAttribute('aria-hidden') === 'true';
        // <option> has no layout box inside a dropdown <select> but is exposed.
        if (!hidden && !(tagOf(el) === 'option' && el.closest('select'))) hidden = styleOf(el, ctx).display === 'none';
        if (!hidden) {
            const parent = parentOf(el);
            if (parent) {
                if (tagOf(parent) === 'details' && !parent.open && tagOf(el) !== 'summary') hidden = true;
                else hidden = isSubtreeHidden(parent, ctx);
            }
        }
        ctx.hidden.set(el, hidden);
        return hidden;
    }

    function isAriaHidden(el, ctx) {
        if (isSubtreeHidden(el, ctx)) return true;
        // Computed visibility already inherits, and a child may override it.
        const v = styleOf(el, ctx).visibility;
        return v === 'hidden' || v === 'collapse';
    }

    // ------------------------------------------------------------------
    // Roles (html-aam implicit roles, as implemented by Playwright)
    // ------------------------------------------------------------------

    const SECTIONING_TAGS = new Set(['article', 'aside', 'main', 'nav', 'section', 'blockquote', 'details', 'dialog', 'fieldset', 'figure', 'td']);

    function explicitRole(el) {
        const raw = el.getAttribute('role');
        if (!raw) return null;
        for (const token of raw.trim().toLowerCase().split(/\s+/)) {
            if (KNOWN_ROLES.has(token)) return token === 'none' ? 'presentation' : token;
        }
        return null;
    }

    function implicitRole(el, ctx) {
        const tag = tagOf(el);
        switch (tag) {
            case 'a': case 'area': return el.hasAttribute('href') ? 'link' : null;
            case 'article': return 'article';
            case 'aside': return 'complementary';
            case 'blockquote': return 'blockquote';
            case 'button': return 'button';
            case 'caption': return 'caption';
            case 'code': return 'code';
            case 'datalist': return 'listbox';
            case 'dd': return 'definition';
            case 'del': return 'deletion';
            case 'details': return 'group';
            case 'dfn': case 'dt': return 'term';
            case 'dialog': return 'dialog';
            case 'em': return 'emphasis';
            case 'fieldset': return 'group';
            case 'figure': return 'figure';
            case 'footer': case 'header': {
                for (let p = parentOf(el); p; p = parentOf(p)) if (SECTIONING_TAGS.has(tagOf(p))) return null;
                return tag === 'footer' ? 'contentinfo' : 'banner';
            }
            case 'form': return hasExplicitName(el) ? 'form' : null;
            case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
            case 'hr': return 'separator';
            case 'html': return 'document';
            case 'img': {
                if (el.getAttribute('alt') === '' && !el.getAttribute('title') && !hasGlobalAria(el) && !el.hasAttribute('tabindex')) return 'presentation';
                return 'img';
            }
            case 'input': {
                const type = (el.getAttribute('type') || 'text').toLowerCase();
                if (type === 'search') return el.hasAttribute('list') ? 'combobox' : 'searchbox';
                if (['email', 'tel', 'text', 'url'].includes(type)) return el.hasAttribute('list') ? 'combobox' : 'textbox';
                if (type === 'hidden') return null;
                if (type === 'file') return 'button';
                return ({
                    button: 'button', checkbox: 'checkbox', image: 'button', number: 'spinbutton',
                    radio: 'radio', range: 'slider', reset: 'button', submit: 'button',
                })[type] || 'textbox';
            }
            case 'ins': return 'insertion';
            case 'li': return 'listitem';
            case 'main': return 'main';
            case 'mark': return 'mark';
            case 'math': return 'math';
            case 'menu': case 'ol': case 'ul': return 'list';
            case 'meter': return 'meter';
            case 'nav': return 'navigation';
            case 'optgroup': return 'group';
            case 'option': return 'option';
            case 'output': return 'status';
            case 'p': return 'paragraph';
            case 'progress': return 'progressbar';
            case 'section': return hasExplicitName(el) ? 'region' : null;
            case 'select': return el.hasAttribute('multiple') || (parseInt(el.getAttribute('size') || '0', 10) > 1) ? 'listbox' : 'combobox';
            case 'strong': return 'strong';
            case 'sub': return 'subscript';
            case 'sup': return 'superscript';
            case 'svg': return 'img';
            case 'table': return 'table';
            case 'tbody': case 'tfoot': case 'thead': return 'rowgroup';
            case 'td': {
                const table = el.closest('table');
                const tRole = table ? getRole(table, ctx) : null;
                return tRole === 'grid' || tRole === 'treegrid' ? 'gridcell' : 'cell';
            }
            case 'textarea': return 'textbox';
            case 'th': {
                const scope = el.getAttribute('scope');
                if (scope === 'row') return 'rowheader';
                if (scope === 'col' || scope === 'colgroup') return 'columnheader';
                return 'columnheader';
            }
            case 'time': return 'time';
            case 'tr': return 'row';
            default: return null;
        }
    }

    function hasExplicitName(el) {
        return !!(norm(el.getAttribute('aria-label')) || el.getAttribute('aria-labelledby'));
    }

    function hasGlobalAria(el) {
        for (const a of el.getAttributeNames()) if (a.startsWith('aria-')) return true;
        return false;
    }

    function getRole(el, ctx = createContext()) {
        const role = explicitRole(el) || implicitRole(el, ctx);
        return role === 'presentation' ? null : role;
    }

    // ------------------------------------------------------------------
    // Accessible name (simplified accname 1.2, matching Playwright's shortcuts)
    // ------------------------------------------------------------------

    function idRefs(el, attr) {
        const raw = el.getAttribute(attr);
        if (!raw) return [];
        const root = el.getRootNode();
        const out = [];
        for (const id of raw.split(/\s+/).filter(Boolean)) {
            const ref = root.getElementById ? root.getElementById(id) : docOf(el).getElementById(id);
            if (ref) out.push(ref);
        }
        return out;
    }

    function elementLabels(el) {
        const labels = [];
        for (const ref of idRefs(el, 'aria-labelledby')) labels.push(ref);
        if (el.labels) for (const l of el.labels) if (!labels.includes(l)) labels.push(l);
        return labels;
    }

    function isInline(el, ctx) {
        const d = styleOf(el, ctx).display || '';
        return d === 'inline' || d === 'inline-block' || d === 'inline-flex' || d === 'inline-grid' || d === '';
    }

    // Text alternative from content (accname 2F/2G), with hidden nodes skipped
    // and embedded controls contributing their value.
    function nameFromContent(el, ctx, visited) {
        let out = '';
        for (const child of contentChildren(el)) {
            if (child.nodeType === 3) { out += child.nodeValue; continue; }
            if (!isElement(child)) continue;
            if (NON_RENDERED_TAGS.has(child.tagName)) continue;
            if (isAriaHidden(child, ctx)) continue;
            const piece = nameOfDescendant(child, ctx, visited);
            out += isInline(child, ctx) ? piece : ` ${piece} `;
        }
        return out;
    }

    function nameOfDescendant(el, ctx, visited) {
        if (visited.has(el)) return '';
        visited.add(el);
        const labelled = idRefs(el, 'aria-labelledby');
        if (labelled.length) return labelled.map((r) => nameFromContent(r, ctx, visited)).join(' ');
        const ariaLabel = norm(el.getAttribute('aria-label'));
        if (ariaLabel) return ariaLabel;
        const tag = tagOf(el);
        const role = getRole(el, ctx);
        // Embedded controls contribute their value (accname 2E).
        if (tag === 'input') {
            const type = (el.getAttribute('type') || 'text').toLowerCase();
            if (['button', 'submit', 'reset'].includes(type)) return el.value || '';
            if (type === 'image') return el.getAttribute('alt') || el.value || '';
            if (['checkbox', 'radio', 'hidden', 'file'].includes(type)) return '';
            return el.value || '';
        }
        if (tag === 'textarea') return el.value || '';
        if (tag === 'select') return Array.from(el.selectedOptions || []).map((o) => o.text).join(' ');
        if (tag === 'img' || tag === 'area') return el.getAttribute('alt') || '';
        if (tag === 'svg') return svgTitle(el);
        if (role === 'progressbar' || role === 'slider' || role === 'spinbutton') return el.getAttribute('aria-valuetext') || el.getAttribute('aria-valuenow') || '';
        const content = nameFromContent(el, ctx, visited);
        if (norm(content)) return content;
        return el.getAttribute('title') || '';
    }

    function svgTitle(el) {
        for (const c of el.children) if (c.tagName && c.tagName.toLowerCase() === 'title') return norm(c.textContent);
        return '';
    }

    // Returns { name, source }. Sources, in order of stability:
    // aria-labelledby | aria-label | label | value | alt | caption | legend | figcaption | content | title | placeholder
    function getNameInfo(el, ctx = createContext()) {
        const cached = ctx.names.get(el);
        if (cached) return cached;
        const info = computeNameInfo(el, ctx);
        info.name = norm(info.name);
        if (!info.name) info.source = null;
        ctx.names.set(el, info);
        return info;
    }

    function computeNameInfo(el, ctx) {
        const visited = new Set([el]);
        const labelled = idRefs(el, 'aria-labelledby');
        if (labelled.length) {
            const name = labelled.map((r) => nameFromContent(r, ctx, new Set([el]))).join(' ');
            if (norm(name)) return { name, source: 'aria-labelledby' };
        }
        const ariaLabel = norm(el.getAttribute('aria-label'));
        if (ariaLabel) return { name: ariaLabel, source: 'aria-label' };

        const tag = tagOf(el);
        const role = getRole(el, ctx);

        if (el.labels && el.labels.length) {
            const name = Array.from(el.labels).filter((l) => !isAriaHidden(l, ctx)).map((l) => nameFromContent(l, ctx, new Set([el]))).join(' ');
            if (norm(name)) return { name, source: 'label' };
        }
        if (tag === 'input') {
            const type = (el.getAttribute('type') || 'text').toLowerCase();
            if (['button', 'submit', 'reset'].includes(type)) {
                if (el.value) return { name: el.value, source: 'value' };
                if (type === 'submit') return { name: 'Submit', source: 'value' };
                if (type === 'reset') return { name: 'Reset', source: 'value' };
            }
            if (type === 'image') {
                const alt = el.getAttribute('alt');
                if (alt) return { name: alt, source: 'alt' };
                if (el.getAttribute('title')) return { name: el.getAttribute('title'), source: 'title' };
                return { name: 'Submit', source: 'value' };
            }
        }
        if (tag === 'img' || tag === 'area') {
            const alt = el.getAttribute('alt');
            if (alt) return { name: alt, source: 'alt' };
        }
        if (tag === 'svg') {
            const t = svgTitle(el);
            if (t) return { name: t, source: 'content' };
        }
        if (tag === 'table') {
            const cap = el.querySelector(':scope > caption');
            if (cap) return { name: nameFromContent(cap, ctx, visited), source: 'caption' };
        }
        if (tag === 'fieldset') {
            const legend = el.querySelector(':scope > legend');
            if (legend) return { name: nameFromContent(legend, ctx, visited), source: 'legend' };
        }
        if (tag === 'figure') {
            const cap = el.querySelector(':scope > figcaption');
            if (cap) return { name: nameFromContent(cap, ctx, visited), source: 'figcaption' };
        }
        if (role && NAME_FROM_CONTENT_ROLES.has(role)) {
            const content = nameFromContent(el, ctx, visited);
            if (norm(content)) return { name: content, source: 'content' };
        }
        const title = norm(el.getAttribute('title'));
        if (title) return { name: title, source: 'title' };
        if (tag === 'input' || tag === 'textarea') {
            const ph = norm(el.getAttribute('placeholder'));
            if (ph) return { name: ph, source: 'placeholder' };
        }
        return { name: '', source: null };
    }

    function getAccessibleName(el, ctx) {
        return getNameInfo(el, ctx).name;
    }

    // Full text of an element as Playwright's text engine sees it (textContent,
    // shadow-piercing, button values included).
    function elementText(el, ctx) {
        const cached = ctx.text.get(el);
        if (cached !== undefined) return cached;
        let out = '';
        const tag = tagOf(el);
        if (tag === 'input' && ['button', 'submit', 'reset'].includes((el.getAttribute('type') || '').toLowerCase())) {
            out = el.value || '';
        } else {
            for (const child of el.childNodes) {
                if (child.nodeType === 3) out += child.nodeValue;
                else if (isElement(child) && !NON_RENDERED_TAGS.has(child.tagName)) out += elementText(child, ctx);
            }
            if (el.shadowRoot) {
                for (const child of el.shadowRoot.childNodes) {
                    if (child.nodeType === 3) out += child.nodeValue;
                    else if (isElement(child) && !NON_RENDERED_TAGS.has(child.tagName)) out += elementText(child, ctx);
                }
            }
        }
        ctx.text.set(el, out);
        return out;
    }

    // ------------------------------------------------------------------
    // Stability heuristics
    // ------------------------------------------------------------------

    // True when text looks like a runtime value (price, rate, count, date, time)
    // rather than a stable label.
    function looksLikeDynamicText(text) {
        const t = norm(text);
        if (!t) return false;
        if (/^[+\-]?[$€£¥₹₩฿]?\s*\d[\d\s,._]*\s*[$€£¥₹₩฿%]?$/.test(t)) return true;       // 42, $1,299.00, 12%
        if (/\b\d+[.,]\d+\b/.test(t) && !/^v(er(sion)?)?\s*\d/i.test(t)) return true;        // 1.0823, 42.99, 1.1 (not "Version 2.1")
        if (/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/.test(t)) return true;                        // 2025-01-31
        if (/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/.test(t)) return true;                      // 31/01/2025
        if (/\b\d{1,2}:\d{2}(:\d{2})?\b/.test(t)) return true;                               // 14:32
        if (/\(\s*\d[\d,.]*\s*\)/.test(t)) return true;                                      // (42)
        if (/\b\d[\d,]*\s+(item|result|product|notification|message|comment|order|review|user|record|error|file|row|day|hour|minute|second|min|sec)s?\b/i.test(t)) return true;
        if (/\b(\d+)\s*(h|m|s|d|ms|kb|mb|gb)\b/i.test(t) && /^\S+$/.test(t)) return true;   // 3h, 12ms
        return false;
    }

    // Filters hash-like / CSS-module-like generated class names.
    function isStableClass(cls) {
        if (!cls || cls.length < 2) return false;
        if (/[0-9a-f]{6,}/i.test(cls)) return false;             // hash segment
        if (/__.{1,20}__/.test(cls)) return false;               // css-module Component__block__hash
        if (/^(css|sc|jss|emotion|chakra|mui|Mui)-?[\w-]*\d/.test(cls)) return false; // css-in-js
        if (/^sc-[A-Za-z]{4,}$/.test(cls)) return false;         // styled-components
        if (/[_-]\d{3,}$/.test(cls)) return false;               // suffix-1234
        if (/^[a-z]{1,2}\d+$/i.test(cls)) return false;          // a1, xy123
        return true;
    }

    function isStableId(id) {
        if (!id) return false;
        if (/^\d+$/.test(id) || /^[0-9a-f-]{8,}$/i.test(id)) return false;    // numeric or uuid-ish
        if (/[:_-]\d{2,}(\b|$)/.test(id) && !/^[a-z]+-\d{1,2}$/i.test(id)) return false; // react-select-17-input, radix-:r3:
        if (/(^|[^a-z]):r[0-9a-z]+:/i.test(id) || /^r[0-9a-z]+:$/i.test(id)) return false; // React useId (:r3:, radix-:r1a:)
        if (/[0-9a-f]{6,}/i.test(id)) return false;
        return true;
    }

    // ------------------------------------------------------------------
    // CSS helpers
    // ------------------------------------------------------------------

    const CSS_ESC = global.CSS && global.CSS.escape ? (s) => global.CSS.escape(s) : (s) => s.replace(/[^\w-]/g, (c) => `\\${c}`);

    function idSelector(id) {
        return /^[A-Za-z_][\w-]*$/.test(id) ? `#${id}` : `[id="${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
    }

    // One path segment for el relative to its parent: tag.stable.classes[:nth-child(n)]
    function cssSegment(el) {
        const tag = tagOf(el);
        const classes = Array.from(el.classList).filter(isStableClass).map(CSS_ESC);
        let sel = classes.length ? `${tag}.${classes.join('.')}` : tag;
        const parent = el.parentNode;
        const siblings = parent && parent.children ? Array.from(parent.children) : [];
        if (siblings.filter((s) => s.matches(sel)).length > 1) sel += `:nth-child(${siblings.indexOf(el) + 1})`;
        return sel;
    }

    function cssMatches(el, css) {
        try { return el.matches(css); } catch (_) { return false; }
    }

    function queryCSS(root, css, ctx) {
        // Deep query: elements under root (shadow-piercing) matching css in their own tree.
        try { root.querySelectorAll(css); } catch (_) { return null; } // invalid selector
        return allElements(root, ctx).filter((el) => cssMatches(el, css));
    }

    // Shortest `a > b > c` path that is unique within root.
    function uniqueCSSPath(el, root, ctx, maxDepth = 6) {
        let path = cssSegment(el);
        let node = el;
        for (let depth = 0; depth < maxDepth; depth++) {
            const found = queryCSS(root, path, ctx);
            if (found && found.length === 1 && found[0] === el) return path;
            if (isStableId(node.id)) {
                const withId = idSelector(node.id) + (node === el ? '' : ` > ${path.split(' > ').slice(1).join(' > ')}`);
                const f2 = queryCSS(root, withId, ctx);
                if (f2 && f2.length === 1 && f2[0] === el) return withId;
            }
            const parent = parentOf(node);
            if (!parent || tagOf(parent) === 'body' || tagOf(parent) === 'html') break;
            node = parent;
            path = `${cssSegment(node)} > ${path}`;
        }
        return path;
    }

    // ------------------------------------------------------------------
    // Output formatting for JS / Python
    // ------------------------------------------------------------------

    function createFormatter(framework) {
        const isPytest = framework === 'pytest' || framework === 'python';
        const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const str = (s) => `"${esc(s)}"`;
        const method = (m) => (isPytest ? m.replace(/([A-Z])/g, '_$1').toLowerCase() : m);
        const regex = (r) => (isPytest ? `re.compile(r"${r.regex.replace(/"/g, '\\"')}"${/i/.test(r.flags || '') ? ', re.I' : ''})` : `/${r.regex}/${(r.flags || '').replace(/[^gimsuy]/g, '')}`);
        const value = (v) => (typeof v === 'boolean' ? (isPytest ? (v ? 'True' : 'False') : String(v)) : typeof v === 'number' ? String(v) : v && typeof v === 'object' && 'regex' in v ? regex(v) : str(v));
        const call = (m, args = [], opts = null) => {
            const parts = args.map(value);
            const entries = opts ? Object.entries(opts).filter(([, v]) => v !== undefined && v !== null) : [];
            if (entries.length) {
                if (isPytest) parts.push(...entries.map(([k, v]) => `${method(k)}=${value(v)}`));
                else parts.push(`{ ${entries.map(([k, v]) => `${k}: ${value(v)}`).join(', ')} }`);
            }
            return `${method(m)}(${parts.join(', ')})`;
        };
        return {
            isPytest,
            esc,
            str,
            method,
            call,
            page: (m, args, opts) => `page.${call(m, args, opts)}`,
            note: (text) => (isPytest ? `  # ${text}` : `  // ${text}`),
            contentFrame: () => (isPytest ? '.content_frame' : '.contentFrame()'),
            chain: (base, step) => `${base}.${step.replace(/^page\./, '')}`,
        };
    }

    // Strips a trailing `  # ...` / `  // ...` note added by the generator.
    // Quote-aware, so "Order # 5" inside a string survives, and the note must
    // follow a closing paren or a word (so an XPath union `//a | //b` does too).
    function stripNote(locator) {
        const s = String(locator || '');
        let quote = null;
        for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (quote) {
                if (c === '\\') i++;
                else if (c === quote) quote = null;
                continue;
            }
            if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
            const isNote = (c === '#' || (c === '/' && s[i + 1] === '/')) && i > 0 && /\s/.test(s[i - 1]) && /[\w)\]]$/.test(s.slice(0, i).trimEnd());
            if (isNote) return s.slice(0, i).trim();
        }
        return s.trim();
    }

    // Swaps concrete content values for variable names so the locator can be
    // pasted into a parameterised test. Developer-set labels stay untouched.
    function parameterizeLocator(locator, isPytest) {
        const text = stripNote(locator);
        if (isPytest) {
            return text
                .replace(/\.filter\(has_text="(?:[^"\\]|\\.)*"\)/, '.filter(has_text=row_text)')
                .replace(/\bget_by_role\("row",(\s*name=)"(?:[^"\\]|\\.)*"/, (_, sep) => `get_by_role("row",${sep}row_text`)
                .replace(/\bget_by_role\("(cell|gridcell)",(\s*name=)"(?:[^"\\]|\\.)*"/, (_, r, sep) => `get_by_role("${r}",${sep}cell_value`)
                .replace(/\.select_option\("(?:[^"\\]|\\.)*"\)/, '.select_option(option_text)');
        }
        return text
            .replace(/\.filter\(\{\s*hasText:\s*"(?:[^"\\]|\\.)*"\s*\}\)/, '.filter({ hasText: rowText })')
            .replace(/\bgetByRole\("row",(\s*\{\s*name:\s*)"(?:[^"\\]|\\.)*"/, (_, sep) => `getByRole("row",${sep}rowText`)
            .replace(/\bgetByRole\("(cell|gridcell)",(\s*\{\s*name:\s*)"(?:[^"\\]|\\.)*"/, (_, r, sep) => `getByRole("${r}",${sep}cellValue`)
            .replace(/\.selectOption\("(?:[^"\\]|\\.)*"\)/, '.selectOption(optionText)');
    }

    function canParameterize(locator) {
        return parameterizeLocator(locator, /\bget_by_/.test(locator)) !== stripNote(locator);
    }

    // ------------------------------------------------------------------
    // Locator string parsing
    // ------------------------------------------------------------------

    function tokenize(src) {
        const tokens = [];
        let i = 0;
        const isIdent = (c) => /[A-Za-z_$]/.test(c);
        const isIdentPart = (c) => /[\w$]/.test(c);
        while (i < src.length) {
            const c = src[i];
            if (/\s/.test(c)) { i++; continue; }
            if (c === '"' || c === "'" || c === '`') {
                const q = c; let j = i + 1; let val = '';
                while (j < src.length && src[j] !== q) {
                    if (src[j] === '\\' && j + 1 < src.length) {
                        const n = src[j + 1];
                        val += n === 'n' ? '\n' : n === 't' ? '\t' : n;
                        j += 2;
                    } else { val += src[j]; j++; }
                }
                if (j >= src.length) throw new Error('Unterminated string');
                tokens.push({ type: 'string', value: val });
                i = j + 1;
                continue;
            }
            if (c === '/' && src[i + 1] !== '/' && (tokens.length === 0 || ['(', ',', ':', '=', '['].includes(tokens[tokens.length - 1].value))) {
                // Regex literal
                let j = i + 1; let body = ''; let inClass = false;
                while (j < src.length) {
                    const d = src[j];
                    if (d === '\\') { body += d + (src[j + 1] || ''); j += 2; continue; }
                    if (d === '[') inClass = true; else if (d === ']') inClass = false;
                    if (d === '/' && !inClass) break;
                    body += d; j++;
                }
                if (j >= src.length) throw new Error('Unterminated regex');
                j++;
                let flags = '';
                while (j < src.length && /[a-z]/i.test(src[j])) flags += src[j++];
                tokens.push({ type: 'regex', value: new RegExp(body, flags.replace(/[^gimsuy]/g, '')) });
                i = j;
                continue;
            }
            if (/\d/.test(c) || (c === '-' && /\d/.test(src[i + 1] || ''))) {
                let j = i + 1;
                while (j < src.length && /[\d.]/.test(src[j])) j++;
                tokens.push({ type: 'number', value: Number(src.slice(i, j)) });
                i = j;
                continue;
            }
            if (isIdent(c)) {
                let j = i + 1;
                while (j < src.length && isIdentPart(src[j])) j++;
                const word = src.slice(i, j);
                // Python raw / f string prefixes
                if (/^[rRbBfFuU]{1,2}$/.test(word) && (src[j] === '"' || src[j] === "'")) { i = j; continue; }
                if (word === 'true' || word === 'True') tokens.push({ type: 'bool', value: true });
                else if (word === 'false' || word === 'False') tokens.push({ type: 'bool', value: false });
                else if (word === 'None' || word === 'null' || word === 'undefined') tokens.push({ type: 'null', value: null });
                else tokens.push({ type: 'ident', value: word });
                i = j;
                continue;
            }
            if ('.(){}[],:='.includes(c)) {
                if (c === '=' && src[i + 1] === '>') throw new Error('Arrow functions are not supported');
                tokens.push({ type: 'punct', value: c });
                i++;
                continue;
            }
            throw new Error(`Unexpected character "${c}"`);
        }
        return tokens;
    }

    // Parser producing [{ name, args: [value...], opts: {k: value} }] where a
    // value is { type: 'string'|'number'|'bool'|'null'|'regex'|'expr'|'object', value }.
    function parseChain(src) {
        const tokens = tokenize(src);
        let pos = 0;
        const peek = (o = 0) => tokens[pos + o];
        const next = () => tokens[pos++];
        const isPunct = (t, v) => t && t.type === 'punct' && t.value === v;
        const expectPunct = (v) => {
            const t = next();
            if (!isPunct(t, v)) throw new Error(`Expected "${v}"`);
        };

        function parseValue() {
            const t = peek();
            if (!t) throw new Error('Unexpected end of input');
            if (isPunct(t, '{')) return parseObject();
            if (isPunct(t, '[')) { // array literal (e.g. selectOption(["a"])) – ignored content
                let depth = 0;
                do { const x = next(); if (isPunct(x, '[')) depth++; else if (isPunct(x, ']')) depth--; } while (depth > 0 && peek());
                return { type: 'null', value: null };
            }
            if (t.type === 'ident') return { type: 'expr', value: parseExpression() };
            next();
            return { type: t.type, value: t.value };
        }

        function parseObject() {
            expectPunct('{');
            const obj = {};
            while (peek() && !isPunct(peek(), '}')) {
                const k = next();
                if (k.type !== 'ident' && k.type !== 'string') throw new Error('Bad object key');
                expectPunct(':');
                obj[k.value] = parseValue();
                if (isPunct(peek(), ',')) next();
            }
            expectPunct('}');
            return { type: 'object', value: obj };
        }

        function parseArgs() {
            expectPunct('(');
            const args = [];
            const opts = {};
            while (peek() && !isPunct(peek(), ')')) {
                if (peek().type === 'ident' && isPunct(peek(1), '=')) {           // python kwarg
                    const k = next().value; next();
                    opts[k] = parseValue();
                } else {
                    const v = parseValue();
                    if (v.type === 'object') Object.assign(opts, v.value);        // JS options object
                    else args.push(v);
                }
                if (isPunct(peek(), ',')) next();
            }
            expectPunct(')');
            return { args, opts };
        }

        function parseExpression() {
            const steps = [];
            for (;;) {
                const t = next();
                if (!t || t.type !== 'ident') throw new Error('Expected a method name');
                let step = { name: t.value, args: [], opts: {}, called: false };
                if (isPunct(peek(), '(')) { Object.assign(step, parseArgs()); step.called = true; }
                steps.push(step);
                if (isPunct(peek(), '.')) { next(); continue; }
                break;
            }
            return steps;
        }

        let steps;
        if (peek() && peek().type === 'ident' && peek().value === 'await') next();
        steps = parseExpression();
        if (pos < tokens.length) {
            // Tolerate a trailing `;` or stray tokens after a full expression
            const rest = tokens.slice(pos).map((t) => t.value).join('');
            if (!/^[;)]*$/.test(rest)) throw new Error(`Unexpected trailing input "${rest}"`);
        }
        return normalizeSteps(steps);
    }

    const PY_TO_JS = {
        get_by_role: 'getByRole', get_by_text: 'getByText', get_by_label: 'getByLabel',
        get_by_placeholder: 'getByPlaceholder', get_by_alt_text: 'getByAltText',
        get_by_title: 'getByTitle', get_by_test_id: 'getByTestId', frame_locator: 'frameLocator',
        content_frame: 'contentFrame', and_: 'and', or_: 'or', select_option: 'selectOption',
        has_text: 'hasText', has_not_text: 'hasNotText', has_not: 'hasNot', include_hidden: 'includeHidden',
        press_sequentially: 'pressSequentially', set_input_files: 'setInputFiles', wait_for: 'waitFor',
        scroll_into_view_if_needed: 'scrollIntoViewIfNeeded', drag_to: 'dragTo', select_text: 'selectText',
        input_value: 'inputValue', text_content: 'textContent', inner_text: 'innerText',
        is_visible: 'isVisible', is_hidden: 'isHidden', is_enabled: 'isEnabled', is_checked: 'isChecked',
        get_attribute: 'getAttribute', dispatch_event: 'dispatchEvent', bounding_box: 'boundingBox',
        element_handle: 'elementHandle', all_text_contents: 'allTextContents', all_inner_texts: 'allInnerTexts',
        evaluate_all: 'evaluateAll', evaluate_handle: 'evaluateHandle', aria_snapshot: 'ariaSnapshot',
    };

    // Unwraps expect(...), drops page./self.page./this.page. prefixes, converts
    // Python names, and trims trailing action calls.
    function normalizeSteps(steps) {
        // expect(locator).toBeVisible()  /  expect(locator).to_be_visible()
        if (steps.length && steps[0].name === 'expect' && steps[0].called && steps[0].args[0] && steps[0].args[0].type === 'expr') {
            return normalizeSteps(steps[0].args[0].value);
        }
        let out = steps.map((s) => {
            const name = PY_TO_JS[s.name] || s.name;
            const opts = {};
            for (const [k, v] of Object.entries(s.opts)) opts[PY_TO_JS[k] || k] = v;
            return { ...s, name, opts };
        });
        // Leading receivers: page, self, this, frame, locator variables ...
        while (out.length && !out[0].called && !LOCATOR_STEPS.has(out[0].name)) out.shift();
        // contentFrame is a property in Python, a call in JS — accept both.
        // Everything else must be a call.
        while (out.length) {
            const last = out[out.length - 1];
            if (LOCATOR_STEPS.has(last.name)) break;
            if (ACTION_STEPS.has(last.name) || /^(to|not|to_)/.test(last.name) || !last.called) { out.pop(); continue; }
            throw new Error(`Unsupported call ".${last.name}()"`);
        }
        if (!out.length) throw new Error('No locator found');
        for (const s of out) {
            if (!LOCATOR_STEPS.has(s.name)) throw new Error(`Unsupported call ".${s.name}()"`);
        }
        return out;
    }

    // ------------------------------------------------------------------
    // Resolution: locator string → matching elements
    // ------------------------------------------------------------------

    function toMatcher(v, exact) {
        // Returns fn(text) → boolean following Playwright's rules.
        if (!v || v.type === 'null') return null;
        if (v.type === 'regex') return (text) => v.value.test(norm(text));
        if (v.type === 'expr') {
            // re.compile(r"...", re.I)
            const e = v.value;
            if (e.length === 2 && e[0].name === 're' && e[1].name === 'compile' && e[1].args[0] && e[1].args[0].type === 'string') {
                const flags = e[1].args.slice(1).some((a) => a.type === 'expr' && /^(I|IGNORECASE)$/.test(a.value[a.value.length - 1].name)) ? 'i' : '';
                const re = new RegExp(e[1].args[0].value, flags);
                return (text) => re.test(norm(text));
            }
            throw new Error('Unsupported expression argument');
        }
        const needle = norm(String(v.value));
        if (exact) return (text) => norm(text) === needle;
        const lower = needle.toLowerCase();
        return (text) => norm(text).toLowerCase().includes(lower);
    }

    function optBool(opts, key) {
        const v = opts[key];
        if (!v) return undefined;
        if (v.type === 'bool') return v.value;
        if (v.type === 'null') return undefined;
        throw new Error(`Option "${key}" must be a boolean`);
    }

    function nodeLevel(el) {
        const aria = parseInt(el.getAttribute('aria-level') || '', 10);
        if (aria) return aria;
        const m = /^h([1-6])$/.exec(tagOf(el));
        return m ? Number(m[1]) : undefined;
    }

    function ariaChecked(el) {
        const t = tagOf(el);
        if (t === 'input' && ['checkbox', 'radio'].includes((el.getAttribute('type') || '').toLowerCase())) return el.indeterminate ? 'mixed' : el.checked;
        const v = el.getAttribute('aria-checked');
        return v === 'true' ? true : v === 'false' ? false : v === 'mixed' ? 'mixed' : undefined;
    }

    // Elements in scope roots (Documents or Elements), deduplicated, filtered
    // by predicate; `self` includes the root element itself where applicable.
    function search(scope, ctx, predicate) {
        const seen = new Set();
        const out = [];
        for (const root of scope) {
            for (const el of allElements(root, ctx)) {
                if (seen.has(el)) continue;
                if (predicate(el)) { seen.add(el); out.push(el); }
            }
        }
        return out;
    }

    // Playwright text engine semantics: an element matches when its own text
    // matches and no child element's text also matches (innermost wins).
    function textMatches(el, matcher, ctx) {
        if (!matcher(elementText(el, ctx))) return false;
        for (const child of el.children) if (matcher(elementText(child, ctx))) return false;
        if (el.shadowRoot) for (const child of el.shadowRoot.children) if (matcher(elementText(child, ctx))) return false;
        return true;
    }

    // Playwright-style selector strings: "css", "css=", "xpath=", "//…", "text=", "id=", "data-testid=", "a >> b".
    function resolveSelectorString(selector, scope, ctx) {
        const parts = splitOnDoubleArrow(selector);
        let current = scope;
        for (const raw of parts) {
            const part = raw.trim();
            if (!part) continue;
            current = resolveSimpleSelector(part, current, ctx);
            if (!current.length) return [];
        }
        return current;
    }

    function splitOnDoubleArrow(s) {
        const out = [];
        let depth = 0, quote = null, start = 0;
        for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
            if (c === '"' || c === "'") quote = c;
            else if (c === '(' || c === '[') depth++;
            else if (c === ')' || c === ']') depth--;
            else if (c === '>' && s[i + 1] === '>' && depth === 0) { out.push(s.slice(start, i)); start = i + 2; i++; }
        }
        out.push(s.slice(start));
        return out;
    }

    function resolveSimpleSelector(selector, scope, ctx) {
        let m;
        if ((m = /^xpath=(.*)$/s.exec(selector)) || /^(\/\/|\.\/|\.\.\/|\/)/.test(selector)) {
            return resolveXPath(m ? m[1] : selector, scope);
        }
        if ((m = /^text=(.*)$/s.exec(selector))) {
            let v = m[1].trim();
            let exact = false;
            const q = /^(["'])(.*)\1$/s.exec(v);
            if (q) { v = q[2]; exact = true; }
            const matcher = toMatcher({ type: 'string', value: v }, exact);
            return search(scope, ctx, (el) => textMatches(el, matcher, ctx));
        }
        if ((m = /^id=(.*)$/.exec(selector))) return search(scope, ctx, (el) => el.id === m[1]);
        if ((m = /^(data-testid|data-test-id|data-test|data-qa|data-cy)=(.*)$/.exec(selector))) {
            return search(scope, ctx, (el) => el.getAttribute(m[1]) === m[2]);
        }
        if ((m = /^internal:testid=\[(.+?)=(["'])(.*)\2s?\]$/.exec(selector))) {
            return search(scope, ctx, (el) => el.getAttribute(m[1]) === m[3]);
        }
        if (selector.startsWith('css=')) selector = selector.slice(4);
        return resolveCSS(selector, scope, ctx);
    }

    // CSS with Playwright's extra pseudo-classes handled as post-filters:
    // :has-text("x"), :text("x"), :text-is("x"), :visible, :nth-match(...) unsupported.
    function resolveCSS(css, scope, ctx) {
        const filters = [];
        let base = css;
        const pseudo = /:(has-text|text-is|text|visible)(\(\s*(["'])((?:[^"'\\]|\\.)*)\3\s*\))?$/;
        let m;
        while ((m = pseudo.exec(base))) {
            const kind = m[1];
            const val = m[4] != null ? m[4] : '';
            if (kind === 'visible') filters.push((el) => !isAriaHidden(el, ctx));
            else if (kind === 'has-text') { const f = toMatcher({ type: 'string', value: val }, false); filters.push((el) => f(elementText(el, ctx))); }
            else if (kind === 'text-is') { const f = toMatcher({ type: 'string', value: val }, true); filters.push((el) => textMatches(el, f, ctx)); }
            else { const f = toMatcher({ type: 'string', value: val }, false); filters.push((el) => textMatches(el, f, ctx)); }
            base = base.slice(0, m.index) || '*';
        }
        const seen = new Set();
        const out = [];
        for (const root of scope) {
            const found = queryCSS(root, base, ctx);
            if (found === null) throw new Error(`Invalid CSS selector "${base}"`);
            for (const el of found) {
                if (seen.has(el)) continue;
                if (filters.every((f) => f(el))) { seen.add(el); out.push(el); }
            }
        }
        return out;
    }

    function resolveXPath(expr, scope) {
        const out = [];
        const seen = new Set();
        for (const root of scope) {
            const doc = docOf(root);
            let e = expr;
            if (root !== doc && e.startsWith('/')) e = '.' + e;
            let result;
            try { result = doc.evaluate(e, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); }
            catch (err) { throw new Error(`Invalid XPath: ${err.message}`); }
            for (let i = 0; i < result.snapshotLength; i++) {
                const n = result.snapshotItem(i);
                if (n.nodeType === 1 && !seen.has(n) && !NON_RENDERED_TAGS.has(n.tagName)) { seen.add(n); out.push(n); }
            }
        }
        return out;
    }

    function resolveSteps(steps, scope, ctx) {
        let current = scope;
        for (const step of steps) {
            if (!current.length) return [];
            const first = step.args[0];
            const opts = step.opts;
            const exact = optBool(opts, 'exact') === true;
            switch (step.name) {
                case 'getByRole': {
                    if (!first || first.type !== 'string') throw new Error('getByRole needs a role string');
                    const role = first.value.trim().toLowerCase();
                    const nameMatch = toMatcher(opts.name, exact);
                    const includeHidden = optBool(opts, 'includeHidden') === true;
                    const level = opts.level && opts.level.type === 'number' ? opts.level.value : undefined;
                    const checked = optBool(opts, 'checked');
                    const selected = optBool(opts, 'selected');
                    const disabled = optBool(opts, 'disabled');
                    const pressed = optBool(opts, 'pressed');
                    const expanded = optBool(opts, 'expanded');
                    current = search(current, ctx, (el) => {
                        if (getRole(el, ctx) !== role) return false;
                        if (!includeHidden && isAriaHidden(el, ctx)) return false;
                        if (nameMatch && !nameMatch(getAccessibleName(el, ctx))) return false;
                        if (level !== undefined && nodeLevel(el) !== level) return false;
                        if (checked !== undefined && ariaChecked(el) !== checked) return false;
                        if (selected !== undefined) {
                            const s = tagOf(el) === 'option' ? el.selected : el.getAttribute('aria-selected') === 'true';
                            if (s !== selected) return false;
                        }
                        if (disabled !== undefined) {
                            const d = !!(el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('fieldset:disabled'));
                            if (d !== disabled) return false;
                        }
                        if (pressed !== undefined && (el.getAttribute('aria-pressed') === 'true') !== pressed) return false;
                        if (expanded !== undefined && (el.getAttribute('aria-expanded') === 'true') !== expanded) return false;
                        return true;
                    });
                    break;
                }
                case 'getByText': {
                    const matcher = toMatcher(first, exact);
                    if (!matcher) throw new Error('getByText needs a text argument');
                    current = search(current, ctx, (el) => textMatches(el, matcher, ctx));
                    break;
                }
                case 'getByLabel': {
                    const matcher = toMatcher(first, exact);
                    if (!matcher) throw new Error('getByLabel needs a text argument');
                    current = search(current, ctx, (el) => {
                        const ariaLabel = el.getAttribute('aria-label');
                        if (ariaLabel && matcher(ariaLabel)) return true;
                        return elementLabels(el).some((l) => matcher(elementText(l, ctx)));
                    });
                    break;
                }
                case 'getByPlaceholder':
                case 'getByAltText':
                case 'getByTitle': {
                    const attr = { getByPlaceholder: 'placeholder', getByAltText: 'alt', getByTitle: 'title' }[step.name];
                    const matcher = toMatcher(first, exact);
                    if (!matcher) throw new Error(`${step.name} needs a text argument`);
                    current = search(current, ctx, (el) => el.hasAttribute(attr) && matcher(el.getAttribute(attr)));
                    break;
                }
                case 'getByTestId': {
                    if (!first) throw new Error('getByTestId needs a value');
                    const matcher = first.type === 'regex' ? (v) => first.value.test(v) : (v) => v === String(first.value);
                    current = search(current, ctx, (el) => TEST_ID_ATTRS.some((a) => el.hasAttribute(a) && matcher(el.getAttribute(a))));
                    break;
                }
                case 'locator': {
                    if (!first) throw new Error('locator() needs a selector');
                    if (first.type === 'expr') current = resolveSteps(normalizeSteps(first.value), current, ctx); // locator(otherLocator)
                    else current = resolveSelectorString(String(first.value), current, ctx);
                    current = applyFilterOptions(current, opts, ctx);
                    break;
                }
                case 'filter':
                    current = applyFilterOptions(current, opts, ctx);
                    break;
                case 'nth': {
                    if (!first || first.type !== 'number') throw new Error('nth() needs an index');
                    const i = first.value < 0 ? current.length + first.value : first.value;
                    current = current[i] ? [current[i]] : [];
                    break;
                }
                case 'first': current = current.slice(0, 1); break;
                case 'last': current = current.slice(-1); break;
                case 'and': case 'or': {
                    if (!first || first.type !== 'expr') throw new Error(`${step.name}() needs a locator`);
                    const other = resolveSteps(normalizeSteps(first.value), scope, ctx);
                    if (step.name === 'and') current = current.filter((el) => other.includes(el));
                    else { const set = new Set(current); for (const el of other) if (!set.has(el)) current.push(el); }
                    break;
                }
                case 'frameLocator': {
                    if (!first || first.type !== 'string') throw new Error('frameLocator needs a selector');
                    const frames = resolveSelectorString(first.value, current, ctx);
                    current = framesToDocuments(frames);
                    break;
                }
                case 'contentFrame':
                    current = framesToDocuments(current);
                    break;
                default:
                    throw new Error(`Unsupported call ".${step.name}()"`);
            }
        }
        return current;
    }

    function framesToDocuments(frames) {
        const docs = [];
        for (const f of frames) {
            const t = tagOf(f);
            if (t !== 'iframe' && t !== 'frame') continue;
            let d = null;
            try { d = f.contentDocument; } catch (_) { d = null; } // cross-origin
            if (d) docs.push(d);
        }
        return docs;
    }

    function applyFilterOptions(current, opts, ctx) {
        const hasText = toMatcher(opts.hasText, false);
        const hasNotText = toMatcher(opts.hasNotText, false);
        if (hasText) current = current.filter((el) => hasText(elementText(el, ctx)));
        if (hasNotText) current = current.filter((el) => !hasNotText(elementText(el, ctx)));
        if (opts.has) {
            if (opts.has.type !== 'expr') throw new Error('filter({ has }) needs a locator');
            const inner = normalizeSteps(opts.has.value);
            current = current.filter((el) => resolveSteps(inner, [el], ctx).length > 0);
        }
        if (opts.hasNot) {
            if (opts.hasNot.type !== 'expr') throw new Error('filter({ hasNot }) needs a locator');
            const inner = normalizeSteps(opts.hasNot.value);
            current = current.filter((el) => resolveSteps(inner, [el], ctx).length === 0);
        }
        if (opts.visible) {
            const wantVisible = optBool(opts, 'visible');
            current = current.filter((el) => !isAriaHidden(el, ctx) === wantVisible);
        }
        return current;
    }

    // Resolves any locator or selector string to the elements it matches.
    // Throws with a readable message when the input cannot be parsed.
    function resolve(input, root = global.document, ctx = createContext()) {
        const src = stripNote(String(input || '').trim().replace(/;\s*$/, ''));
        if (!src) return [];
        const scope = [root];
        // `page.getByRole(...)`, `getByText(...)`, `expect(...)` — an identifier
        // followed by `.name` or `(`, and at least one call somewhere. Plain CSS
        // like `div.card > a` or `button:has-text("x")` fails this test.
        const looksLikeChain = /^(await\s+)?(expect\s*\(|[A-Za-z_$][\w$]*\s*(\.\s*[A-Za-z_$]|\())/.test(src) && src.includes('(');
        if (looksLikeChain) {
            try {
                return resolveSteps(parseChain(src), scope, ctx).filter((n) => n.nodeType === 1);
            } catch (chainErr) {
                // e.g. `li.item:has-text("x")` looks like a chain but is CSS.
                try { return resolveSelectorString(src, scope, ctx); } catch (_) { throw chainErr; }
            }
        }
        return resolveSelectorString(src, scope, ctx);
    }

    function count(input, root, ctx) {
        return resolve(input, root, ctx).length;
    }

    // ------------------------------------------------------------------
    // Highlighting
    // ------------------------------------------------------------------

    function clearHighlights(root = global.document) {
        const ctx = createContext();
        for (const el of allElements(root, ctx)) {
            if (!el.hasAttribute(HIGHLIGHT_ATTR)) continue;
            el.style.outline = el.getAttribute(PREV_OUTLINE_ATTR) || '';
            el.removeAttribute(PREV_OUTLINE_ATTR);
            el.removeAttribute(HIGHLIGHT_ATTR);
        }
    }

    function highlight(elements, color = '#ff4757') {
        for (const el of elements) {
            if (!el.hasAttribute(HIGHLIGHT_ATTR)) el.setAttribute(PREV_OUTLINE_ATTR, el.style.outline || '');
            el.style.outline = `3px solid ${color}`;
            el.setAttribute(HIGHLIGHT_ATTR, 'true');
        }
        return elements.length;
    }

    // Used by the popup through chrome.scripting.executeScript. Returns
    // { count, error } — never throws.
    function findAndHighlight(input, options = {}) {
        clearHighlights();
        try {
            const els = resolve(input);
            highlight(els);
            if (options.scroll !== false && els[0] && typeof els[0].scrollIntoView === 'function') {
                try { els[0].scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) { /* ignore */ }
            }
            return { count: els.length, error: null };
        } catch (err) {
            return { count: 0, error: err && err.message ? err.message : String(err) };
        }
    }

    // ------------------------------------------------------------------
    // Locator generation
    // ------------------------------------------------------------------

    const MAX_NAME_LENGTH = 100;
    const MAX_ANCHOR_LENGTH = 60;
    const FORM_TAGS = new Set(['input', 'select', 'textarea']);
    const hasWordChars = (s) => /[\p{L}\p{N}]/u.test(s);

    function stableText(name, source) {
        if (!name || name.length > MAX_NAME_LENGTH) return false;
        if ((source === 'content' || source === 'title' || source === 'placeholder') && looksLikeDynamicText(name)) return false;
        return true;
    }

    // Short stable text to use with filter({ hasText }): the element's own
    // text when it is short and stable, otherwise the first stable leaf text
    // inside it (e.g. the product name of a table row full of prices).
    function textAnchor(el, ctx) {
        const full = norm(elementText(el, ctx));
        if (!full) return '';
        if (full.length <= MAX_ANCHOR_LENGTH && !looksLikeDynamicText(full) && hasWordChars(full)) return full;
        const walker = docOf(el).createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const parent = n.parentElement;
            if (!parent || NON_RENDERED_TAGS.has(parent.tagName)) continue;
            const t = norm(n.nodeValue);
            if (t.length >= 2 && t.length <= MAX_ANCHOR_LENGTH && hasWordChars(t) && !looksLikeDynamicText(t)) return t;
        }
        // "EUR/USD 1.0823" → "EUR/USD"
        return stableSegment(full);
    }

    // Longest stable sentence-like segment of a text that contains dynamic
    // values, for a non-exact getByText.
    function stableSegment(text) {
        const t = norm(text);
        const ok = (s) => s.length >= 3 && s.length <= MAX_ANCHOR_LENGTH && hasWordChars(s) && !looksLikeDynamicText(s);
        const candidates = t.split(/[.!?;|•·—–]+(?=\s|$)/).map(norm).filter(ok);
        if (!candidates.length) {
            // Drop the dynamic tokens themselves: "Updated 14:32" → "Updated".
            const stripped = t.replace(/[+\-]?[$€£¥₹₩฿]?\s*\d[\d\s,.:/%-]*[$€£¥₹₩฿%]?/g, ' ').replace(/\(\s*\)/g, ' ');
            candidates.push(...stripped.split(/[.!?;|•·—–:]+(?=\s|$)/).map(norm).filter(ok));
        }
        candidates.sort((a, b) => b.length - a.length);
        return candidates[0] || '';
    }

    // Candidate locators for a single element, in priority order, without any
    // uniqueness check. Each candidate is { locator, label, kind, note? }.
    function standaloneCandidates(el, f, ctx, options = {}) {
        const out = [];
        const preferredTestId = TEST_ID_ATTRS.includes(options.testIdAttribute) ? options.testIdAttribute : 'data-testid';
        const loose = options.exactMode === 'needed';
        // With exactMode "needed", the substring/case-insensitive form is tried
        // first; the exact form only wins when the loose one is not unique.
        const addExact = (method, args, opts, label, kind, note) => {
            if (loose) {
                const { exact, ...rest } = opts;
                add(f.page(method, args, Object.keys(rest).length ? rest : null), label, kind, note);
            }
            add(f.page(method, args, opts), label, kind, note);
        };
        const add = (locator, label, kind, note) => out.push({ locator, label, kind, note });
        const tag = tagOf(el);
        const role = getRole(el, ctx);
        const { name, source } = getNameInfo(el, ctx);
        const nameOk = stableText(name, source);

        for (const attr of [preferredTestId, ...TEST_ID_ATTRS.filter((a) => a !== preferredTestId)]) {
            const v = el.getAttribute(attr);
            if (v) add(f.page('getByTestId', [v]), attr, 'testid', attr === preferredTestId ? null : `requires use: { testIdAttribute: "${attr}" } in playwright.config`);
        }

        if (source === 'label' && nameOk) addExact('getByLabel', [name], { exact: true }, 'getByLabel', 'label');

        if ((tag === 'img' || tag === 'area' || (tag === 'input' && el.getAttribute('type') === 'image')) && nameOk && source === 'alt') {
            addExact('getByAltText', [name], { exact: true }, 'getByAltText', 'alt');
        }

        const placeholder = norm(el.getAttribute('placeholder'));
        const placeholderCand = placeholder && (tag === 'input' || tag === 'textarea') && !looksLikeDynamicText(placeholder)
            ? ['getByPlaceholder', [placeholder], { exact: true }, 'getByPlaceholder', 'placeholder'] : null;
        if (placeholderCand && source === 'placeholder') addExact(...placeholderCand);

        let roleNameAdded = false;
        if (role && name && nameOk && source !== 'placeholder') {
            addExact('getByRole', [role], { name, exact: true }, 'getByRole', 'role-name');
            roleNameAdded = true;
        }
        if (placeholderCand && source !== 'placeholder') addExact(...placeholderCand);

        // "3 items in cart" → getByRole("button", { name: /items in cart/ })
        if (role && name && !nameOk && source === 'content' && name.length <= MAX_NAME_LENGTH) {
            const seg = stableSegment(name);
            if (seg) add(f.page('getByRole', [role], { name: { regex: escapeRegex(seg) } }), 'getByRole (regex name)', 'role-regex');
        }

        // Own text for leaf-like, non-form elements.
        const text = FORM_TAGS.has(tag) || ['img', 'svg', 'iframe'].includes(tag) ? '' : norm(elementText(el, ctx));
        if (text && text.length <= MAX_NAME_LENGTH && el.children.length <= 3 && hasWordChars(text)) {
            if (!looksLikeDynamicText(text)) addExact('getByText', [text], { exact: true }, 'getByText', 'text');
            else {
                const seg = stableSegment(text);
                if (seg) add(f.page('getByText', [seg]), 'getByText (partial)', 'text');
            }
        }

        const title = norm(el.getAttribute('title'));
        if (title && !looksLikeDynamicText(title)) addExact('getByTitle', [title], { exact: true }, 'getByTitle', 'title');

        if (role) {
            if (!roleNameAdded) {
                const anchor = FORM_TAGS.has(tag) ? '' : textAnchor(el, ctx);
                if (anchor) add(`${f.page('getByRole', [role])}.${f.call('filter', [], { hasText: anchor })}`, 'getByRole + filter', 'role-filter');
            }
            add(f.page('getByRole', [role]), 'getByRole (no name)', 'role');
        }

        if (isStableId(el.id)) add(f.page('locator', [idSelector(el.id)]), 'css #id', 'css-id');

        const classes = Array.from(el.classList).filter(isStableClass);
        if (classes.length) add(f.page('locator', [`${tag}.${classes.map(CSS_ESC).join('.')}`]), 'css .class', 'css-class');

        return out;
    }

    // Row-anchored candidates for table cells (documented project decision:
    // cells are located via their row so reordering survives).
    function tableCellCandidates(el, f, ctx) {
        const out = [];
        const tag = tagOf(el);
        if (tag !== 'td' && tag !== 'th') return out;
        const row = el.closest('tr');
        const cellRole = getRole(el, ctx);
        if (!row || !cellRole) return out;
        const cellText = norm(elementText(el, ctx));
        const cellDynamic = looksLikeDynamicText(cellText) || cellText.length > MAX_NAME_LENGTH || !hasWordChars(cellText);
        // Index among cells of the same role — getByRole("cell") skips <th> header cells.
        const sameRole = Array.from(row.cells).filter((c) => getRole(c, ctx) === cellRole);
        const colIndex = sameRole.indexOf(el);
        const columnName = columnHeaderFor(el, ctx);
        const columnNote = columnName ? `column "${columnName}"` : null;

        let anchor = norm(row.getAttribute('aria-label'));
        if (!anchor) {
            for (const cell of row.cells) {
                if (cell === el) continue;
                const t = textAnchor(cell, ctx);
                if (t) { anchor = t; break; }
            }
        }

        if (anchor) {
            const rowLoc = `${f.page('getByRole', ['row'])}.${f.call('filter', [], { hasText: anchor })}`;
            if (cellText && !cellDynamic) out.push({ locator: `${rowLoc}.${f.call('getByRole', [cellRole], { name: cellText, exact: true })}`, label: 'row + cell name', kind: 'table' });
            out.push({ locator: `${rowLoc}.${f.call('getByRole', [cellRole])}.nth(${colIndex})`, label: columnName ? `row + column "${columnName}"` : 'row + column index', kind: 'table', note: columnNote, column: columnName });
            return out;
        }

        const table = el.closest('table');
        const rows = table ? Array.from(table.querySelectorAll('tr')) : [];
        const rowIndex = rows.indexOf(row);
        if (table && rowIndex >= 0) {
            out.push({
                locator: `${tableLocator(table, f, ctx)}.${f.call('getByRole', ['row'])}.nth(${rowIndex}).${f.call('getByRole', [cellRole])}.nth(${colIndex})`,
                label: 'row/column index', kind: 'table',
                note: 'no stable row anchor; indices break if rows are reordered' + (columnName ? `; column "${columnName}"` : ''),
                column: columnName,
            });
        }
        return out;
    }

    // Header text for the column a cell sits in (first header row of its table).
    function columnHeaderFor(cell, ctx) {
        const row = cell.closest('tr');
        const table = cell.closest('table');
        if (!row || !table) return '';
        const headerRow = table.querySelector('thead tr') || Array.from(table.querySelectorAll('tr')).find((r) => r !== row && r.querySelector('th'));
        if (!headerRow) return '';
        const index = Array.from(row.cells).indexOf(cell);
        const header = headerRow.cells[index];
        const text = header ? norm(elementText(header, ctx)) : '';
        return text && text.length <= MAX_ANCHOR_LENGTH ? text : '';
    }

    function tableLocator(table, f, ctx) {
        const root = docOf(table);
        for (const c of standaloneCandidates(table, f, ctx)) {
            if (c.kind === 'css-class') continue;
            const found = safeResolve(c.locator, root, ctx);
            if (found.length === 1 && found[0] === table) return c.locator;
        }
        const tables = safeResolve(f.page('getByRole', ['table']), root, ctx);
        const idx = tables.indexOf(table);
        return idx >= 0 ? `${f.page('getByRole', ['table'])}.nth(${idx})` : f.page('locator', ['table']);
    }

    function safeResolve(locator, root, ctx) {
        try { return resolve(locator, root, ctx); } catch (_) { return []; }
    }

    // Lower is better. Used to prefer a well-named ancestor over a nearer but
    // weaker one when scoping.
    const STABILITY_ORDER = ['strong', 'good', 'fragile'];
    const weakerStability = (a, b) => STABILITY_ORDER[Math.max(STABILITY_ORDER.indexOf(a), STABILITY_ORDER.indexOf(b))];

    const KIND_RANK = { testid: 0, label: 1, 'role-name': 1, alt: 1, 'css-id': 2, placeholder: 2, role: 3, title: 3, text: 3, 'role-filter': 4, table: 4, 'css-class': 6, scoped: 5, 'scoped-css': 8, 'css-path': 9 };

    // Child-part candidates relative to an ancestor locator.
    function scopedCandidates(el, ancestor, ancestorLoc, f, ctx) {
        const out = [];
        const tag = tagOf(el);
        const role = getRole(el, ctx);
        const { name, source } = getNameInfo(el, ctx);
        const nameOk = stableText(name, source);
        if (role && name && nameOk && source !== 'placeholder') out.push({ locator: f.chain(ancestorLoc, f.call('getByRole', [role], { name, exact: true })), label: 'scoped getByRole', kind: 'role-name', scoped: true });
        if (source === 'label' && nameOk) out.push({ locator: f.chain(ancestorLoc, f.call('getByLabel', [name], { exact: true })), label: 'scoped getByLabel', kind: 'label', scoped: true });
        const ph = norm(el.getAttribute('placeholder'));
        if (ph && FORM_TAGS.has(tag)) out.push({ locator: f.chain(ancestorLoc, f.call('getByPlaceholder', [ph], { exact: true })), label: 'scoped getByPlaceholder', kind: 'placeholder', scoped: true });
        if (role && !FORM_TAGS.has(tag)) {
            const anchor = textAnchor(el, ctx);
            if (anchor && !(name && nameOk)) out.push({ locator: f.chain(ancestorLoc, `${f.call('getByRole', [role])}.${f.call('filter', [], { hasText: anchor })}`), label: 'scoped getByRole + filter', kind: 'role-filter', scoped: true });
        }
        if (role) out.push({ locator: f.chain(ancestorLoc, f.call('getByRole', [role])), label: 'scoped getByRole', kind: 'role', scoped: true });
        const text = FORM_TAGS.has(tag) ? '' : norm(elementText(el, ctx));
        if (text && text.length <= MAX_NAME_LENGTH && el.children.length <= 3 && hasWordChars(text)) {
            if (!looksLikeDynamicText(text)) out.push({ locator: f.chain(ancestorLoc, f.call('getByText', [text], { exact: true })), label: 'scoped getByText', kind: 'text', scoped: true });
            else {
                const seg = stableSegment(text);
                if (seg) out.push({ locator: f.chain(ancestorLoc, f.call('getByText', [seg])), label: 'scoped getByText (partial)', kind: 'text', scoped: true });
            }
        }
        return out;
    }

    // Walks up to `maxLevels` ancestors; for each ancestor with a unique
    // locator returns child candidates. Sorted by ancestor quality, then proximity.
    function ancestorScopedCandidates(el, f, ctx, root, options = {}, maxLevels = 5) {
        const semantic = [];
        const css = [];
        let ancestor = parentOf(el);
        for (let level = 0; level < maxLevels && ancestor && !['body', 'html'].includes(tagOf(ancestor)); level++) {
            const ancCands = standaloneCandidates(ancestor, f, ctx, options).filter((c) => c.kind !== 'css-class' && c.kind !== 'text');
            let best = null;
            for (const c of ancCands) {
                const found = safeResolve(c.locator, root, ctx);
                if (found.length === 1 && found[0] === ancestor && (!best || KIND_RANK[c.kind] < KIND_RANK[best.kind])) best = c;
            }
            if (best) {
                const order = KIND_RANK[best.kind] * 10 + level;
                for (const c of scopedCandidates(el, ancestor, best.locator, f, ctx)) semantic.push({ ...c, note: best.note, order, stability: weakerStability(stabilityOf(best.kind, best.locator), stabilityOf(c.kind, c.locator)) });
                css.push({ locator: f.chain(best.locator, f.call('locator', [uniqueCSSPath(el, ancestor, ctx, 3)])), label: 'scoped css', kind: 'scoped-css', note: best.note, order });
            }
            ancestor = parentOf(ancestor);
        }
        const byOrder = (a, b) => a.order - b.order;
        return { semantic: semantic.sort(byOrder), css: css.sort(byOrder) };
    }

    // Full analysis: primary locator (unique where at all possible), its match
    // count, and ranked alternatives with counts.
    function analyzeElement(el, framework, options = {}) {
        const lang = normalizeFramework(framework);
        // Java and C# are rendered by translating the JS result.
        if (lang === 'java' || lang === 'csharp') {
            const js = analyzeElement(el, 'js', options);
            const tr = (l) => translateLocator(l, lang);
            return {
                ...js,
                framework: lang,
                locator: tr(js.locator),
                alternatives: js.alternatives.map((a) => ({ ...a, locator: tr(a.locator) })),
                action: renderAction(js.actionKind, stripNote(tr(js.locator)), lang),
                assertion: renderAssertion(el, stripNote(tr(js.locator)), lang),
                jsLocator: js.jsLocator,
            };
        }
        const f = createFormatter(lang);
        const ctx = createContext();
        const root = docOf(el);
        const tag = tagOf(el);

        const standalone = standaloneCandidates(el, f, ctx, options);
        const scoped = ancestorScopedCandidates(el, f, ctx, root, options);
        const cssPath = { locator: f.page('locator', [uniqueCSSPath(el, root, ctx)]), label: 'css path', kind: 'css-path', note: 'CSS fallback — consider adding a data-testid' };

        // Evaluation order = preference order. Positional CSS only comes after
        // a semantic locator with .nth().
        const semanticRanked = [
            ...standalone.filter((c) => c.kind === 'testid'),
            ...standalone.filter((c) => c.kind === 'role-name' && (tag === 'td' || tag === 'th')),
            ...tableCellCandidates(el, f, ctx),
            ...standalone.filter((c) => c.kind !== 'testid' && c.kind !== 'css-class'),
            ...scoped.semantic,
        ];
        const positionalRanked = [...standalone.filter((c) => c.kind === 'css-class'), ...scoped.css, cssPath];

        const evaluated = [];
        const seen = new Set();
        // Time budget: on very large DOMs stop exploring scoped variants once the
        // budget is spent; the CSS path is always evaluated as a last resort.
        const budgetMs = options.budgetMs === undefined ? 400 : options.budgetMs;
        const now = () => (global.performance && global.performance.now ? global.performance.now() : Date.now());
        const deadline = now() + budgetMs;
        let budgetExceeded = false;
        const evaluate = (list, force = false) => {
            for (const c of list) {
                if (!force && now() > deadline) { budgetExceeded = true; break; }
                if (seen.has(c.locator)) continue;
                seen.add(c.locator);
                const found = safeResolve(c.locator, root, ctx);
                evaluated.push({ ...c, found, count: found.length, hit: found.includes(el) });
            }
        };

        evaluate(semanticRanked);
        let primary = evaluated.find((c) => c.count === 1 && c.hit);
        if (!primary) {
            const best = evaluated.find((c) => c.hit && c.kind !== 'role');
            if (best) {
                const idx = best.found.indexOf(el);
                primary = { ...best, locator: `${best.locator}.nth(${idx})`, count: 1, hit: true, note: `${best.count} elements match; .nth(${idx}) added — prefer a data-testid` };
                evaluated.splice(evaluated.indexOf(best) + 1, 0, primary);
                seen.add(primary.locator);
            }
        }
        evaluate(positionalRanked);
        if (!seen.has(cssPath.locator)) evaluate([cssPath], true);
        if (!primary) primary = evaluated.find((c) => c.count === 1 && c.hit);
        if (!primary) {
            const best = evaluated.find((c) => c.hit) || evaluated[evaluated.length - 1];
            const idx = Math.max(0, best.found.indexOf(el));
            primary = { ...best, locator: `${best.locator}.nth(${idx})`, count: 1, hit: true, note: `${best.count} elements match; .nth(${idx}) added — prefer a data-testid` };
        }

        let locator = primary.locator;
        if (primary.note) locator += f.note(primary.note);
        const actionKind = suggestAction(el, ctx);

        const maxAlternatives = options.maxAlternatives === undefined ? 5 : options.maxAlternatives;
        const alternatives = evaluated
            .filter((c) => c !== primary && c.locator !== primary.locator && c.hit)
            .sort((a, b) => (a.count === 1 ? 0 : 1) - (b.count === 1 ? 0 : 1))
            .slice(0, maxAlternatives)
            .map((c) => ({ locator: c.note ? c.locator + f.note(c.note) : c.locator, label: c.label, count: c.count, stability: c.stability || stabilityOf(c.kind, c.locator) }));

        return {
            locator,
            count: primary.count,
            stability: /\.nth\(\d+\)\s*$/.test(stripNote(primary.locator)) ? 'fragile' : (primary.stability || stabilityOf(primary.kind, primary.locator)),
            column: primary.column || null,
            alternatives,
            framework: lang,
            actionKind,
            action: renderAction(actionKind, primary.locator, lang),
            assertion: renderAssertion(el, primary.locator, lang, ctx),
            name: suggestName(el, ctx),
            budgetExceeded,
            // JS form is the canonical one stored for page objects / recordings.
            jsLocator: lang === 'js' ? locator : analyzeElement(el, 'js', { ...options, maxAlternatives: 0 }).locator,
        };
    }

    function generateBestLocator(el, framework, options) {
        return analyzeElement(el, framework, options).locator;
    }

    function generateAlternativeLocators(el, framework, options) {
        return analyzeElement(el, framework, options).alternatives;
    }

    // ------------------------------------------------------------------
    // Stability classification
    // ------------------------------------------------------------------

    // How likely a locator kind is to survive a redesign.
    //   strong  — developer-owned handles (test ids, labels, roles with names)
    //   good    — semantic but content-dependent (text, placeholder, filters)
    //   fragile — positional or styling-based (css classes, paths, .nth)
    function stabilityOf(kind, locator) {
        if (/\.nth\(\d+\)\s*$/.test(stripNote(locator || ''))) return 'fragile';
        if (['testid', 'label', 'role-name', 'alt'].includes(kind)) return 'strong';
        if (['css-class', 'scoped-css', 'css-path'].includes(kind)) return 'fragile';
        return 'good';
    }

    // ------------------------------------------------------------------
    // Multi-language rendering (Java / C#) from parsed steps
    // ------------------------------------------------------------------

    const LANGS = ['js', 'pytest', 'java', 'csharp'];
    const normalizeFramework = (fw) => (fw === 'python' ? 'pytest' : fw === 'ts' || fw === 'typescript' ? 'js' : fw === 'cs' || fw === 'dotnet' ? 'csharp' : LANGS.includes(fw) ? fw : 'js');

    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const pascal = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const jstr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

    function renderValue(v, lang) {
        if (v.type === 'string') return jstr(v.value);
        if (v.type === 'number') return String(v.value);
        if (v.type === 'bool') return lang === 'csharp' || lang === 'java' ? String(v.value) : v.value ? 'True' : 'False';
        if (v.type === 'regex') {
            const src = v.value.source;
            const ci = v.value.flags.includes('i');
            if (lang === 'java') return `Pattern.compile(${jstr(src)}${ci ? ', Pattern.CASE_INSENSITIVE' : ''})`;
            if (lang === 'csharp') return `new Regex(${jstr(src)}${ci ? ', RegexOptions.IgnoreCase' : ''})`;
        }
        throw new Error(`Cannot render value of type ${v.type} for ${lang}`);
    }

    // Java: page.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("x").setExact(true))
    function renderJavaStep(step, receiverClass) {
        const args = step.args.map((a) => renderValue(a, 'java'));
        const optEntries = Object.entries(step.opts);
        const optClass = `${receiverClass}.${pascal(step.name)}Options`;
        const setters = (entries) => entries.map(([k, v]) => `.set${pascal(k)}(${renderValue(v, 'java')})`).join('');
        switch (step.name) {
            case 'getByRole': {
                const role = `AriaRole.${step.args[0].value.toUpperCase()}`;
                return `getByRole(${role}${optEntries.length ? `, new ${optClass}()${setters(optEntries)}` : ''})`;
            }
            case 'filter':
                return `filter(new Locator.FilterOptions()${setters(optEntries)})`;
            case 'locator':
                return `locator(${args[0]}${optEntries.length ? `, new ${receiverClass}.LocatorOptions()${setters(optEntries)}` : ''})`;
            case 'nth': return `nth(${args[0]})`;
            case 'first': return 'first()';
            case 'last': return 'last()';
            case 'contentFrame': return 'contentFrame()';
            case 'frameLocator': return `frameLocator(${args[0]})`;
            case 'selectOption': return `selectOption(${args[0]})`;
            default:
                return `${step.name}(${args.join(', ')}${optEntries.length ? `, new ${optClass}()${setters(optEntries)}` : ''})`;
        }
    }

    // C#: page.GetByRole(AriaRole.Button, new() { Name = "x", Exact = true })
    function renderCSharpStep(step) {
        const args = step.args.map((a) => renderValue(a, 'csharp'));
        const optEntries = Object.entries(step.opts);
        const opts = optEntries.length ? `, new() { ${optEntries.map(([k, v]) => `${pascal(k)} = ${renderValue(v, 'csharp')}`).join(', ')} }` : '';
        switch (step.name) {
            case 'getByRole': return `GetByRole(AriaRole.${pascal(step.args[0].value.toLowerCase())}${opts})`;
            case 'filter': return `Filter(new() { ${optEntries.map(([k, v]) => `${pascal(k)} = ${renderValue(v, 'csharp')}`).join(', ')} })`;
            case 'nth': return `Nth(${args[0]})`;
            case 'first': return 'First';
            case 'last': return 'Last';
            case 'contentFrame': return 'ContentFrame';
            case 'selectOption': return `SelectOptionAsync(${args[0]})`;
            default: return `${pascal(step.name)}(${args.join(', ')}${opts})`;
        }
    }

    // Renders normalized steps (from parseChain) in the target language.
    function renderSteps(steps, framework) {
        const lang = normalizeFramework(framework);
        if (lang === 'js' || lang === 'pytest') {
            const f = createFormatter(lang);
            const parts = steps.map((s) => {
                const args = s.args.map((a) => (a.type === 'regex' ? { regex: a.value.source, flags: a.value.flags } : a.value));
                const opts = {};
                for (const [k, v] of Object.entries(s.opts)) opts[k] = v.type === 'regex' ? { regex: v.value.source, flags: v.value.flags } : v.value;
                if (s.name === 'contentFrame') return lang === 'pytest' ? 'content_frame' : 'contentFrame()';
                if (s.name === 'first' || s.name === 'last') return lang === 'pytest' ? s.name : `${s.name}()`;
                return f.call(s.name, args, Object.keys(opts).length ? opts : null);
            });
            return `page.${parts.join('.')}`;
        }
        let receiver = 'Page';
        const parts = steps.map((s) => {
            const rendered = lang === 'java' ? renderJavaStep(s, receiver) : renderCSharpStep(s);
            receiver = s.name === 'frameLocator' ? 'FrameLocator' : 'Locator';
            return rendered;
        });
        return `page.${parts.join('.')}`;
    }

    // Translates a JS/Python locator string (with optional trailing note) into
    // another supported language. Returns the input unchanged if it cannot be parsed.
    function translateLocator(locator, framework) {
        const lang = normalizeFramework(framework);
        const clean = stripNote(locator);
        const note = locator.slice(clean.length).replace(/^\s+(#|\/\/)\s*/, '');
        let steps;
        try { steps = parseChain(clean); } catch (_) { return locator; }
        const body = renderSteps(steps, lang);
        return note ? body + commentFor(lang, note) : body;
    }

    const commentFor = (lang, text) => (normalizeFramework(lang) === 'pytest' ? `  # ${text}` : `  // ${text}`);

    // ------------------------------------------------------------------
    // Actions and assertions
    // ------------------------------------------------------------------

    // What a test would most likely do with this element.
    // Returns { kind: 'click'|'fill'|'check'|'select'|'none', value? }.
    function suggestAction(el, ctx = createContext()) {
        const tag = tagOf(el);
        const role = getRole(el, ctx);
        if (tag === 'select') {
            const selected = el.options && el.options[el.selectedIndex];
            return { kind: 'select', value: selected ? norm(selected.text) : '' };
        }
        if (tag === 'textarea' || el.isContentEditable) return { kind: 'fill', value: '' };
        if (tag === 'input') {
            const type = (el.getAttribute('type') || 'text').toLowerCase();
            if (['checkbox', 'radio'].includes(type)) return { kind: 'check' };
            if (['button', 'submit', 'reset', 'image', 'file'].includes(type)) return { kind: 'click' };
            if (type === 'hidden') return { kind: 'none' };
            return { kind: 'fill', value: '' };
        }
        if (['checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio'].includes(role)) return { kind: 'check' };
        if (['textbox', 'searchbox', 'spinbutton', 'combobox'].includes(role)) return { kind: 'fill', value: '' };
        if (['button', 'link', 'tab', 'menuitem', 'option', 'treeitem'].includes(role)) return { kind: 'click' };
        if (el.closest('a[href], button, [role="button"], [role="link"], summary, label')) return { kind: 'click' };
        return { kind: 'none' };
    }

    const ACTION_TEMPLATES = {
        js:     { goto: (_, u) => `await page.goto(${jstr(u)});`, press: (l, k) => `await ${l}.press(${jstr(k)});`, click: (l) => `await ${l}.click();`, fill: (l, v) => `await ${l}.fill(${jstr(v)});`, check: (l) => `await ${l}.check();`, uncheck: (l) => `await ${l}.uncheck();`, select: (l, v) => `await ${l}.selectOption(${jstr(v)});` },
        pytest: { goto: (_, u) => `page.goto(${jstr(u)})`, press: (l, k) => `${l}.press(${jstr(k)})`, click: (l) => `${l}.click()`, fill: (l, v) => `${l}.fill(${jstr(v)})`, check: (l) => `${l}.check()`, uncheck: (l) => `${l}.uncheck()`, select: (l, v) => `${l}.select_option(${jstr(v)})` },
        java:   { goto: (_, u) => `page.navigate(${jstr(u)});`, press: (l, k) => `${l}.press(${jstr(k)});`, click: (l) => `${l}.click();`, fill: (l, v) => `${l}.fill(${jstr(v)});`, check: (l) => `${l}.check();`, uncheck: (l) => `${l}.uncheck();`, select: (l, v) => `${l}.selectOption(${jstr(v)});` },
        csharp: { goto: (_, u) => `await page.GotoAsync(${jstr(u)});`, press: (l, k) => `await ${l}.PressAsync(${jstr(k)});`, click: (l) => `await ${l}.ClickAsync();`, fill: (l, v) => `await ${l}.FillAsync(${jstr(v)});`, check: (l) => `await ${l}.CheckAsync();`, uncheck: (l) => `await ${l}.UncheckAsync();`, select: (l, v) => `await ${l}.SelectOptionAsync(${jstr(v)});` },
    };

    const ASSERT_TEMPLATES = {
        js:     { visible: (l) => `await expect(${l}).toBeVisible();`, text: (l, t) => `await expect(${l}).toHaveText(${jstr(t)});`, value: (l, v) => `await expect(${l}).toHaveValue(${jstr(v)});`, checked: (l) => `await expect(${l}).toBeChecked();` },
        pytest: { visible: (l) => `expect(${l}).to_be_visible()`, text: (l, t) => `expect(${l}).to_have_text(${jstr(t)})`, value: (l, v) => `expect(${l}).to_have_value(${jstr(v)})`, checked: (l) => `expect(${l}).to_be_checked()` },
        java:   { visible: (l) => `assertThat(${l}).isVisible();`, text: (l, t) => `assertThat(${l}).hasText(${jstr(t)});`, value: (l, v) => `assertThat(${l}).hasValue(${jstr(v)});`, checked: (l) => `assertThat(${l}).isChecked();` },
        csharp: { visible: (l) => `await Expect(${l}).ToBeVisibleAsync();`, text: (l, t) => `await Expect(${l}).ToHaveTextAsync(${jstr(t)});`, value: (l, v) => `await Expect(${l}).ToHaveValueAsync(${jstr(v)});`, checked: (l) => `await Expect(${l}).ToBeCheckedAsync();` },
    };

    // locator: rendered locator string (without note) in the given framework.
    function renderAction(action, locator, framework) {
        const t = ACTION_TEMPLATES[normalizeFramework(framework)];
        if (!action || action.kind === 'none' || !t[action.kind]) return '';
        return t[action.kind](locator, action.value == null ? '' : action.value);
    }

    // Best assertion for the element's current state.
    function renderAssertion(el, locator, framework, ctx = createContext()) {
        const t = ASSERT_TEMPLATES[normalizeFramework(framework)];
        const tag = tagOf(el);
        if (tag === 'input' && ['checkbox', 'radio'].includes((el.getAttribute('type') || '').toLowerCase())) return el.checked ? t.checked(locator) : t.visible(locator);
        if (tag === 'input' || tag === 'textarea') return el.value ? t.value(locator, el.value) : t.visible(locator);
        if (tag === 'select') return t.visible(locator);
        const text = norm(elementText(el, ctx));
        if (text && text.length <= MAX_ANCHOR_LENGTH && !looksLikeDynamicText(text)) return t.text(locator, text);
        return t.visible(locator);
    }

    // ------------------------------------------------------------------
    // Page-object naming and rendering
    // ------------------------------------------------------------------

    const ROLE_SUFFIX = {
        button: 'Button', link: 'Link', textbox: 'Input', searchbox: 'Input', spinbutton: 'Input', combobox: 'Select',
        listbox: 'Select', checkbox: 'Checkbox', radio: 'Radio', switch: 'Switch', heading: 'Heading', img: 'Image',
        cell: 'Cell', gridcell: 'Cell', row: 'Row', listitem: 'Item', tab: 'Tab', menuitem: 'MenuItem', option: 'Option',
        table: 'Table', dialog: 'Dialog', navigation: 'Nav', region: 'Section', slider: 'Slider', progressbar: 'Progress',
    };

    const words = (s) => norm(String(s || '')).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
    const camel = (ws) => ws.map((w, i) => (i === 0 ? w.toLowerCase() : pascal(w.toLowerCase()))).join('');

    // camelCase identifier such as "saveButton" or "emailInput".
    function suggestName(el, ctx = createContext()) {
        const tag = tagOf(el);
        const role = getRole(el, ctx);
        const { name } = getNameInfo(el, ctx);
        const base = (name && !looksLikeDynamicText(name) ? name : '')
            || norm(el.getAttribute('placeholder'))
            || TEST_ID_ATTRS.map((a) => el.getAttribute(a)).find(Boolean)
            || (FORM_TAGS.has(tag) ? '' : stableSegment(elementText(el, ctx)) || norm(elementText(el, ctx)))
            || el.id
            || role
            || tag;
        let ws = words(base).slice(0, 4);
        if (!ws.length) ws = [role || tag || 'element'];
        const suffix = ROLE_SUFFIX[role] || '';
        if (suffix && ws[ws.length - 1].toLowerCase() === suffix.toLowerCase()) ws.pop();
        let ident = camel(ws) + suffix;
        if (!/^[A-Za-z_]/.test(ident)) ident = `el${pascal(ident)}`;
        return ident || 'element';
    }

    const toSnake = (ident) => ident.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

    // entries: [{ name (camelCase), locator (JS form) }]. Returns source for a class.
    function renderPageObject(entries, framework, className = 'AppPage') {
        const lang = normalizeFramework(framework);
        const cls = pascal(words(className).map(pascal).join('') || 'AppPage');
        const seen = new Map();
        const unique = (n) => { const c = seen.get(n) || 0; seen.set(n, c + 1); return c ? `${n}${c + 1}` : n; };
        const rows = entries.map((e) => ({ name: unique(e.name || 'element'), locator: stripNote(translateLocator(stripNote(e.locator), lang)) }));
        if (lang === 'js') {
            return [
                `import { type Locator, type Page } from '@playwright/test';`, '',
                `export class ${cls} {`,
                `  constructor(private readonly page: Page) {}`, '',
                ...rows.map((r) => `  get ${r.name}(): Locator {\n    return this.${r.locator};\n  }\n`),
                `}`,
            ].join('\n');
        }
        if (lang === 'pytest') {
            return [
                `from playwright.sync_api import Locator, Page`, '', '',
                `class ${cls}:`,
                `    def __init__(self, page: Page) -> None:`,
                `        self.page = page`, '',
                ...rows.map((r) => `    @property\n    def ${toSnake(r.name)}(self) -> Locator:\n        return self.${r.locator}\n`),
            ].join('\n');
        }
        if (lang === 'java') {
            return [
                `import com.microsoft.playwright.Locator;`, `import com.microsoft.playwright.Page;`,
                `import com.microsoft.playwright.options.AriaRole;`, `import java.util.regex.Pattern;`, '',
                `public class ${cls} {`,
                `    private final Page page;`, '',
                `    public ${cls}(Page page) {`, `        this.page = page;`, `    }`, '',
                ...rows.map((r) => `    public Locator ${r.name}() {\n        return ${r.locator};\n    }\n`),
                `}`,
            ].join('\n');
        }
        return [
            `using System.Text.RegularExpressions;`, `using Microsoft.Playwright;`, '',
            `public class ${cls}`, `{`,
            `    private readonly IPage _page;`, '',
            `    public ${cls}(IPage page)`, `    {`, `        _page = page;`, `    }`, '',
            ...rows.map((r) => `    public ILocator ${pascal(r.name)} => _${r.locator};\n`),
            `}`,
        ].join('\n');
    }

    // ------------------------------------------------------------------
    // Recording: a captured interaction sequence rendered as a test
    // ------------------------------------------------------------------

    // steps: [{ locator (JS form), action: {kind, value} }]
    function renderRecording(steps, framework, url = '') {
        const lang = normalizeFramework(framework);
        const lines = steps.map((s) => renderAction(s.action, s.locator ? stripNote(translateLocator(stripNote(s.locator), lang)) : '', lang)).filter(Boolean);
        if (lang === 'js') return [`import { test, expect } from '@playwright/test';`, '', `test('recorded flow', async ({ page }) => {`, ...(url ? [`  await page.goto(${jstr(url)});`] : []), ...lines.map((l) => `  ${l}`), `});`].join('\n');
        if (lang === 'pytest') return [`from playwright.sync_api import Page, expect`, '', '', `def test_recorded_flow(page: Page) -> None:`, ...(url ? [`    page.goto(${jstr(url)})`] : []), ...lines.map((l) => `    ${l}`)].join('\n');
        if (lang === 'java') return [`@Test`, `void recordedFlow() {`, ...(url ? [`    page.navigate(${jstr(url)});`] : []), ...lines.map((l) => `    ${l}`), `}`].join('\n');
        return [`[Test]`, `public async Task RecordedFlow()`, `{`, ...(url ? [`    await Page.GotoAsync(${jstr(url)});`] : []), ...lines.map((l) => `    ${l.replace(/^await page\./, 'await Page.').replace(/^await Expect\(page\./, 'await Expect(Page.')}`), `}`].join('\n');
    }

    // Deep querySelector (pierces open shadow roots). Used by the DevTools pane.
    function deepQuerySelector(css, root = global.document) {
        return allElements(root, createContext()).find((el) => cssMatches(el, css)) || null;
    }

    // ------------------------------------------------------------------
    // Bulk verification
    // ------------------------------------------------------------------

    // Splits pasted code into candidate locator lines and counts each.
    function countMany(text, root = global.document) {
        const ctx = createContext();
        const out = [];
        for (const raw of String(text || '').split(/\r?\n/)) {
            const line = raw.trim();
            if (!line || /^(\/\/|#|\*|\/\*)/.test(line)) continue;
            if (!/\b(getBy\w+|get_by_\w+|locator|frameLocator|frame_locator)\s*\(|^(\/\/|xpath=|text=|css=|[.#\[])/i.test(line)) continue;
            try {
                const els = resolve(line, root, ctx);
                out.push({ input: line, count: els.length, error: null, elements: els });
            } catch (err) {
                out.push({ input: line, count: 0, error: err.message, elements: [] });
            }
        }
        return out;
    }

    // ------------------------------------------------------------------
    // Exports
    // ------------------------------------------------------------------

    global.PWLocatorCore = {
        TEST_ID_ATTRS,
        HIGHLIGHT_ATTR,
        createContext,
        getRole,
        getAccessibleName,
        getNameInfo,
        elementText,
        isAriaHidden,
        looksLikeDynamicText,
        isStableClass,
        isStableId,
        idSelector,
        uniqueCSSPath,
        createFormatter,
        stripNote,
        parameterizeLocator,
        canParameterize,
        parseChain,
        resolve,
        count,
        clearHighlights,
        highlight,
        findAndHighlight,
        analyzeElement,
        generateBestLocator,
        generateAlternativeLocators,
        stabilityOf,
        normalizeFramework,
        translateLocator,
        renderSteps,
        suggestAction,
        renderAction,
        renderAssertion,
        suggestName,
        renderPageObject,
        renderRecording,
        countMany,
        deepQuerySelector,
    };
    // Kept as a global for chrome.scripting.executeScript({ func }) callers.
    global.findAndHighlight = findAndHighlight;
})(typeof window !== 'undefined' ? window : globalThis);
