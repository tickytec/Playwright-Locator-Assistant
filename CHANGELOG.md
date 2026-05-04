# Playwright Locator Assistant — Changelog

---

## v1.0.0 — Initial Release

### Locator Generation
- **Smart strategy selection** — automatically picks the most robust Playwright locator available: `getByTestId` → `getByRole` → `getByLabel` → `getByPlaceholder` → `getByAltText` → `getByTitle` → `getByText` → chained ancestor → CSS fallback
- **Extended testId support** — detects `data-testid`, `data-cy`, `data-qa`, `data-test`, `data-automation-id`, and `data-test-id`
- **Dynamic value detection** — skips exchange rates, prices, dates, times, and counters from locator names so tests stay valid across data refreshes
- **`getByLabel` preference** — labeled form controls use `getByLabel` instead of the more verbose `getByRole(..., { name })` 
- **Native `<select>` support** — generates a ready-to-use `selectOption()` / `select_option()` call with the current value as a placeholder
- **Table cell locators** — anchors to the row via `.filter({ hasText })` and falls back to column index (`.nth()`) when cell content is dynamic
- **`contenteditable` awareness** — rich text editor fields are correctly identified as `textbox` role
- **iframe warning** — locators for elements inside `<iframe>` include a note to add `frameLocator()`
- **Shadow DOM warning** — locators for elements inside a Shadow Root include a note about `pierce:` selectors

### Locator Overlay
- **Uniqueness badge** — every captured locator is immediately checked against the page: ✓ 1 (unique), ⚠ N (not unique), ✗ 0 (no match)
- **Alternatives panel** — expandable section showing up to 5 alternative locator strategies, each with its own Copy button
- **Variables button `{ }`** — converts dynamic text values (row names, cell values, select options) to named variables for use in parameterised tests
- **Draggable overlay** — drag the locator display out of the way if it covers the captured element
- **Smart copy** — the Copy button always copies whichever version is currently displayed (original or variable form), without the WARNING comment

### Keyboard Shortcut
- **Instant capture** — hover over any element and press `Alt+Shift+L` (Windows/Linux) or `⌘+Shift+L` (Mac) to capture it without clicking, keeping dropdowns and menus open
- **Works without clicking the icon first** — the shortcut is fully functional as soon as the page loads
- **Native select fallback** — when the OS-level dropdown captures keyboard input, the shortcut works after the dropdown closes using a stored element reference

### Verify Selector (Section 2)
- Supports Playwright `getByRole`, `getByLabel`, `getByText`, `getByPlaceholder`, `getByAltText`, `getByTitle`, `getByTestId`, `locator()`
- Supports chained locators (e.g. `page.getByRole("nav").getByRole("link", { name: "Home" })`)
- Supports XPath (`//div[@id="x"]` or `xpath=...`)
- Supports Playwright shorthands: `text=`, `css=`
- Supports plain CSS selectors
- Accepts Python snake_case format (`get_by_role`, `select_option`, etc.)
- Strips trailing action calls (`.selectOption`, `.fill`, `.click`) and highlights the target element
- `getByLabel` correctly scoped to form controls only

### Locator History (Section 3)
- Saves the last 8 captured locators across sessions
- Each entry has its own Copy button
- "Clear history" button to reset
- Automatically shown/hidden based on whether any locators have been captured

### Framework Support
- **Pytest (Python)** — all locators formatted with snake_case methods, `True`/`False` booleans, and keyword arguments
- **JavaScript** — all locators formatted with camelCase methods and object option syntax
- Framework preference is persisted across sessions

---

## Release Notes for Chrome Web Store Submission

**What's new in this version:**

Initial public release of Playwright Locator Assistant.

• Click or use a keyboard shortcut (Alt+Shift+L / ⌘+Shift+L) to capture any element's locator
• Generates the most stable Playwright locator automatically — getByRole, getByLabel, getByTestId, getByText, and more
• Skips dynamic values (prices, dates, exchange rates) that would break tests
• Uniqueness badge confirms whether your locator is unique on the page
• Up to 5 alternative locator strategies shown per element
• Variables button converts table/select values to named variables for parametrised tests
• Draggable locator overlay
• Verify any locator (CSS, XPath, Playwright syntax) and highlight matching elements
• Recent locators history with one-click copy
• Supports both Pytest and JavaScript
• Warnings for elements inside iframes and Shadow DOM
