// The verifier must agree with real Playwright on hand-written locators of
// every supported shape, and accept Python syntax as well.
const { test, expect } = require('@playwright/test');
const { startServer, openFixture, coreCount, coreResolvePicks, toLocator } = require('./helpers');

let server;
test.beforeAll(async () => { server = await startServer(); });
test.afterAll(async () => { await server.close(); });

// JS locator strings that can be evaluated with the real API. For each, the
// extension count must equal Playwright's count.
const JS_CORPUS = [
    'page.getByRole("button", { name: "Save" })',                       // 2 visible, 2 hidden → 2
    'page.getByRole("button", { name: "save" })',                       // non-exact is case-insensitive
    'page.getByRole("button", { name: "Save", exact: true })',
    'page.getByRole("button", { name: /^sa/i })',
    'page.getByRole("button", { name: "Save", includeHidden: true })',  // 4
    'page.getByRole("heading", { level: 2 })',
    'page.getByRole("heading", { name: "Orders", level: 2 })',
    'page.getByRole("tab", { selected: true })',
    'page.getByRole("radio", { checked: true })',
    'page.getByRole("switch", { name: "Dark mode" })',
    'page.getByRole("link")',
    'page.getByRole("listitem")',
    'page.getByRole("listitem").filter({ hasText: "Apple" })',
    'page.getByRole("listitem").filter({ hasText: "apple" })',
    'page.getByRole("listitem").filter({ hasNotText: "Apple" })',
    'page.getByRole("row").filter({ hasText: "Gadget" }).getByRole("button", { name: "Edit" })',
    'page.getByRole("row").filter({ has: page.getByRole("rowheader") })',
    'page.getByRole("row").filter({ hasText: "Widget" }).getByRole("cell").nth(0)',
    'page.getByRole("row").filter({ hasText: "Widget" }).getByRole("cell").nth(5)',
    'page.getByRole("cell").first()',
    'page.getByRole("cell").last()',
    'page.getByRole("button", { name: "Retry" }).nth(1)',
    'page.getByText("Apple")',                                          // both lists
    'page.getByText("Apple", { exact: true })',
    'page.getByText("apple")',                                          // ci substring
    'page.getByText("Orders")',                                         // h2 + paragraph substring
    'page.getByText(/^Dashboard$/)',
    'page.getByLabel("Email address")',
    'page.getByLabel("email")',
    'page.getByLabel("Site search")',                                   // aria-label
    'page.getByLabel("Password")',                                      // aria-labelledby
    'page.getByLabel("Subscribe to newsletter")',
    'page.getByPlaceholder("Search")',
    'page.getByPlaceholder("Search everything", { exact: true })',
    'page.getByAltText("Company logo")',
    'page.getByAltText("logo")',
    'page.getByTitle("Refresh data")',
    'page.getByTestId("checkout")',
    'page.locator("#card-a").getByRole("button")',
    'page.locator("#card-a button")',
    'page.locator("button.hidden")',
    'page.locator("[id=\\"1st-place\\"]")',
    'page.locator("li")',
    'page.locator("li", { hasText: "Banana" })',
    'page.locator("nav a")',
    'page.locator("xpath=//nav//a")',
    'page.locator("//h1")',
    'page.locator("text=Apple")',
    'page.locator("button:has-text(\\"Save\\")")',
    'page.locator("li:text-is(\\"Apple\\")")',
    'page.locator("#card-a >> button")',
    'page.getByRole("button", { name: "Save" }).and(page.locator("#card-a button"))',
    'page.getByRole("heading", { name: "Card A" }).or(page.getByRole("heading", { name: "Card B" }))',
    'page.locator("my-widget").getByRole("button", { name: "Duplicate" })',
    'page.getByRole("button", { name: "Shadow save" })',
    'page.getByText("Inside shadow")',
    'page.getByPlaceholder("Shadow input")',
    'page.frameLocator("#child-frame").getByRole("button", { name: "Pay now" })',
    'page.frameLocator("#child-frame").getByLabel("Card number")',
    'page.locator("#child-frame").contentFrame().getByRole("button")',
    'page.getByRole("button", { name: "Hidden by details" })',          // 0: inside closed details
    'page.getByRole("region", { name: "Account" })',
    'page.getByRole("region")',                                         // sections without a name are not regions
    'page.getByRole("navigation", { name: "Main" })',
    'page.getByRole("contentinfo")',
    'page.getByRole("banner")',
    'page.getByRole("table", { name: "Recent orders" })',
    'page.getByRole("columnheader")',
    'page.getByRole("rowheader", { name: "Widget" })',
    'page.getByRole("combobox")',
    'page.getByRole("listbox")',
    'page.getByRole("searchbox")',
    'page.getByRole("textbox")',
    'page.getByRole("img")',
    'page.getByRole("option", { name: "Poland" })',
    'page.getByRole("option", { selected: true })',
    'page.getByRole("paragraph")',
];

for (const locator of JS_CORPUS) {
    test(`verifier agrees with Playwright: ${locator}`, async ({ page }) => {
        await openFixture(page, server.baseURL);
        const expected = await toLocator(page, locator).count();
        const actual = await coreCount(page.mainFrame(), locator);
        expect(actual, `${locator} → Playwright ${expected}, extension ${actual}`).toBe(expected);
    });
}

test('bare selectors and shorthands', async ({ page }) => {
    await openFixture(page, server.baseURL);
    const f = page.mainFrame();
    expect(await coreCount(f, '#card-a button')).toBe(1);
    expect(await coreCount(f, 'button')).toBe(await page.locator('button').count());
    expect(await coreCount(f, 'nav > a')).toBe(3);
    expect(await coreCount(f, '//nav/a')).toBe(3);
    expect(await coreCount(f, 'xpath=//nav/a[@href]')).toBe(2);
    expect(await coreCount(f, 'text=Cherry')).toBe(1);
    expect(await coreCount(f, 'text="Apple"')).toBe(2);
    expect(await coreCount(f, 'css=#card-a')).toBe(1);
    expect(await coreCount(f, 'button:has-text("Retry")')).toBe(2);
    expect(await coreCount(f, 'li.item:has-text("x")')).toBe(0);
    expect(await coreCount(f, 'data-testid=checkout')).toBe(1);
});

test('Python syntax is accepted and equivalent', async ({ page }) => {
    await openFixture(page, server.baseURL);
    const f = page.mainFrame();
    const pairs = [
        ['page.get_by_role("button", name="Save", exact=True)', 'page.getByRole("button", { name: "Save", exact: true })'],
        ['page.get_by_role("row").filter(has_text="Gadget").get_by_role("button", name="Edit")', 'page.getByRole("row").filter({ hasText: "Gadget" }).getByRole("button", { name: "Edit" })'],
        ['page.get_by_label("Email address").fill("x@y.z")', 'page.getByLabel("Email address")'],
        ['page.get_by_label("Country").select_option("Spain")', 'page.getByLabel("Country")'],
        ['page.get_by_text("Apple", exact=True)', 'page.getByText("Apple", { exact: true })'],
        ['page.get_by_role("button", name=re.compile(r"^sa", re.I))', 'page.getByRole("button", { name: /^sa/i })'],
        ['page.frame_locator("#child-frame").get_by_role("button", name="Pay now")', 'page.frameLocator("#child-frame").getByRole("button", { name: "Pay now" })'],
        ['page.locator("#child-frame").content_frame.get_by_label("Card number")', 'page.locator("#child-frame").contentFrame().getByLabel("Card number")'],
        ['page.get_by_role("listitem").filter(has_not_text="Apple").first', 'page.getByRole("listitem").filter({ hasNotText: "Apple" }).first()'],
        ['self.page.get_by_test_id("checkout")', 'page.getByTestId("checkout")'],
        ['expect(page.get_by_role("heading", name="Orders")).to_be_visible()', 'page.getByRole("heading", { name: "Orders" })'],
    ];
    for (const [py, js] of pairs) {
        expect(await coreResolvePicks(f, py), py).toEqual(await coreResolvePicks(f, js));
        expect((await coreResolvePicks(f, js)).length, js).toBeGreaterThan(0);
    }
});

test('JS wrappers and actions are tolerated', async ({ page }) => {
    await openFixture(page, server.baseURL);
    const f = page.mainFrame();
    expect(await coreResolvePicks(f, 'await page.getByRole("button", { name: "Checkout" }).click();')).toEqual(['testid']);
    expect(await coreResolvePicks(f, 'await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible()')).toEqual(['h1']);
    expect(await coreResolvePicks(f, "this.page.getByLabel('Bio').fill('hello')")).toEqual(['bio']);
    expect(await coreResolvePicks(f, 'page.getByRole("button", { name: "Retry" }).nth(1).click()')).toEqual(['dup-unstable-2']);
    expect(await coreResolvePicks(f, 'page.getByLabel("Country").selectOption("Spain")')).toEqual(['country']);
    // Trailing generator notes are ignored.
    expect(await coreResolvePicks(f, 'page.getByTestId("cart")  // requires use: { testIdAttribute: "data-cy" }')).toEqual(['cy']);
    expect(await coreResolvePicks(f, 'page.get_by_test_id("cart")  # requires use: { testIdAttribute: "data-cy" }')).toEqual(['cy']);
});

test('unparseable input reports an error instead of 0 matches', async ({ page }) => {
    await openFixture(page, server.baseURL);
    const r = await page.evaluate(() => window.findAndHighlight('page.getByRole("button", { name: "x" }).somethingWeird()'));
    expect(r.count).toBe(0);
    expect(r.error).toMatch(/Unsupported call/);
    const bad = await page.evaluate(() => window.findAndHighlight('div >'));
    expect(bad.error).toMatch(/Invalid CSS/);
    const ok = await page.evaluate(() => window.findAndHighlight('page.getByRole("heading", { name: "Dashboard" })'));
    expect(ok).toEqual({ count: 1, error: null });
    expect(await page.locator('[data-pw-verifier-highlight]').count()).toBe(1);
    await page.evaluate(() => window.PWLocatorCore.clearHighlights());
    expect(await page.locator('[data-pw-verifier-highlight]').count()).toBe(0);
});
