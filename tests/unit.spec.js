// Pure-function behaviour of locator-core.js (heuristics, formatting, parsing).
const { test, expect } = require('@playwright/test');
const { CORE_PATH } = require('./helpers');

test.beforeEach(async ({ page }) => {
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ path: CORE_PATH });
});

const core = (page, fn, ...args) => page.evaluate(([fnName, a]) => window.PWLocatorCore[fnName](...a), [fn, args]);

test('looksLikeDynamicText flags runtime values and keeps labels', async ({ page }) => {
    const dynamic = ['42', '$42.99', '1,299.00 €', '12%', '1.0823', 'Rate 1.1', '149.8', '2025-01-31', '31/01/2025', '14:32', 'Updated 14:32:07', '(12)', 'Notifications (1,234)', '3 items', '42 results', '3h', '12ms'];
    const stable = ['Save', 'Email address', 'Version 2', 'Version 2.1', 'v1.4', 'Step 1 of 3', 'Top 10', '3D view', 'Q4 report', 'H1 heading', 'Order #', 'Pay now', 'EUR/USD'];
    for (const t of dynamic) expect(await core(page, 'looksLikeDynamicText', t), t).toBe(true);
    for (const t of stable) expect(await core(page, 'looksLikeDynamicText', t), t).toBe(false);
});

test('isStableClass / isStableId reject generated names', async ({ page }) => {
    for (const c of ['btn', 'card-title', 'nav__link', 'is-active']) expect(await core(page, 'isStableClass', c), c).toBe(true);
    for (const c of ['css-1a2b3c4d', 'sc-bdVaJa', 'Button__root__x9f3k2', 'jss123', 'a1', 'x', 'item-1234', 'MuiButton-root-42']) expect(await core(page, 'isStableClass', c), c).toBe(false);
    for (const i of ['email', 'card-a', 'main_nav', 'step-2', '1st-place']) expect(await core(page, 'isStableId', i), i).toBe(true);
    for (const i of ['1234', ':r3:', 'react-select-17-input', 'radix-:r1a:', 'a1b2c3d4e5', '550e8400-e29b-41d4-a716-446655440000', 'field_1234']) expect(await core(page, 'isStableId', i), i).toBe(false);
});

test('idSelector escapes non-identifier ids as attribute selectors', async ({ page }) => {
    expect(await core(page, 'idSelector', 'email')).toBe('#email');
    expect(await core(page, 'idSelector', '1st-place')).toBe('[id="1st-place"]');
    expect(await core(page, 'idSelector', 'a:b')).toBe('[id="a:b"]');
    expect(await core(page, 'idSelector', 'say "hi"')).toBe('[id="say \\"hi\\""]');
});

test('formatter produces valid JS and Python', async ({ page }) => {
    const out = await page.evaluate(() => {
        const js = window.PWLocatorCore.createFormatter('js');
        const py = window.PWLocatorCore.createFormatter('pytest');
        return {
            js1: js.page('getByRole', ['button'], { name: 'Say "hi"', exact: true }),
            py1: py.page('getByRole', ['button'], { name: 'Say "hi"', exact: true }),
            js2: js.chain(js.page('getByRole', ['row']), js.call('filter', [], { hasText: 'A\\B' })),
            py2: py.chain(py.page('getByRole', ['row']), py.call('filter', [], { hasText: 'A\\B' })),
            js3: js.page('getByTestId', ['x']) + js.note('n'),
            py3: py.page('getByAltText', ['x']) + py.note('n'),
        };
    });
    expect(out.js1).toBe('page.getByRole("button", { name: "Say \\"hi\\"", exact: true })');
    expect(out.py1).toBe('page.get_by_role("button", name="Say \\"hi\\"", exact=True)');
    expect(out.js2).toBe('page.getByRole("row").filter({ hasText: "A\\\\B" })');
    expect(out.py2).toBe('page.get_by_role("row").filter(has_text="A\\\\B")');
    expect(out.js3).toBe('page.getByTestId("x")  // n');
    expect(out.py3).toBe('page.get_by_alt_text("x")  # n');
});

test('stripNote removes only trailing notes', async ({ page }) => {
    expect(await core(page, 'stripNote', 'page.getByTestId("x")  // note here')).toBe('page.getByTestId("x")');
    expect(await core(page, 'stripNote', 'page.get_by_test_id("x")  # note')).toBe('page.get_by_test_id("x")');
    expect(await core(page, 'stripNote', 'page.locator("a[href=\'//x\']")')).toBe('page.locator("a[href=\'//x\']")');
    expect(await core(page, 'stripNote', '//div[@id="a"]')).toBe('//div[@id="a"]');
});

test('parameterizeLocator swaps content values for variables', async ({ page }) => {
    const js = 'page.getByRole("row").filter({ hasText: "Widget" }).getByRole("cell", { name: "$10", exact: true })';
    expect(await core(page, 'parameterizeLocator', js, false)).toBe('page.getByRole("row").filter({ hasText: rowText }).getByRole("cell", { name: cellValue, exact: true })');
    const py = 'page.get_by_role("row").filter(has_text="Widget").get_by_role("cell", name="$10", exact=True)';
    expect(await core(page, 'parameterizeLocator', py, true)).toBe('page.get_by_role("row").filter(has_text=row_text).get_by_role("cell", name=cell_value, exact=True)');
    expect(await core(page, 'parameterizeLocator', 'page.getByLabel("Country", { exact: true }).selectOption("Poland")', false)).toBe('page.getByLabel("Country", { exact: true }).selectOption(optionText)');
    expect(await core(page, 'parameterizeLocator', 'page.get_by_label("Country", exact=True).select_option("Poland")  # note', true)).toBe('page.get_by_label("Country", exact=True).select_option(option_text)');
    expect(await core(page, 'canParameterize', 'page.getByLabel("Email address", { exact: true })')).toBe(false);
    expect(await core(page, 'canParameterize', 'page.getByRole("listitem").filter({ hasText: "Apple" })')).toBe(true);
});

test('parseChain understands JS and Python shapes', async ({ page }) => {
    const steps = await core(page, 'parseChain', 'page.get_by_role("row").filter(has_text="A").get_by_role("cell", name="B", exact=True).nth(2).click()');
    expect(steps.map((s) => s.name)).toEqual(['getByRole', 'filter', 'getByRole', 'nth']);
    expect(steps[1].opts.hasText).toEqual({ type: 'string', value: 'A' });
    expect(steps[2].opts.exact).toEqual({ type: 'bool', value: true });
    expect(steps[3].args[0]).toEqual({ type: 'number', value: 2 });

    const js = await core(page, 'parseChain', "await expect(page.getByRole('button', { name: /Don't/i })).toBeVisible()");
    expect(js.map((s) => s.name)).toEqual(['getByRole']);
    expect(js[0].opts.name.type).toBe('regex');

    const apostrophe = await core(page, 'parseChain', 'page.getByText("Don\'t stop")');
    expect(apostrophe[0].args[0].value).toBe("Don't stop");

    await expect(core(page, 'parseChain', 'page.getByRole("x").frobnicate()')).rejects.toThrow(/Unsupported call/);
    await expect(core(page, 'parseChain', 'page.getByRole("x"')).rejects.toThrow();
});

test('stripNote is quote-aware and leaves XPath unions alone', async ({ page }) => {
    expect(await core(page, 'stripNote', 'page.getByText("Order # 5")  // note')).toBe('page.getByText("Order # 5")');
    expect(await core(page, 'stripNote', 'page.get_by_text("Order # 5")')).toBe('page.get_by_text("Order # 5")');
    expect(await core(page, 'stripNote', '//a | //b')).toBe('//a | //b');
    expect(await core(page, 'stripNote', 'page.locator("a[href=\'//x\']")  # n')).toBe('page.locator("a[href=\'//x\']")');
});

test('stabilityOf ranks kinds and penalises .nth()', async ({ page }) => {
    expect(await core(page, 'stabilityOf', 'testid', 'page.getByTestId("x")')).toBe('strong');
    expect(await core(page, 'stabilityOf', 'role-name', 'page.getByRole("button", { name: "x" })')).toBe('strong');
    expect(await core(page, 'stabilityOf', 'text', 'page.getByText("x")')).toBe('good');
    expect(await core(page, 'stabilityOf', 'css-path', 'page.locator("div > a")')).toBe('fragile');
    expect(await core(page, 'stabilityOf', 'role-name', 'page.getByRole("button", { name: "x" }).nth(2)')).toBe('fragile');
});

test('translateLocator renders Java and C# from JS or Python input', async ({ page }) => {
    const src = 'page.get_by_role("row").filter(has_text="A").get_by_role("cell", name="B", exact=True).nth(2)  # note';
    expect(await core(page, 'translateLocator', src, 'java')).toBe('page.getByRole(AriaRole.ROW).filter(new Locator.FilterOptions().setHasText("A")).getByRole(AriaRole.CELL, new Locator.GetByRoleOptions().setName("B").setExact(true)).nth(2)  // note');
    expect(await core(page, 'translateLocator', src, 'csharp')).toBe('page.GetByRole(AriaRole.Row).Filter(new() { HasText = "A" }).GetByRole(AriaRole.Cell, new() { Name = "B", Exact = true }).Nth(2)  // note');
    expect(await core(page, 'translateLocator', src, 'js')).toBe('page.getByRole("row").filter({ hasText: "A" }).getByRole("cell", { name: "B", exact: true }).nth(2)  // note');
    expect(await core(page, 'translateLocator', 'page.getByRole("button", { name: /save/i })', 'pytest')).toBe('page.get_by_role("button", name=re.compile(r"save", re.I))');
    expect(await core(page, 'translateLocator', 'page.locator("#f").contentFrame().getByLabel("Card").first()', 'csharp')).toBe('page.Locator("#f").ContentFrame.GetByLabel("Card").First');
    expect(await core(page, 'translateLocator', 'page.locator("#f").contentFrame().getByLabel("Card").first()', 'pytest')).toBe('page.locator("#f").content_frame.get_by_label("Card").first');
    expect(await core(page, 'translateLocator', 'page.frameLocator("#f").getByText("x")', 'java')).toBe('page.frameLocator("#f").getByText("x")');
    expect(await core(page, 'translateLocator', 'not a locator', 'java')).toBe('not a locator');
});

test('renderPageObject and renderRecording produce class and test skeletons', async ({ page }) => {
    const entries = [{ name: 'saveButton', locator: 'page.getByRole("button", { name: "Save", exact: true })' }, { name: 'emailInput', locator: 'page.getByLabel("Email", { exact: true })' }, { name: 'saveButton', locator: 'page.getByTestId("save2")' }];
    const ts = await core(page, 'renderPageObject', entries, 'js', 'login page');
    expect(ts).toContain('export class LoginPage {');
    expect(ts).toContain('get saveButton(): Locator {\n    return this.page.getByRole("button", { name: "Save", exact: true });');
    expect(ts).toContain('get saveButton2(): Locator');
    const py = await core(page, 'renderPageObject', entries, 'pytest', 'LoginPage');
    expect(py).toContain('class LoginPage:');
    expect(py).toContain('def email_input(self) -> Locator:\n        return self.page.get_by_label("Email", exact=True)');
    const java = await core(page, 'renderPageObject', entries, 'java', 'LoginPage');
    expect(java).toContain('public Locator saveButton() {\n        return page.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("Save").setExact(true));');
    const cs = await core(page, 'renderPageObject', entries, 'csharp', 'LoginPage');
    expect(cs).toContain('public ILocator EmailInput => _page.GetByLabel("Email", new() { Exact = true });');

    const steps = [
        { locator: 'page.getByLabel("Email", { exact: true })', action: { kind: 'fill', value: 'a@b.c' } },
        { locator: 'page.getByLabel("Country", { exact: true })', action: { kind: 'select', value: 'Spain' } },
        { locator: 'page.getByLabel("Terms")', action: { kind: 'check' } },
        { locator: 'page.getByRole("button", { name: "Save", exact: true })', action: { kind: 'click' } },
    ];
    const jsTest = await core(page, 'renderRecording', steps, 'js', 'https://x.test/');
    expect(jsTest).toBe([
        "import { test, expect } from '@playwright/test';", '',
        "test('recorded flow', async ({ page }) => {",
        '  await page.goto("https://x.test/");',
        '  await page.getByLabel("Email", { exact: true }).fill("a@b.c");',
        '  await page.getByLabel("Country", { exact: true }).selectOption("Spain");',
        '  await page.getByLabel("Terms").check();',
        '  await page.getByRole("button", { name: "Save", exact: true }).click();',
        '});',
    ].join('\n'));
    const pyTest = await core(page, 'renderRecording', steps, 'pytest', '');
    expect(pyTest).toContain('def test_recorded_flow(page: Page) -> None:\n    page.get_by_label("Email", exact=True).fill("a@b.c")');
    const csTest = await core(page, 'renderRecording', steps, 'csharp', '');
    expect(csTest).toContain('await Page.GetByLabel("Country", new() { Exact = true }).SelectOptionAsync("Spain");');
});

test('countMany extracts locator lines from pasted code', async ({ page }) => {
    await page.setContent('<button>Save</button><button>Save</button><input aria-label="Email">');
    await page.addScriptTag({ path: CORE_PATH });
    const results = await page.evaluate(() => window.PWLocatorCore.countMany([
        "import { test } from '@playwright/test';",
        '// comment',
        'await page.getByRole("button", { name: "Save" }).click();',
        'await expect(page.getByLabel("Email")).toBeVisible();',
        'page.getByText("Missing")',
        'page.getByRole("button").weird()',
        'const x = 1;',
    ].join('\n')).map(({ input, count, error }) => ({ input, count, error })));
    expect(results.map((r) => [r.count, !!r.error])).toEqual([[2, false], [1, false], [0, false], [0, true]]);
});

test('renderRecording handles goto and press steps in every language', async ({ page }) => {
    const steps = [
        { locator: 'page.getByLabel("Search")', action: { kind: 'fill', value: 'shoes' } },
        { locator: 'page.getByLabel("Search")', action: { kind: 'press', value: 'Enter' } },
        { locator: '', action: { kind: 'goto', value: 'https://x.test/results' } },
        { locator: 'page.getByRole("link", { name: "First" })', action: { kind: 'click' } },
    ];
    expect(await core(page, 'renderRecording', steps, 'js', 'https://x.test/')).toContain('  await page.getByLabel("Search").press("Enter");\n  await page.goto("https://x.test/results");\n  await page.getByRole("link", { name: "First" }).click();');
    expect(await core(page, 'renderRecording', steps, 'pytest', '')).toContain('    page.get_by_label("Search").press("Enter")\n    page.goto("https://x.test/results")');
    expect(await core(page, 'renderRecording', steps, 'java', '')).toContain('    page.getByLabel("Search").press("Enter");\n    page.navigate("https://x.test/results");');
    expect(await core(page, 'renderRecording', steps, 'csharp', '')).toContain('    await Page.GetByLabel("Search").PressAsync("Enter");\n    await Page.GotoAsync("https://x.test/results");');
});
