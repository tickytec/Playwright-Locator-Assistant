// Every generated locator must resolve — in real Playwright — to exactly the
// element it was generated for. The extension's own count must agree.
const { test, expect } = require('@playwright/test');
const { startServer, openFixture, analyze, toLocator, coreResolvePicks, stripNote } = require('./helpers');

let server;
test.beforeAll(async () => { server = await startServer(); });
test.afterAll(async () => { await server.close(); });

// data-pick → expectations about the JS locator (substring or regex), optional.
const CASES = {
    'nav-home': /getByRole\("link", \{ name: "Home", exact: true \}\)/,
    'nav-products': /getByRole\("link"/,
    'anchor-no-href': /getByText\("Not a link"/,           // <a> without href is not a link
    'menu-button': /getByRole\("button", \{ name: "Open menu"/,
    h1: /getByRole\("heading", \{ name: "Dashboard"/,
    email: /getByLabel\("Email address", \{ exact: true \}\)/,
    'nickname-wrapped': /getByLabel\("Nickname"/,
    'placeholder-only': /getByPlaceholder\("Search everything"/,
    'search-input': /getByRole\("searchbox"/,
    labelledby: /getByRole\("textbox", \{ name: "Password"/,
    country: /^page\.getByLabel\("Country", \{ exact: true \}\)$/,   // selectOption lives in the action now
    'tags-multiple': /getByLabel\("Tags"/,
    bio: /getByLabel\("Bio"/,
    newsletter: /getByLabel\("Subscribe to newsletter"/,
    'plan-free': /getByLabel\("Free"/,
    'plan-pro': /getByLabel\("Pro"/,
    volume: /getByRole\("slider", \{ name: "Volume"/,
    quantity: /getByRole\("spinbutton", \{ name: "Quantity"/,
    file: /getByRole\("button", \{ name: "Attachment"/,
    'submit-input': /getByRole\("button", \{ name: "Create account"/,
    'h2-orders': /getByRole\("heading", \{ name: "Orders"/,
    paragraph: /getByText\("Your recent orders appear below/,
    price: /locator\(/,                                      // "$42.99" must not be baked into text
    count: /^page\.getByText\("Notifications"\)$/,             // dynamic "(12)" dropped, non-exact
    time: /^page\.getByRole\("main"\)\.getByText\("Updated"\)$/,     // "Updated" also heads a column elsewhere → scoped
    'orders-table': /getByRole\("table", \{ name: "Recent orders"/,
    'th-product': /getByRole\("columnheader", \{ name: "Product"/,
    'th-row-widget': /getByRole\("rowheader", \{ name: "Widget"/,
    'td-widget-price': /getByRole\("row"\)\.filter\(\{ hasText: "Widget" \}\)\.getByRole\("cell"\)\.nth\(0\)/,
    'td-gadget-name': /getByRole\("row"\)\.filter\(\{ hasText: "Edit" \}\)|getByRole\("cell", \{ name: "Gadget"/,
    'td-gizmo-price': /getByRole\("row"\)\.filter\(\{ hasText: "Gizmo" \}\)\.getByRole\("cell"\)\.nth\(1\)/,
    'edit-widget': /getByRole\("row"\)\.filter\(\{ hasText: "Widget" \}\)\.getByRole\("button", \{ name: "Edit"/,
    'edit-gadget': /getByRole\("row"\)\.filter\(\{ hasText: "Gadget" \}\)\.getByRole\("button", \{ name: "Edit"/,
    'td-all-dynamic': /nth\(/,
    'li-apple': /getByRole\("listitem"\)\.filter\(\{ hasText: "Apple" \}\)/, // scoped to the Fruit region
    'li-banana': /^page\.getByText\("Banana", \{ exact: true \}\)$/,      // unique on the page → simplest wins
    'save-a': /locator\("#card-a"\)\.getByRole\("button", \{ name: "Save"/,
    'save-b': /locator\("#card-b"\)\.getByRole\("button", \{ name: "Save"/,
    'icon-button': /getByRole\("button", \{ name: "Close dialog"/,
    logo: /getByAltText\("Company logo"/,
    'title-only': /getByTitle\("Refresh data"/,
    'digit-id': /locator\("\[id=\\"1st-place\\"\]"\)/,
    'tab-active': /getByRole\("tab", \{ name: "Overview"/,
    switch: /getByRole\("switch", \{ name: "Dark mode"/,
    'div-role-button': /getByRole\("button", \{ name: "Custom action"/,
    testid: /^page\.getByTestId\("checkout"\)$/,
    cy: /^page\.getByTestId\("cart"\)\s+\/\/ requires use: \{ testIdAttribute: "data-cy" \}/,
    'dup-unstable-1': /nth\(0\)/,
    'dup-unstable-2': /nth\(1\)/,
    'shadow-button': /getByRole\("button", \{ name: "Shadow save"/,
    'shadow-input': /getByPlaceholder\("Shadow input"/,
    iframe: /getByTitle\("Payment frame"/,
    summary: /getByText\("More"|getByRole\("button", \{ name: "More"/,
    footer: /getByRole\("contentinfo"\)|getByText\("© Example"/,
    'contenteditable': /getByText\("Type here"/,
    'generic-div': /getByText\("no role, some text"/,
    'section-no-name': /locator\(/,                          // <section> without a name has no role
    'decorative-img': /locator\("img\.deco"\)/,
    // Exchange-rate style content: values never baked in, anchors stay stable.
    'rate-sentence': /^page\.getByText\("Current rate"\)$/,
    version: /getByText\("Version 2\.1", \{ exact: true \}\)/,
    'eur-rate': /^page\.getByRole\("row"\)\.filter\(\{ hasText: "EUR\/USD" \}\)\.getByRole\("cell"\)\.nth\(1\)  \/\/ column "Rate"$/,
    'cart-count': /^page\.getByRole\("button", \{ name: \/items in cart\/ \}\)$/,   // dynamic part of the name dropped via regex
    'eur-buy': /^page\.getByRole\("row"\)\.filter\(\{ hasText: "EUR\/USD" \}\)\.getByRole\("button", \{ name: "Buy", exact: true \}\)$/,
    'jpy-pair': /^page\.getByRole\("cell", \{ name: "USD\/JPY", exact: true \}\)$/,
    'li-rate': /^page\.getByRole\("listitem"\)\.filter\(\{ hasText: "EUR\/USD" \}\)$/,
};

for (const [pick, expected] of Object.entries(CASES)) {
    test(`JS locator for [${pick}] resolves to the picked element in real Playwright`, async ({ page }) => {
        await openFixture(page, server.baseURL);
        const result = await analyze(page.mainFrame(), pick, 'js');
        expect(result.locator, 'shape of generated locator').toMatch(expected);
        expect(result.count, `extension count for ${result.locator}`).toBe(1);

        // A non-default test id attribute only works once configured in
        // playwright.config; the generator says so in a note.
        if (/testIdAttribute/.test(result.locator)) {
            const attr = /testIdAttribute: "([^"]+)"/.exec(result.locator)[1];
            await expect(page.locator(`[${attr}="${/getByTestId\("([^"]+)"/.exec(result.locator)[1]}"]`)).toHaveCount(1);
            return;
        }
        const locator = toLocator(page, result.locator);
        await expect(locator, `real Playwright count for ${result.locator}`).toHaveCount(1);
        expect(await locator.evaluate((el) => el.getAttribute('data-pick'))).toBe(pick);
    });
}

test('hidden duplicates are ignored by both engines', async ({ page }) => {
    await openFixture(page, server.baseURL);
    const result = await analyze(page.mainFrame(), 'save-b', 'js');
    expect(result.count).toBe(1);
    await expect(toLocator(page, result.locator)).toHaveCount(1);
});

test('element inside a closed <details> is still located', async ({ page }) => {
    await openFixture(page, server.baseURL);
    const result = await analyze(page.mainFrame(), 'in-closed-details', 'js');
    // Not exposed to getByRole while closed → falls back to a non-role locator.
    expect(result.locator).not.toMatch(/getByRole\("button", \{ name: "Hidden by details"/);
    await expect(toLocator(page, result.locator)).toHaveCount(1);
});

test('Python output uses snake_case, kwargs and True, and resolves to the same element', async ({ page }) => {
    await openFixture(page, server.baseURL);
    const picks = ['email', 'nav-home', 'td-widget-price', 'edit-gadget', 'country', 'li-apple', 'save-a', 'cy', 'dup-unstable-2'];
    for (const pick of picks) {
        const py = await analyze(page.mainFrame(), pick, 'pytest');
        expect(py.locator).not.toMatch(/getBy|hasText|\{ name/);
        expect(py.locator).toMatch(/get_by_|locator\(/);
        expect(py.count, py.locator).toBe(1);
        expect(await coreResolvePicks(page.mainFrame(), stripNote(py.locator))).toEqual([pick]);
    }
    const country = await analyze(page.mainFrame(), 'country', 'pytest');
    expect(country.locator).toBe('page.get_by_label("Country", exact=True)');
    expect(country.action).toBe('page.get_by_label("Country", exact=True).select_option("Poland")');
    const cart = await analyze(page.mainFrame(), 'cart-count', 'pytest');
    expect(cart.locator).toBe('page.get_by_role("button", name=re.compile(r"items in cart"))');
    const cell = await analyze(page.mainFrame(), 'td-widget-price', 'pytest');
    expect(cell.locator).toBe('page.get_by_role("row").filter(has_text="Widget").get_by_role("cell").nth(0)  # column "Price"');
    expect(cell.column).toBe('Price');
    const cy = await analyze(page.mainFrame(), 'cy', 'pytest');
    expect(cy.locator).toBe('page.get_by_test_id("cart")  # requires use: { testIdAttribute: "data-cy" } in playwright.config');
});

test('alternatives are deduplicated, carry counts, and each resolves', async ({ page }) => {
    await openFixture(page, server.baseURL);
    const result = await analyze(page.mainFrame(), 'email', 'js');
    expect(result.alternatives.length).toBeGreaterThan(1);
    expect(result.alternatives.length).toBeLessThanOrEqual(5);
    const seen = new Set([stripNote(result.locator)]);
    for (const alt of result.alternatives) {
        expect(seen.has(stripNote(alt.locator))).toBe(false);
        seen.add(stripNote(alt.locator));
        expect(typeof alt.count).toBe('number');
        await expect(toLocator(page, alt.locator)).toHaveCount(alt.count);
    }
});

test('elements inside a same-origin iframe get a contentFrame() chain', async ({ page }) => {
    await openFixture(page, server.baseURL);
    const child = page.frame({ url: /frame\.html$/ });
    const result = await analyze(child, 'frame-pay', 'js');
    // The frame itself only knows its own document; the content script adds
    // the parent chain. Emulate that here with the iframe element's locator.
    const frameLoc = await analyze(page.mainFrame(), 'iframe', 'js');
    const full = `${stripNote(frameLoc.locator)}.contentFrame().${stripNote(result.locator).replace(/^page\./, '')}`;
    expect(full).toBe('page.getByTitle("Payment frame", { exact: true }).contentFrame().getByRole("button", { name: "Pay now", exact: true })');
    const loc = toLocator(page, full);
    await expect(loc).toHaveCount(1);
    expect(await loc.evaluate((el) => el.getAttribute('data-pick'))).toBe('frame-pay');
    // The extension's own resolver understands the chain too.
    expect(await coreResolvePicks(page.mainFrame(), full)).toEqual(['frame-pay']);
});

test('analysis carries stability, action, assertion and a page-object name', async ({ page }) => {
    await openFixture(page, server.baseURL);
    const f = page.mainFrame();
    const email = await analyze(f, 'email', 'js');
    expect(email.stability).toBe('strong');
    expect(email.action).toBe('await page.getByLabel("Email address", { exact: true }).fill("");');
    expect(email.assertion).toBe('await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();');
    expect(email.name).toBe('emailAddressInput');

    const save = await analyze(f, 'save-a', 'js');
    expect(save.action).toBe('await page.locator("#card-a").getByRole("button", { name: "Save", exact: true }).click();');
    expect(save.assertion).toBe('await expect(page.locator("#card-a").getByRole("button", { name: "Save", exact: true })).toHaveText("Save");');
    expect(save.name).toBe('saveButton');
    expect(save.stability).toBe('good');   // scoped through a css id → weaker of the two

    const newsletter = await analyze(f, 'newsletter', 'pytest');
    expect(newsletter.action).toBe('page.get_by_label("Subscribe to newsletter", exact=True).check()');
    expect(newsletter.name).toBe('subscribeToNewsletterCheckbox');

    const retry = await analyze(f, 'dup-unstable-2', 'js');
    expect(retry.stability).toBe('fragile');
    const li = await analyze(f, 'li-apple', 'js');
    expect(li.stability).toBe('good');
    expect(li.jsLocator).toBe(li.locator);
    const py = await analyze(f, 'li-apple', 'pytest');
    expect(py.jsLocator).toBe(li.locator);
});

test('Java and C# output is a faithful translation of the JS locator', async ({ page }) => {
    await openFixture(page, server.baseURL);
    const f = page.mainFrame();
    const java = await analyze(f, 'edit-gadget', 'java');
    expect(java.locator).toBe('page.getByRole(AriaRole.ROW).filter(new Locator.FilterOptions().setHasText("Gadget")).getByRole(AriaRole.BUTTON, new Locator.GetByRoleOptions().setName("Edit").setExact(true))');
    expect(java.action).toBe(`${java.locator}.click();`);
    expect(java.count).toBe(1);
    const cs = await analyze(f, 'edit-gadget', 'csharp');
    expect(cs.locator).toBe('page.GetByRole(AriaRole.Row).Filter(new() { HasText = "Gadget" }).GetByRole(AriaRole.Button, new() { Name = "Edit", Exact = true })');
    expect(cs.action).toBe(`await ${cs.locator}.ClickAsync();`);
    expect(cs.assertion).toBe(`await Expect(${cs.locator}).ToHaveTextAsync("Edit");`);
    const csCell = await analyze(f, 'td-widget-price', 'csharp');
    expect(csCell.locator).toBe('page.GetByRole(AriaRole.Row).Filter(new() { HasText = "Widget" }).GetByRole(AriaRole.Cell).Nth(0)  // column "Price"');
    const javaCart = await analyze(f, 'cart-count', 'java');
    expect(javaCart.locator).toBe('page.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName(Pattern.compile("items in cart")))');
    const csEmail = await analyze(f, 'email', 'csharp');
    expect(csEmail.locator).toBe('page.GetByLabel("Email address", new() { Exact = true })');
    expect(csEmail.action).toBe('await page.GetByLabel("Email address", new() { Exact = true }).FillAsync("");');
});

test('testIdAttribute setting reorders test-id candidates and their notes', async ({ page }) => {
    await openFixture(page, server.baseURL);
    const r = await page.evaluate(() => {
        const el = document.querySelector('[data-pick="cy"]');
        return {
            def: window.PWLocatorCore.analyzeElement(el, 'js').locator,
            cy: window.PWLocatorCore.analyzeElement(el, 'js', { testIdAttribute: 'data-cy' }).locator,
            other: window.PWLocatorCore.analyzeElement(document.querySelector('[data-pick="testid"]'), 'js', { testIdAttribute: 'data-cy' }).locator,
        };
    });
    expect(r.def).toMatch(/^page\.getByTestId\("cart"\)\s+\/\/ requires/);
    expect(r.cy).toBe('page.getByTestId("cart")');
    expect(r.other).toMatch(/^page\.getByTestId\("checkout"\)\s+\/\/ requires use: \{ testIdAttribute: "data-testid" \}/);
});

test('exactMode "needed" drops exact: true when the loose form is already unique', async ({ page }) => {
    await openFixture(page, server.baseURL);
    const r = await page.evaluate(() => {
        const core = window.PWLocatorCore;
        const pick = (p) => document.querySelector(`[data-pick="${p}"]`);
        return {
            email: core.analyzeElement(pick('email'), 'js', { exactMode: 'needed' }).locator,
            emailDefault: core.analyzeElement(pick('email'), 'js').locator,
            // "Pro" is a substring of "Products" (a link), but roles differ, so loose is still unique.
            planPro: core.analyzeElement(pick('plan-pro'), 'js', { exactMode: 'needed' }).locator,
            // "Apple" appears in two lists → loose text is not unique; scoped form wins.
            apple: core.analyzeElement(pick('li-apple'), 'js', { exactMode: 'needed' }).locator,
            py: core.analyzeElement(pick('h1'), 'pytest', { exactMode: 'needed' }).locator,
        };
    });
    expect(r.email).toBe('page.getByLabel("Email address")');
    expect(r.emailDefault).toBe('page.getByLabel("Email address", { exact: true })');
    expect(r.planPro).toBe('page.getByLabel("Pro")');
    // The "Fruit" region holds both lists, so the list itself is the nearest unique scope.
    expect(r.apple).toBe('page.getByRole("list").filter({ hasText: "Apple Banana Cherry" }).getByRole("listitem").filter({ hasText: "Apple" })');
    expect(r.py).toBe('page.get_by_role("heading", name="Dashboard")');
    for (const loc of [r.email, r.planPro, r.apple]) await expect(toLocator(page, loc)).toHaveCount(1);
});

test('large DOM stays within the time budget', async ({ page }) => {
    await openFixture(page, server.baseURL);
    // 20k extra elements: 2000 cards, each with a heading, text, and a duplicate-named button.
    await page.evaluate(() => {
        const frag = document.createDocumentFragment();
        for (let i = 0; i < 2000; i++) {
            const card = document.createElement('div');
            card.className = 'bulk-card';
            card.innerHTML = `<h4>Item ${i}</h4><p>Description of item ${i} with some text</p><span class="meta">${i}</span><span>tag</span><span>x</span><button>Open</button><a href="#">More</a><i></i><b></b>`;
            frag.appendChild(card);
        }
        document.body.appendChild(frag);
    });
    const { ms, locator, budgetExceeded } = await page.evaluate(() => {
        const el = document.querySelectorAll('.bulk-card button')[1234];
        const t0 = performance.now();
        const r = window.PWLocatorCore.analyzeElement(el, 'js');
        return { ms: performance.now() - t0, locator: r.locator, budgetExceeded: r.budgetExceeded };
    });
    // Correct regardless of budget, and never pathological.
    await expect(toLocator(page, locator)).toHaveCount(1);
    expect(ms, `analyze took ${ms}ms (budgetExceeded=${budgetExceeded})`).toBeLessThan(3000);
});
