# Playwright Locator Assistant

The ultimate browser extension for generating, verifying, and managing stable Playwright locators — without ever opening DevTools.

Designed for QA engineers and developers who want resilient, readable tests written faster.

---

## Why This Extension?

Writing stable end-to-end tests is hard. CSS selectors break on every redesign, and manually crafting the right Playwright locator takes time. This extension embeds Playwright's best practices directly in your browser: it follows the official locator priority, skips dynamic values that would break tests, and tells you instantly whether your locator is unique.

---

## Features

### Intelligent Locator Generation

Click any element — the extension automatically picks the most resilient strategy, in priority order:

1. `getByTestId` — detects `data-testid`, `data-cy`, `data-qa`, `data-test`, `data-automation-id`, `data-test-id`
2. `getByRole` with accessible name — buttons, links, headings, inputs, and more
3. `getByLabel` — for form controls associated with a `<label>`
4. `getByPlaceholder`, `getByAltText`, `getByTitle`
5. `getByText` for static text content
6. Chained ancestor locator — when no global unique match exists
7. CSS selector fallback — with a warning to add a `data-testid`

### Keyboard Shortcut — Capture Without Clicking

Hover over any element and press `Alt+Shift+L` (Windows/Linux) or `⌘+Shift+L` (Mac) to capture it instantly — without a click. Dropdowns, menus, and hover states stay open.

### Dynamic Value Filtering

Exchange rates, prices, dates, times, and counters are detected at capture time and excluded from locator text. Tests stay green across data refreshes.

### Uniqueness Badge

Every captured locator is checked against the live page immediately:

- `✓ 1` — unique match, safe to use
- `⚠ N` — not unique, consider a more specific locator
- `✗ 0` — no match (page state may have changed)

### Alternative Strategies

Expand the **Alternatives** panel to see up to 5 other valid strategies for the same element, each with its own Copy button.

### Variables for Parameterised Tests

One click on the `{ }` button converts table cell values, row identifiers, and select options into named variables — ready to paste into a parametrised test function:

- JS: `rowText`, `cellValue`, `optionText`
- Python: `row_text`, `cell_value`, `option_text`

### Special Element Support

- **Native `<select>` dropdowns** — generates a ready-to-use `selectOption()` / `select_option()` call
- **Table cells** — anchored to the row via `.filter({ hasText })` so locators survive row reordering
- **`contenteditable` fields** — correctly identified as `textbox` role
- **`<iframe>` elements** — flagged with a note to wrap in `frameLocator()`
- **Shadow DOM elements** — flagged with a note about `pierce:` selectors

### Instant Locator Verifier

Paste any locator into the **Verify Selector** section and highlight all matching elements on the page with a live count. Supports:

- Playwright syntax: `getByRole`, `getByLabel`, `getByText`, `getByPlaceholder`, `getByAltText`, `getByTitle`, `getByTestId`, `locator()`
- Chained locators: `page.getByRole("nav").getByRole("link", { name: "Home" })`
- XPath: `//div[@id="main"]` or `xpath=...`
- Playwright shorthands: `text=Submit`, `css=.my-class`
- Plain CSS selectors
- Python snake_case: `get_by_role`, `get_by_label`, `select_option`, etc.

### Locator History

The last 8 captured locators are saved across sessions. Each entry has its own Copy button. A **Clear history** button resets the list.

### Pytest & JavaScript Support

Toggle between **Pytest (Python)** and **JavaScript** at any time. Every locator — including options, chaining, and `exact` flags — is formatted correctly for your chosen framework. Your preference is persisted across sessions.

### Draggable Overlay

The in-page locator overlay is draggable — move it out of the way if it covers the element you captured.

---

## How to Use

1. **Install** the extension from the Chrome Web Store.
2. **Generate a locator:**
   - Click the extension icon → select your framework → click **Pick Element** → click any element on the page.
   - Or hover over any element and press `Alt+Shift+L` / `⌘+Shift+L` to capture it without clicking.
3. The locator appears in an overlay on the page and in the popup. Click **Copy** to grab it.
4. **Verify a locator:** paste it into the **Verify Selector** box → click **Check Selector** → matching elements are highlighted on the page.
5. **History:** recent locators appear in section 3 of the popup for quick access.

> **Native `<select>` tip:** open the dropdown, press `Escape` to close it without selecting, then press the shortcut. The locator is generated from the currently selected value — replace it with your desired option in the test.

---

## Contributing

Contributions are welcome. If you have ideas for new features, found a bug, or want to improve the code, open an issue or submit a pull request.

---

## License

This project is licensed under the MIT License.
