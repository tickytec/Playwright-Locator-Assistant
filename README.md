Instantly generate and verify the best Playwright locators for any element on the page.

Playwright Locator Assistant helps QA engineers and developers generate, verify, and manage Playwright locators directly from the browser — no DevTools diving, no manual selector writing.

─────────────────────────────────────────
 GENERATE THE BEST LOCATOR INSTANTLY
─────────────────────────────────────────
Click any element on the page to capture it, or use the keyboard shortcut (Alt+Shift+L on Windows/Linux, ⌘+Shift+L on Mac) to lock in the element under your cursor without clicking — keeping dropdowns, menus, and hover states open.

The extension automatically picks the most robust Playwright strategy available, in priority order:

  • getByTestId — data-testid, data-cy, data-qa, data-test, data-automation-id, data-test-id
  • getByRole with accessible name — buttons, links, headings, inputs, and more
  • getByLabel — for form controls associated with a <label>
  • getByPlaceholder, getByAltText, getByTitle
  • Native <select> dropdowns — generates a ready-to-use selectOption() call
  • Table cells — row-anchored via .filter({ hasText }) so locators survive row reordering
  • Chained ancestor locators — when no global unique match exists
  • CSS selector fallback — with a clear warning to add a test ID

─────────────────────────────────────────
 SKIPS DYNAMIC VALUES AUTOMATICALLY
─────────────────────────────────────────
Exchange rates, prices, dates, times, and counters are detected at capture time and excluded from the locator. Your tests stay green across data refreshes.

─────────────────────────────────────────
 UNIQUENESS BADGE
─────────────────────────────────────────
Every captured locator is checked against the current page instantly:

  ✓ 1  — unique match, safe to use
  ⚠ 3  — not unique, consider a more specific locator
  ✗ 0  — no match found (page state may have changed)

─────────────────────────────────────────
 ALTERNATIVE STRATEGIES
─────────────────────────────────────────
Expand the "Alternatives" panel below any captured locator to see up to 5 other valid strategies for the same element — each with its own Copy button.

─────────────────────────────────────────
 VARIABLES FOR PARAMETERISED TESTS
─────────────────────────────────────────
One click on the { } button converts table cell values, row identifiers, and select options into named variables (rowText, cellValue, optionText in JS; row_text, cell_value, option_text in Python) — ready to paste into a parametrised test function.

─────────────────────────────────────────
 VERIFY ANY LOCATOR
─────────────────────────────────────────
Paste any locator into the Verify section and the extension highlights all matching elements on the page with a red outline. Supports:

  • Playwright syntax: getByRole, getByLabel, getByText, getByPlaceholder, getByAltText, getByTitle, getByTestId, locator()
  • Chained locators: page.getByRole("nav").getByRole("link", { name: "Home" })
  • XPath: //div[@id="main"] or xpath=...
  • Playwright shorthands: text=Submit, css=.my-class
  • Plain CSS selectors
  • Python snake_case: get_by_role, get_by_label, select_option, etc.

─────────────────────────────────────────
 LOCATOR HISTORY
─────────────────────────────────────────
The last 8 captured locators are saved and shown in the popup. Each entry has its own Copy button, so you can build out a full test scenario without losing earlier work.

─────────────────────────────────────────
 PYTEST & JAVASCRIPT SUPPORT
─────────────────────────────────────────
Toggle between Pytest (Python) and JavaScript at any time. Every locator — including options, chaining, and exact flags — is formatted correctly for your chosen framework.

─────────────────────────────────────────
 BUILT-IN WARNINGS
─────────────────────────────────────────
Elements inside an <iframe> or Shadow DOM are flagged inline so you know exactly what extra step is needed (frameLocator() or a pierce: selector) before the locator will work in your test.

─────────────────────────────────────────
 HOW TO USE
─────────────────────────────────────────
1. Open the extension popup on any page.
2. Click "Pick Element" and click any element on the page, OR hover over an element and press Alt+Shift+L (⌘+Shift+L on Mac) to capture it instantly.
3. The locator appears in an overlay on the page and in the popup. Copy it directly.
4. To verify a locator, paste it into the "Verify Selector" box and click "Check Selector".
5. Recent locators are saved in section 3 of the popup for quick access.

For native <select> dropdowns:
Click the dropdown to open it, press Escape to close it (without selecting), then press the shortcut. The locator is generated from the currently selected value — replace it with your desired option in the test.

