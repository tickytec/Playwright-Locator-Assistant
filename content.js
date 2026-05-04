// Pure helpers are defined outside the idempotency guard so executeScript injections
// can always call findAndHighlight regardless of whether the guard has run.

function getImplicitRole(element) {
    const explicitRole = element.getAttribute('role');
    if (explicitRole) return explicitRole;

    const tag = element.tagName.toLowerCase();
    const type = element.getAttribute('type');

    const tagRoles = {
        a: 'link', area: 'link', button: 'button',
        h1: 'heading', h2: 'heading', h3: 'heading',
        h4: 'heading', h5: 'heading', h6: 'heading',
        img: 'img', textarea: 'textbox', select: 'combobox',
        li: 'listitem', ul: 'list', ol: 'list',
        nav: 'navigation', form: 'form', dialog: 'dialog',
        table: 'table', tr: 'row', td: 'cell',
        thead: 'rowgroup', tbody: 'rowgroup', tfoot: 'rowgroup',
        fieldset: 'group', option: 'option', optgroup: 'group',
        progress: 'progressbar', meter: 'progressbar',
        article: 'article', aside: 'complementary', footer: 'contentinfo',
        header: 'banner', main: 'main', section: 'region',
        summary: 'button', details: 'group',
    };
    if (tag === 'th') return element.getAttribute('scope') === 'row' ? 'rowheader' : 'columnheader';
    if (tagRoles[tag]) return tagRoles[tag];
    // contenteditable acts as a textbox for Playwright's getByRole purposes
    const ce = element.getAttribute('contenteditable');
    if (ce === 'true' || ce === '') return 'textbox';

    if (tag === 'input') {
        const inputRoles = {
            button: 'button', submit: 'button', reset: 'button',
            checkbox: 'checkbox', radio: 'radio',
            text: 'textbox', email: 'textbox', password: 'textbox',
            search: 'textbox', tel: 'textbox', url: 'textbox',
            number: 'spinbutton', range: 'slider',
            date: 'textbox', time: 'textbox', 'datetime-local': 'textbox',
        };
        return inputRoles[type] || 'textbox';
    }
    return null;
}

function getAccessibleName(element) {
    // aria-labelledby has the highest ARIA priority
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
        const text = labelledBy.split(/\s+/)
            .map(id => document.getElementById(id)?.textContent?.trim() || '')
            .filter(Boolean)
            .join(' ');
        if (text) return text;
    }

    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    if (element.id) {
        const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        if (label) return (label.innerText || label.textContent).trim();
    }

    const tag = element.tagName.toLowerCase();
    const type = element.getAttribute('type');

    if (tag === 'input' && ['submit', 'button', 'reset'].includes(type) && element.value) {
        return element.value.trim();
    }

    if (tag === 'input' && type === 'image') {
        const alt = element.getAttribute('alt');
        if (alt) return alt.trim();
    }

    if (tag === 'img') {
        const alt = element.getAttribute('alt');
        if (alt) return alt.trim();
    }

    const text = (element.innerText || '').trim().replace(/\s+/g, ' ');
    if (text && text.length < 120) return text;

    const title = element.getAttribute('title');
    if (title) return title.trim();

    return '';
}

// Returns true when the text is likely a runtime value (rate, price, count, date, time)
// rather than a stable label. Used to avoid baking dynamic content into locators.
function looksLikeDynamicText(text) {
    if (!text) return false;
    const t = text.trim();
    // Pure numeric / currency / percentage value
    if (/^[+\-]?[$€£¥₹₩฿]?\s*\d[\d\s,._]*\s*[$€£¥₹₩฿%]?$/.test(t)) return true;
    // Decimal number with 2+ places embedded anywhere (exchange rates, prices: 1.0823, $42.99)
    if (/\b\d+[.,]\d{2,}\b/.test(t)) return true;
    // ISO date or slashed date
    if (/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/.test(t)) return true;
    // Time like 14:32
    if (/\b\d{1,2}:\d{2}\b/.test(t)) return true;
    // Counter in parens: "(42)", "(1,234)"
    if (/\(\s*\d[\d,.]*\s*\)/.test(t)) return true;
    // Count + common noun: "3 items", "42 results", "1,234 products"
    if (/\b\d[\d,]*\s+(item|result|product|notification|message|comment|order|review|user|record|error)s?\b/i.test(t)) return true;
    return false;
}

// Like getAccessibleName but also returns the source so generateBestLocator
// can distinguish stable developer-set labels (aria-label, label[for]) from
// visible text content which may be dynamic.
function getAccessibleNameWithSource(element) {
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
        const text = labelledBy.split(/\s+/)
            .map(id => document.getElementById(id)?.textContent?.trim() || '')
            .filter(Boolean).join(' ');
        if (text) return { name: text, source: 'aria-labelledby' };
    }
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return { name: ariaLabel.trim(), source: 'aria-label' };

    if (element.id) {
        const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        if (label) return { name: (label.innerText || label.textContent).trim(), source: 'label' };
    }
    const tag = element.tagName.toLowerCase();
    const type = element.getAttribute('type');
    if (tag === 'input' && ['submit', 'button', 'reset'].includes(type) && element.value)
        return { name: element.value.trim(), source: 'value' };
    if (tag === 'input' && type === 'image') {
        const alt = element.getAttribute('alt');
        if (alt) return { name: alt.trim(), source: 'alt' };
    }
    if (tag === 'img') {
        const alt = element.getAttribute('alt');
        if (alt) return { name: alt.trim(), source: 'alt' };
    }
    const text = (element.innerText || '').trim().replace(/\s+/g, ' ');
    if (text && text.length < 120) return { name: text, source: 'text' };
    const title = element.getAttribute('title');
    if (title) return { name: title.trim(), source: 'title' };
    return { name: '', source: null };
}

// Filters out hash-like or CSS-module-like generated class names.
function isStableClass(cls) {
    if (!cls || cls.length < 2) return false;
    // Contains a hash segment: 6+ hex chars, or looks like CSS module (contains _)
    if (/[0-9a-f]{6,}/i.test(cls)) return false;
    // Typical CSS-module pattern: ComponentName__block--modifier_hash
    if (/__.{1,20}__/.test(cls)) return false;
    return true;
}

function getRelativeCSS(element, parent) {
    const tag = element.tagName.toLowerCase();
    const stableClasses = Array.from(element.classList).filter(isStableClass);
    let selector = stableClasses.length > 0 ? `${tag}.${stableClasses.join('.')}` : tag;

    const siblings = Array.from(parent.children);
    const matchingSiblings = siblings.filter(s => s.matches(selector));

    if (matchingSiblings.length > 1) {
        // :nth-of-type counts by tag only, so use :nth-child for positional disambiguation.
        const nthChild = siblings.indexOf(element) + 1;
        selector = `${selector}:nth-child(${nthChild})`;
    }
    return selector;
}

// _depth: internal recursion guard. At depth > 0 (ancestor lookup) we skip
// full-page querySelectorAll sweeps and further recursion to prevent O(n²)
// hangs on large DOMs.
function generateBestLocator(element, framework, _depth = 0) {
    const isPytest = framework === 'pytest';
    const esc = (str) => str.replace(/"/g, '\\"');

    const fmt = (method, value, options = null) => {
        const m = isPytest ? method.replace(/([A-Z])/g, '_$1').toLowerCase() : method;
        const v = `"${esc(value)}"`;
        if (!options) return `page.${m}(${v})`;
        const opts = isPytest
            ? Object.entries(options).map(([k, val]) =>
                `${k}=${typeof val === 'boolean' ? (val ? 'True' : 'False') : `"${esc(val)}"`}`).join(', ')
            : `{ ${Object.entries(options).map(([k, val]) =>
                `${k}: ${typeof val === 'boolean' ? val : `"${esc(val)}"`}`).join(', ')} }`;
        return `page.${m}(${v}, ${opts})`;
    };

    const testId = element.getAttribute('data-testid') ||
                   element.getAttribute('data-qa') ||
                   element.getAttribute('data-test') ||
                   element.getAttribute('data-cy') ||
                   element.getAttribute('data-automation-id') ||
                   element.getAttribute('data-test-id');
    if (testId) return fmt('getByTestId', testId);

    const tag = element.tagName.toLowerCase();

    // Native <select>: generate a selectOption call so the locator is immediately
    // actionable. The current selection is used as the value — the user edits it
    // to the option they actually want to select in their test.
    if (tag === 'select') {
        const selectedOpt = element.options[element.selectedIndex];
        const selectedText = selectedOpt ? selectedOpt.text.trim() : '';
        const { name: selName, source: selSrc } = getAccessibleNameWithSource(element);
        const selDynamic = (selSrc === 'text' || selSrc === 'title') && looksLikeDynamicText(selName);
        let base;
        if (selName && !selDynamic) {
            base = fmt('getByLabel', selName, { exact: true });
        } else if (element.id) {
            base = `page.locator("#${esc(CSS.escape(element.id))}")`;
        } else {
            base = fmt('getByRole', 'combobox');
        }
        if (selectedText) {
            const m = isPytest ? 'select_option' : 'selectOption';
            return `${base}.${m}("${esc(selectedText)}")`;
        }
        return base;
    }

    // Table cells: anchor via the row so the locator isn't ambiguous across
    // the whole page. Strategy:
    //   <th>  → getByRole("columnheader"/"rowheader", { name })
    //   <td>  → getByRole("row", { name: stableAnchor }).getByRole("cell", { name })
    //           or .getByRole("cell").nth(colIndex) when cell content is dynamic
    //           or .nth(rowIndex)…nth(colIndex) when no stable anchor exists
    if (tag === 'td' || tag === 'th') {
        const cellText = (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ');

        if (tag === 'th') {
            const thRole = element.getAttribute('scope') === 'row' ? 'rowheader' : 'columnheader';
            if (cellText && !looksLikeDynamicText(cellText)) {
                return fmt('getByRole', thRole, { name: cellText, exact: true });
            }
        }

        const row = element.closest('tr');
        if (row) {
            const colIndex = Array.from(row.cells).indexOf(element);
            const cellDynamic = looksLikeDynamicText(cellText);

            // Prefer aria-label on the row; otherwise use the first stable sibling cell.
            let rowAnchor = row.getAttribute('aria-label') || '';
            if (!rowAnchor) {
                for (const cell of row.cells) {
                    if (cell === element) continue;
                    const t = (cell.innerText || cell.textContent || '').trim().replace(/\s+/g, ' ');
                    if (t && !looksLikeDynamicText(t) && t.length < 80) { rowAnchor = t; break; }
                }
            }

            if (rowAnchor) {
                // Use .filter({ hasText }) rather than getByRole("row", { name }) —
                // rows don't have a formal accessible name, so filter is more reliable.
                const filterArg = isPytest
                    ? `has_text="${esc(rowAnchor)}"`
                    : `{ hasText: "${esc(rowAnchor)}" }`;
                const rowLoc = `${fmt('getByRole', 'row')}.filter(${filterArg})`;
                if (!cellDynamic && cellText) {
                    const cellPart = fmt('getByRole', 'cell', { name: cellText, exact: true }).replace(/^page\./, '');
                    return `${rowLoc}.${cellPart}`;
                }
                const cellPart = fmt('getByRole', 'cell').replace(/^page\./, '') + `.nth(${colIndex})`;
                return `${rowLoc}.${cellPart}`;
            }

            // No stable anchor in any cell — fall back to positional indices.
            const table = element.closest('table');
            const allRows = table ? Array.from(table.querySelectorAll('tr')) : [];
            const rowIndex = allRows.indexOf(row);
            if (rowIndex >= 0) {
                const rowPart = fmt('getByRole', 'row').replace(/^page\./, '') + `.nth(${rowIndex})`;
                const cellPart = fmt('getByRole', 'cell').replace(/^page\./, '') + `.nth(${colIndex})`;
                const warn = isPytest
                    ? ' # WARNING: no stable row anchor; indices will break if rows are reordered.'
                    : ' // WARNING: no stable row anchor; indices will break if rows are reordered.';
                return `page.locator("table").${rowPart}.${cellPart}${warn}`;
            }
        }
        // No <tr> parent — fall through to generic logic.
    }

    const role = getImplicitRole(element);
    const { name: accName, source: accNameSource } = getAccessibleNameWithSource(element);

    // Text/title sources can contain dynamic runtime values (rates, prices, counts, dates).
    // Labels set explicitly by the developer (aria-label, aria-labelledby, label[for], value)
    // are stable and safe to use with exact matching.
    const nameIsDynamic = (accNameSource === 'text' || accNameSource === 'title')
                        && looksLikeDynamicText(accName);

    // img: getByAltText is more idiomatic than getByRole("img", { name })
    if (tag === 'img' && accName) return fmt('getByAltText', accName);

    // Role + stable accessible name.
    // Prefer getByLabel for form controls whose name comes from a <label> element —
    // it's shorter and more idiomatic Playwright than getByRole(..., { name }).
    if (role && accName && !nameIsDynamic) {
        const labeledFormRoles = new Set(['textbox', 'checkbox', 'radio', 'combobox', 'spinbutton', 'slider']);
        if (accNameSource === 'label' && labeledFormRoles.has(role)) {
            return fmt('getByLabel', accName, { exact: true });
        }
        return fmt('getByRole', role, { name: accName, exact: true });
    }

    // Placeholder text is a developer-set attribute — always stable
    const placeholder = element.getAttribute('placeholder');
    if (placeholder) return fmt('getByPlaceholder', placeholder, { exact: true });

    // Alt text on non-image elements (area, input[type=image])
    const altText = element.getAttribute('alt');
    if (altText) return fmt('getByAltText', altText, { exact: true });

    // Title attribute — skip if it looks like a tooltip showing a live value
    const title = element.getAttribute('title');
    if (title && !looksLikeDynamicText(title)) return fmt('getByTitle', title, { exact: true });

    // The checks below query the full DOM. Skip them during recursive ancestor
    // lookups (_depth > 0) to avoid O(n²) hangs on large pages.
    if (_depth === 0) {
        // Visible text — only when stable, leaf-like, and unique on the page.
        // Use textContent (no layout cost) for the page-wide scan; innerText
        // only on the candidate itself to confirm visible text matches.
        if (accName && !nameIsDynamic && accNameSource === 'text') {
            const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
                if (el.children.length >= 3) return false;
                return (el.textContent || '').trim().replace(/\s+/g, ' ') === accName;
            });
            if (candidates.length === 1 && candidates[0] === element) {
                return fmt('getByText', accName, { exact: true });
            }
        }

        // Unique role with no name needed
        if (role) {
            const allWithRole = Array.from(document.querySelectorAll('*')).filter(
                el => getImplicitRole(el) === role
            );
            if (allWithRole.length === 1) return fmt('getByRole', role);
        }

        // Chain via a stable ancestor (up to 3 levels)
        let ancestor = element.parentElement;
        for (let i = 0; i < 3 && ancestor && ancestor.tagName !== 'BODY'; i++) {
            const ancestorLocator = generateBestLocator(ancestor, framework, 1);
            if (ancestorLocator && !ancestorLocator.includes('locator(') && !ancestorLocator.includes('WARNING')) {
                if (role) {
                    const roleInAncestor = Array.from(ancestor.querySelectorAll('*')).filter(
                        el => getImplicitRole(el) === role
                    );
                    if (roleInAncestor.length === 1 && roleInAncestor[0] === element) {
                        const childPart = fmt('getByRole', role).replace(/^page\./, '');
                        return `${ancestorLocator}.${childPart}`;
                    }
                    if (accName && !nameIsDynamic) {
                        const roleNameInAncestor = roleInAncestor.filter(
                            el => getAccessibleName(el) === accName
                        );
                        if (roleNameInAncestor.length === 1 && roleNameInAncestor[0] === element) {
                            const childPart = fmt('getByRole', role, { name: accName, exact: true }).replace(/^page\./, '');
                            return `${ancestorLocator}.${childPart}`;
                        }
                    }
                }
                const relCSS = getRelativeCSS(element, ancestor);
                try {
                    if (ancestor.querySelectorAll(relCSS).length === 1) {
                        return `${ancestorLocator}.locator("${esc(relCSS)}")`;
                    }
                } catch (_) {}
            }
            ancestor = ancestor.parentElement;
        }
    }

    const cssSelector = getRelativeCSS(element, element.parentElement);
    const comment = isPytest
        ? '# WARNING: CSS selector fallback. Consider adding a data-testid.'
        : '// WARNING: CSS selector fallback. Consider adding a data-testid.';
    return `page.locator("${esc(cssSelector)}") ${comment}`;
}

// Splits a locator chain (e.g. page.getByRole("nav").getByRole("link", { name: "x" }))
// into individual call strings, respecting quote and brace depth.
function splitLocatorChain(str) {
    const parts = [];
    let depth = 0;
    let inStr = null;
    let start = 0;

    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (inStr) {
            if (ch === '\\') { i++; continue; }
            if (ch === inStr) inStr = null;
        } else if (ch === '"' || ch === "'" || ch === '`') {
            inStr = ch;
        } else if (ch === '(' || ch === '{') {
            depth++;
        } else if (ch === ')' || ch === '}') {
            depth--;
        } else if (ch === '.' && depth === 0 && i > start) {
            parts.push(str.slice(start, i));
            start = i + 1;
        }
    }
    if (start < str.length) parts.push(str.slice(start));
    return parts;
}

// Parses JS-style { name: "...", exact: true } or Python-style name="...", exact=True
function parseOptions(raw) {
    const opts = {};
    // name
    const nameMatch = raw.match(/name\s*[=:]\s*["']([^"']*)["']/);
    if (nameMatch) opts.name = nameMatch[1];
    // exact
    const exactMatch = raw.match(/exact\s*[=:]\s*(true|True|false|False)/);
    if (exactMatch) opts.exact = exactMatch[1].toLowerCase() === 'true';
    return opts;
}

function findAndHighlight(locatorString) {
    document.querySelectorAll('[data-playwright-verifier-highlight]').forEach(el => {
        el.style.outline = '';
        el.removeAttribute('data-playwright-verifier-highlight');
    });

    const highlight = (els) => {
        els.forEach(el => {
            el.style.outline = '3px solid #ff4757';
            el.setAttribute('data-playwright-verifier-highlight', 'true');
        });
        return els.length;
    };

    // Normalize: strip page. prefix, WARNING comments, Python snake_case → camelCase
    let normalized = locatorString.trim()
        .replace(/^page\./, '')
        .replace(/\s+(#|\/\/) WARNING:.*$/m, '')
        .replace(/get_by_(\w)/g, (_, c) => `getBy${c.toUpperCase()}`)
        .replace(/\bselect_option\b/g, 'selectOption')
        .replace(/\bframe_locator\b/g, 'frameLocator');

    // Strip trailing Playwright action calls (.selectOption, .fill, .click, …) —
    // they are not locator steps; stop at the element and highlight it.
    normalized = normalized.replace(
        /\.(selectOption|fill|click|check|uncheck|tap|focus|blur|press(?:Sequentially)?|type|clear|hover|dblclick|setInputFiles|waitFor|evaluate|screenshot|getAttribute|dispatchEvent|scrollIntoViewIfNeeded|dragTo|selectText|nth|first|last)\s*\([^)]*\)\s*$/,
        ''
    );

    // XPath — starts with // or ./ or explicit xpath= prefix
    const xpathExpr = normalized.startsWith('xpath=') ? normalized.slice(6)
                    : /^(\/\/|\.\/)/.test(normalized) ? normalized : null;
    if (xpathExpr) {
        try {
            const result = document.evaluate(xpathExpr, document, null,
                XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            const els = [];
            for (let i = 0; i < result.snapshotLength; i++) {
                const n = result.snapshotItem(i);
                if (n.nodeType === 1) els.push(n);
            }
            return highlight(els);
        } catch (_) { return 0; }
    }

    // Playwright text= shorthand
    if (/^text=(.+)/.test(normalized)) {
        const val = normalized.slice(5);
        const els = Array.from(document.querySelectorAll('*')).filter(el => {
            const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
            return t === val || t.includes(val);
        }).filter(el => !Array.from(el.querySelectorAll('*')).some(c =>
            (c.textContent || '').trim().replace(/\s+/g, ' ').includes(val)
        ));
        return highlight(els);
    }

    // Playwright css= shorthand — strip prefix and fall through to CSS handler
    if (normalized.startsWith('css=')) normalized = normalized.slice(4);

    // Plain CSS selector (no getBy*/locator() pattern present)
    if (!/\b(getBy\w+|locator)\s*\(/.test(normalized)) {
        try {
            const els = Array.from(document.querySelectorAll(normalized));
            if (els.length > 0) return highlight(els);
        } catch (_) { /* not valid CSS */ }
        return 0;
    }

    // Split chain (e.g. getByRole("nav").getByRole("link", { name: "Home" }))
    const chain = splitLocatorChain(normalized).filter(p => /\w/.test(p));
    let scope = [document]; // array of elements or document as root

    for (const part of chain) {
        const methodMatch = part.match(/^(getBy\w+|locator|filter)\s*\(([\s\S]*)\)$/);
        if (!methodMatch) continue;

        const method = methodMatch[1];
        const rawArgs = methodMatch[2].trim();

        // .filter() narrows the current scope rather than descending into children.
        // Handles both JS { hasText: "..." } and Python has_text="..." forms.
        if (method === 'filter') {
            const hasTextMatch = rawArgs.match(/(?:hasText|has_text)\s*[=:]\s*["']([^"']*)["']/);
            if (hasTextMatch) {
                const needle = hasTextMatch[1];
                scope = scope.filter(el => {
                    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
                    return t.includes(needle);
                });
            }
            if (scope.length === 0) break;
            continue;
        }

        // Extract first quoted argument
        const firstArgMatch = rawArgs.match(/^["']([^"']*)["']/);
        const value = firstArgMatch ? firstArgMatch[1] : '';
        const opts = parseOptions(rawArgs);
        const exact = opts.exact !== false; // default true for our generated locators

        let nextScope = [];

        // Exclude non-rendered elements whose textContent would produce false positives
        // (e.g. <script> contains JS source that would match getByText queries).
        // We intentionally include hidden/fixed/sticky elements here — those are valid
        // Playwright targets and were previously excluded by the overly strict
        // checkVisibility() / offsetParent filters, causing ×0 for all getBy* locators.
        const _skipTags = new Set(['script', 'style', 'head', 'meta', 'link', 'title', 'base', 'noscript', 'template']);

        for (const root of scope) {
            const allEls = Array.from(
                (root === document ? document : root).querySelectorAll('*')
            ).filter(el => !_skipTags.has(el.tagName.toLowerCase()));

            let matches = [];

            switch (method) {
                case 'getByRole': {
                    const nameVal = opts.name;
                    matches = allEls.filter(el => {
                        if (getImplicitRole(el) !== value) return false;
                        if (nameVal !== undefined) {
                            const elName = getAccessibleName(el);
                            return exact ? elName === nameVal : elName.includes(nameVal);
                        }
                        return true;
                    });
                    break;
                }
                case 'getByText':
                    matches = allEls.filter(el => {
                        const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
                        const hit = exact ? text === value : text.includes(value);
                        if (!hit) return false;
                        // Exclude ancestors where a child already matches the same text
                        return !Array.from(el.querySelectorAll('*')).some(child => {
                            const ct = (child.innerText || child.textContent || '').trim().replace(/\s+/g, ' ');
                            return exact ? ct === value : ct.includes(value);
                        });
                    });
                    break;
                case 'getByLabel': {
                    // Playwright's getByLabel targets form controls only, not arbitrary elements.
                    const labeledTags = new Set(['input', 'select', 'textarea', 'button']);
                    matches = allEls.filter(el => {
                        const t = el.tagName.toLowerCase();
                        if (!labeledTags.has(t) && !el.getAttribute('role')) return false;
                        const name = getAccessibleName(el);
                        return exact ? name === value : name.includes(value);
                    });
                    break;
                }
                case 'getByPlaceholder':
                    matches = allEls.filter(el => {
                        const ph = el.getAttribute('placeholder') || '';
                        return exact ? ph === value : ph.includes(value);
                    });
                    break;
                case 'getByAltText':
                    matches = allEls.filter(el => {
                        const alt = el.getAttribute('alt') || '';
                        return exact ? alt === value : alt.includes(value);
                    });
                    break;
                case 'getByTitle':
                    matches = allEls.filter(el => {
                        const t = el.getAttribute('title') || '';
                        return exact ? t === value : t.includes(value);
                    });
                    break;
                case 'getByTestId':
                    matches = allEls.filter(el =>
                        (el.getAttribute('data-testid') ||
                         el.getAttribute('data-qa') ||
                         el.getAttribute('data-test') ||
                         el.getAttribute('data-cy') ||
                         el.getAttribute('data-automation-id') ||
                         el.getAttribute('data-test-id')) === value
                    );
                    break;
                case 'locator':
                    try {
                        const cssVal = value;
                        const parentEl = root === document ? document.documentElement : root;
                        matches = Array.from(parentEl.querySelectorAll(cssVal));
                    } catch (_) { /* invalid CSS */ }
                    break;
                default:
                    break;
            }

            nextScope = nextScope.concat(matches);
        }

        scope = nextScope;
        if (scope.length === 0) break;
    }

    return highlight(scope.filter(x => x !== document));
}

// Always-on cursor tracking — must know what's under the cursor the instant
// the keyboard shortcut fires, before any dropdown has a chance to close.
if (!window.__pwCursorTracking) {
    window.__pwCursorTracking = true;
    window.__pwHoveredEl = null;
    window.__pwMouseCoords = { x: 0, y: 0 };
    // mousemove tracks exact coordinates; elementFromPoint at shortcut time
    // is more reliable than mouseover for complex dropdowns (overlay layers,
    // pointer-events stacking, custom event handling, etc.).
    document.addEventListener('mousemove', e => {
        window.__pwMouseCoords = { x: e.clientX, y: e.clientY };
    }, { capture: true, passive: true });
    document.addEventListener('mouseover', e => {
        window.__pwHoveredEl = e.target;
    }, { capture: true, passive: true });
    document.addEventListener('mouseleave', () => {
        window.__pwHoveredEl = null;
    }, { capture: true, passive: true });
    // Native <select> dropdowns on all platforms capture keyboard events at the
    // OS level, so the extension shortcut never fires while the popup is open.
    // Store the select on mousedown (before the OS popup appears) and again on
    // change (after the user picks an option) so pressing the shortcut right
    // after either interaction finds the right element and the right value.
    document.addEventListener('mousedown', e => {
        if (e.target?.tagName?.toLowerCase() === 'select') {
            window.__pwLastInteractedSelect = e.target;
        }
    }, { capture: true, passive: true });
    document.addEventListener('change', e => {
        if (e.target?.tagName?.toLowerCase() === 'select') {
            window.__pwLastInteractedSelect = e.target;
        }
    }, { capture: true, passive: true });
}

// Generates alternative locator strategies for the same element — no uniqueness
// checks (those are expensive); the user can verify any alternative via section 2.
function generateAlternativeLocators(element, framework, primaryLocator) {
    const isPytest = framework === 'pytest';
    const esc = (s) => s.replace(/"/g, '\\"');
    const fmt = (method, value, options = null) => {
        const m = isPytest ? method.replace(/([A-Z])/g, '_$1').toLowerCase() : method;
        const v = `"${esc(value)}"`;
        if (!options) return `page.${m}(${v})`;
        const opts = isPytest
            ? Object.entries(options).map(([k, val]) => `${k}=${typeof val === 'boolean' ? (val ? 'True' : 'False') : `"${esc(val)}"`}`).join(', ')
            : `{ ${Object.entries(options).map(([k, val]) => `${k}: ${typeof val === 'boolean' ? val : `"${esc(val)}"`}`).join(', ')} }`;
        return `page.${m}(${v}, ${opts})`;
    };

    const results = [];
    const primaryClean = (primaryLocator || '').replace(/\s+(#|\/\/) WARNING:.*$/m, '').trim();
    const seen = new Set([primaryClean]);

    const add = (locator, label) => {
        if (!locator) return;
        const clean = locator.replace(/\s+(#|\/\/) WARNING:.*$/m, '').trim();
        if (!clean || seen.has(clean)) return;
        seen.add(clean);
        results.push({ locator: clean, label });
    };

    const tag = element.tagName.toLowerCase();
    const role = getImplicitRole(element);
    const { name: accName, source: accNameSource } = getAccessibleNameWithSource(element);
    const nameIsDynamic = (accNameSource === 'text' || accNameSource === 'title') && looksLikeDynamicText(accName);

    for (const attr of ['data-testid', 'data-qa', 'data-test', 'data-cy', 'data-automation-id', 'data-test-id']) {
        const val = element.getAttribute(attr);
        if (val) add(fmt('getByTestId', val), attr);
    }

    const alt = element.getAttribute('alt');
    if (alt) add(fmt('getByAltText', alt, { exact: true }), 'getByAltText');

    if (accName && !nameIsDynamic && accNameSource === 'label') {
        add(fmt('getByLabel', accName, { exact: true }), 'getByLabel');
    }

    if (role && accName && !nameIsDynamic) {
        add(fmt('getByRole', role, { name: accName, exact: true }), 'getByRole');
    }

    if (role) add(fmt('getByRole', role), 'getByRole (no name)');

    const placeholder = element.getAttribute('placeholder');
    if (placeholder) add(fmt('getByPlaceholder', placeholder, { exact: true }), 'getByPlaceholder');

    if (accName && !nameIsDynamic && accNameSource === 'text') {
        add(fmt('getByText', accName, { exact: true }), 'getByText');
    }

    const title = element.getAttribute('title');
    if (title && !looksLikeDynamicText(title)) {
        add(fmt('getByTitle', title, { exact: true }), 'getByTitle');
    }

    if (element.id) add(`page.locator("#${CSS.escape(element.id)}")`, 'css #id');

    const stableClasses = Array.from(element.classList).filter(isStableClass);
    if (stableClasses.length > 0) {
        add(`page.locator("${tag}.${stableClasses.join('.')}")`, 'css .class');
    }

    return results.slice(0, 5);
}

// Replaces concrete text values in a locator with descriptive variable names,
// making it immediately usable as a parameterized test helper.
// Only replaces the "content" arguments (row/cell names, selectOption values);
// stable developer-set labels (getByLabel, getByPlaceholder, etc.) are left as-is.
function parameterizeLocator(locator, isPytest) {
    const text = locator.replace(/\s+(#|\/\/) WARNING:.*$/m, '').trim();
    if (isPytest) {
        return text
            .replace(/\.filter\(has_text="[^"]*"\)/, '.filter(has_text=row_text)')
            .replace(/\bget_by_role\("row",(\s*name=)"[^"]*"/, (_, sep) => `get_by_role("row",${sep}row_text`)
            .replace(/\bget_by_role\("cell",(\s*name=)"[^"]*"/, (_, sep) => `get_by_role("cell",${sep}cell_value`)
            .replace(/\.select_option\("[^"]*"\)/, '.select_option(option_text)');
    }
    return text
        .replace(/\.filter\(\{\s*hasText:\s*"[^"]*"\s*\}\)/, '.filter({ hasText: rowText })')
        .replace(/\bgetByRole\("row",(\s*\{\s*name:\s*)"[^"]*"/, (_, sep) => `getByRole("row",${sep}rowText`)
        .replace(/\bgetByRole\("cell",(\s*\{\s*name:\s*)"[^"]*"/, (_, sep) => `getByRole("cell",${sep}cellValue`)
        .replace(/\.selectOption\("[^"]*"\)/, '.selectOption(optionText)');
}

// --- Stateful init: guarded so re-injection is idempotent ---
if (!window.__playwrightLocatorAssistantLoaded) {
    window.__playwrightLocatorAssistantLoaded = true;

    let isPickingMode = false;
    let locatorDisplayDiv = null;
    let pickingBadgeDiv = null;
    let currentFramework = 'pytest';
    let hoveredElement = null;

    function clearHoverHighlight() {
        if (hoveredElement) {
            hoveredElement.style.outline = '';
            hoveredElement.removeAttribute('data-pw-picking-hover');
            hoveredElement = null;
        }
    }

    function handleMouseOver(event) {
        if (!isPickingMode) return;
        clearHoverHighlight();
        hoveredElement = event.target;
        if (hoveredElement && hoveredElement !== pickingBadgeDiv) {
            hoveredElement.style.outline = '2px dashed #4299e1';
            hoveredElement.setAttribute('data-pw-picking-hover', 'true');
        }
    }

    function showPickingBadge() {
        if (pickingBadgeDiv) return;
        pickingBadgeDiv = document.createElement('div');
        pickingBadgeDiv.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#282c34;color:#abb2bf;padding:10px 18px;border-radius:20px;border:1px solid #4299e1;font-family:system-ui,sans-serif;font-size:13px;z-index:2147483647;box-shadow:0 4px 12px rgba(0,0,0,0.4);pointer-events:none;white-space:nowrap;';
        pickingBadgeDiv.innerHTML = '🎯 <b style="color:#61afef">Picking</b> — hover an element, then <b style="color:#98c379">click</b> or press <b style="color:#98c379">Enter</b> &nbsp;·&nbsp; <span style="color:#e06c75">Esc</span> to cancel';
        document.body.appendChild(pickingBadgeDiv);
    }

    function hidePickingBadge() {
        if (pickingBadgeDiv) {
            pickingBadgeDiv.remove();
            pickingBadgeDiv = null;
        }
    }

    function hideLocatorDisplay() {
        if (locatorDisplayDiv) {
            if (locatorDisplayDiv.__pwCleanup) locatorDisplayDiv.__pwCleanup();
            locatorDisplayDiv.remove();
            locatorDisplayDiv = null;
        }
        // Clear any highlights set by the uniqueness check
        document.querySelectorAll('[data-playwright-verifier-highlight]').forEach(el => {
            el.style.outline = '';
            el.removeAttribute('data-playwright-verifier-highlight');
        });
    }

    function displayLocatorOnPage(text, isError = false, matchCount = null, alternatives = []) {
        hideLocatorDisplay();
        locatorDisplayDiv = document.createElement('div');
        const color = isError ? '#e06c75' : '#61afef';
        locatorDisplayDiv.style.cssText = `position:fixed;top:20px;right:20px;background:#282c34;color:#abb2bf;padding:14px 16px;border-radius:8px;border-left:4px solid ${color};font-family:'Menlo','Monaco','Courier New',monospace;font-size:13px;z-index:2147483647;box-shadow:0 8px 20px rgba(0,0,0,0.3);max-width:580px;min-width:280px;`;

        // Drag support
        let dragState = null;
        const onMove = e => {
            if (!dragState) return;
            locatorDisplayDiv.style.right = 'auto';
            locatorDisplayDiv.style.left = `${dragState.origLeft + e.clientX - dragState.startX}px`;
            locatorDisplayDiv.style.top  = `${dragState.origTop  + e.clientY - dragState.startY}px`;
        };
        const onUp = () => { dragState = null; };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        locatorDisplayDiv.__pwCleanup = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        // Top row: code + match badge
        const topRow = document.createElement('div');
        topRow.style.cssText = 'display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;cursor:move;';
        topRow.addEventListener('mousedown', e => {
            if (e.target.tagName === 'CODE') return;
            const r = locatorDisplayDiv.getBoundingClientRect();
            dragState = { startX: e.clientX, startY: e.clientY, origLeft: r.left, origTop: r.top };
            e.preventDefault();
        });

        const code = document.createElement('code');
        code.textContent = text;
        code.style.cssText = 'white-space:pre-wrap;word-break:break-all;user-select:all;flex-grow:1;line-height:1.5;cursor:text;';
        topRow.appendChild(code);

        if (!isError && matchCount !== null) {
            const badge = document.createElement('span');
            const ok = matchCount === 1;
            badge.textContent = ok ? `✓ 1` : (matchCount === 0 ? `✗ 0` : `⚠ ${matchCount}`);
            badge.title = ok ? 'Unique match' : matchCount === 0 ? 'No elements found on this page' : `${matchCount} elements match — not unique`;
            badge.style.cssText = `flex-shrink:0;padding:2px 8px;border-radius:10px;font-family:system-ui,sans-serif;font-size:11px;font-weight:bold;color:#282c34;background:${ok ? '#98c379' : matchCount === 0 ? '#e06c75' : '#e5c07b'};cursor:default;`;
            topRow.appendChild(badge);
        }
        locatorDisplayDiv.appendChild(topRow);

        // Button row
        const btnWrap = document.createElement('div');
        btnWrap.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';

        if (!isError) {
            let displayedText = text;

            const copyBtn = document.createElement('button');
            copyBtn.textContent = 'Copy';
            copyBtn.style.cssText = 'background:#61afef;color:#282c34;border:none;padding:5px 11px;border-radius:5px;cursor:pointer;font-size:12px;font-weight:bold;';
            copyBtn.onclick = () => {
                const pure = displayedText.replace(/\s+(#|\/\/) WARNING:.*$/m, '').trim();
                navigator.clipboard.writeText(pure).then(() => {
                    copyBtn.textContent = 'Copied!';
                    copyBtn.style.backgroundColor = '#98c379';
                    setTimeout(() => { copyBtn.textContent = 'Copy'; copyBtn.style.backgroundColor = '#61afef'; }, 2000);
                });
            };
            btnWrap.appendChild(copyBtn);

            const isPytest = /\bget_by_/.test(text);
            const canParameterize = isPytest
                ? /\.filter\(has_text="|get_by_role\("(row|cell)",\s*name="|\.select_option\("/.test(text)
                : /\.filter\(\{\s*hasText:|getByRole\("(row|cell)",[\s\S]*?\{\s*name:\s*"|\.selectOption\("/.test(text);

            if (canParameterize) {
                const varBtn = document.createElement('button');
                let varMode = false;
                varBtn.textContent = '{ }';
                varBtn.title = 'Replace text values with variable names';
                varBtn.style.cssText = 'background:#c678dd;color:#282c34;border:none;padding:5px 11px;border-radius:5px;cursor:pointer;font-size:12px;font-weight:bold;';
                varBtn.onclick = () => {
                    varMode = !varMode;
                    displayedText = varMode ? parameterizeLocator(text, isPytest) : text;
                    code.textContent = displayedText;
                    varBtn.style.backgroundColor = varMode ? '#98c379' : '#c678dd';
                    varBtn.textContent = varMode ? 'Original' : '{ }';
                };
                btnWrap.appendChild(varBtn);
            }
        }

        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.style.cssText = 'background:#4b5263;color:#abb2bf;border:none;padding:5px 11px;border-radius:5px;cursor:pointer;font-size:12px;';
        closeBtn.onclick = hideLocatorDisplay;
        btnWrap.appendChild(closeBtn);
        locatorDisplayDiv.appendChild(btnWrap);

        // Alternatives section
        if (!isError && alternatives && alternatives.length > 0) {
            const altToggle = document.createElement('button');
            altToggle.style.cssText = 'margin-top:10px;background:none;border:none;color:#5c6370;cursor:pointer;font-size:11px;padding:0;display:block;font-family:system-ui,sans-serif;';
            let altOpen = false;

            const altList = document.createElement('div');
            altList.style.cssText = 'display:none;margin-top:8px;border-top:1px solid #3e4452;padding-top:8px;';

            alternatives.forEach(({ locator: altLoc, label }) => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';

                const lbl = document.createElement('span');
                lbl.textContent = label;
                lbl.style.cssText = 'flex-shrink:0;font-family:system-ui,sans-serif;font-size:10px;padding:1px 6px;border-radius:8px;background:#3e4452;color:#abb2bf;white-space:nowrap;';

                const altCode = document.createElement('code');
                altCode.textContent = altLoc;
                altCode.style.cssText = 'flex-grow:1;font-size:11px;white-space:pre-wrap;word-break:break-all;user-select:all;color:#abb2bf;line-height:1.4;';

                const altCopy = document.createElement('button');
                altCopy.textContent = 'Copy';
                altCopy.style.cssText = 'flex-shrink:0;background:#3e4452;color:#abb2bf;border:none;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:11px;';
                altCopy.onclick = () => {
                    navigator.clipboard.writeText(altLoc).then(() => {
                        altCopy.textContent = '✓';
                        altCopy.style.color = '#98c379';
                        setTimeout(() => { altCopy.textContent = 'Copy'; altCopy.style.color = '#abb2bf'; }, 1500);
                    });
                };

                row.appendChild(lbl); row.appendChild(altCode); row.appendChild(altCopy);
                altList.appendChild(row);
            });

            const updateToggle = () => {
                altToggle.textContent = `${altOpen ? '▼' : '▶'} ${alternatives.length} alternative${alternatives.length > 1 ? 's' : ''}`;
                altList.style.display = altOpen ? 'block' : 'none';
            };
            updateToggle();
            altToggle.onclick = () => { altOpen = !altOpen; updateToggle(); };

            locatorDisplayDiv.appendChild(altToggle);
            locatorDisplayDiv.appendChild(altList);
        }

        document.body.appendChild(locatorDisplayDiv);
    }

    function captureElement(target) {
        disablePickingMode();
        window.__pwLastInteractedSelect = null;
        try {
            const inIframe = target.ownerDocument !== document;
            const inShadowDOM = (() => {
                let n = target;
                while (n) { if (n instanceof ShadowRoot) return true; n = n.parentNode; }
                return false;
            })();

            let locator = generateBestLocator(target, currentFramework);
            const fw = currentFramework;

            if (inIframe && locator) {
                locator += fw === 'pytest'
                    ? ' # WARNING: element is inside an <iframe> — wrap with frame_locator() in your test.'
                    : ' // WARNING: element is inside an <iframe> — wrap with frameLocator() in your test.';
            } else if (inShadowDOM && locator) {
                locator += fw === 'pytest'
                    ? ' # WARNING: element is inside a Shadow DOM — locator may need a pierce: selector.'
                    : ' // WARNING: element is inside a Shadow DOM — locator may need a pierce: selector.';
            }

            if (locator) {
                const cleanLocator = locator.replace(/\s+(#|\/\/) WARNING:.*$/m, '').trim();
                const matchCount = findAndHighlight(cleanLocator);
                const alternatives = generateAlternativeLocators(target, fw, locator);

                displayLocatorOnPage(locator, false, matchCount, alternatives);
                chrome.runtime.sendMessage({ action: 'elementPicked', locator });
                chrome.storage.local.get(['locatorHistory'], r => {
                    const h = r.locatorHistory || [];
                    h.unshift(cleanLocator);
                    chrome.storage.local.set({ locatorHistory: h.slice(0, 8), lastGeneratedLocator: locator });
                });
            } else {
                displayLocatorOnPage('Could not generate a unique locator.', true, null, []);
            }
        } catch (err) {
            displayLocatorOnPage(`An error occurred: ${err.message}`, true, null, []);
        }
    }

    function handlePickingKey(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            disablePickingMode();
        } else if (event.key === 'Enter' && hoveredElement) {
            // Capture the hovered element without triggering its click/select handler.
            // Useful for dropdown items — hover over the option, press Enter.
            event.preventDefault();
            event.stopPropagation();
            captureElement(hoveredElement);
        }
        // All other keys (arrows, etc.) pass through so dropdown navigation still works.
    }

    function handlePageClick(event) {
        if (!isPickingMode) return;
        event.preventDefault();
        event.stopPropagation();
        captureElement(event.target);
    }

    function enablePickingMode(framework) {
        if (isPickingMode) return;
        isPickingMode = true;
        currentFramework = framework;
        hoveredElement = null;
        hideLocatorDisplay();
        showPickingBadge();
        document.addEventListener('mouseover', handleMouseOver, { capture: true });
        document.addEventListener('click', handlePageClick, { capture: true });
        document.addEventListener('keydown', handlePickingKey, { capture: true });
        document.body.style.cursor = 'crosshair';
    }

    function disablePickingMode() {
        if (!isPickingMode) return;
        isPickingMode = false;
        clearHoverHighlight();
        hidePickingBadge();
        document.removeEventListener('mouseover', handleMouseOver, { capture: true });
        document.removeEventListener('click', handlePageClick, { capture: true });
        document.removeEventListener('keydown', handlePickingKey, { capture: true });
        document.body.style.cursor = '';
    }

    // fromShortcut=true  → keyboard shortcut path: immediately capture the element
    //                       under the cursor (elementFromPoint + select fallbacks).
    // fromShortcut=false → popup button path: always enter interactive picking mode
    //                       so the user can click an element. Never use stale coords.
    window.__pwTogglePicking = (framework, fromShortcut = false) => {
        if (isPickingMode) {
            disablePickingMode();
            return;
        }

        if (fromShortcut) {
            // elementFromPoint is more reliable than mouseover for complex dropdowns
            // (overlay layers can swallow mouseover without updating __pwHoveredEl).
            const coords = window.__pwMouseCoords;
            let target = (coords && document.elementFromPoint(coords.x, coords.y))
                         || window.__pwHoveredEl;

            // Native <select>: OS popup captures events, elementFromPoint returns
            // null. Fall back to the focused element (still the <select> itself).
            if ((!target || target === document.body || target === document.documentElement)
                && document.activeElement?.tagName?.toLowerCase() === 'select') {
                target = document.activeElement;
            }
            // Last resort: select stored on mousedown, used after the dropdown closes.
            if ((!target || target === document.body || target === document.documentElement)
                && window.__pwLastInteractedSelect
                && document.contains(window.__pwLastInteractedSelect)) {
                target = window.__pwLastInteractedSelect;
            }

            const isMeaningful = target
                && target !== document.body
                && target !== document.documentElement
                && target.tagName?.toLowerCase() !== 'html'
                && target.tagName?.toLowerCase() !== 'iframe'
                && !target.hasAttribute('data-pw-picking-hover');

            if (isMeaningful) {
                captureElement(target);
                return;
            }
        }

        enablePickingMode(framework || 'pytest');
    };

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'togglePickingMode') {
            window.__pwTogglePicking(request.framework, false);
            sendResponse({ status: isPickingMode ? 'enabled' : 'disabled' });
            return true;
        }
        if (request.action === 'disablePickingMode') {
            disablePickingMode();
        }
    });
}
