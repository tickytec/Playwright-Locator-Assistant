# Playwright Locator Assistant — Changelog

---

## v2.1.0 — Actions, page objects, recording, four languages

### Added

- **Copy action / Copy assert** in the overlay and the DevTools sidebar: `.click()`, `.fill("")`, `.check()`, `.selectOption("…")` and `toHaveText` / `toHaveValue` / `toBeChecked` / `toBeVisible`, per element type.
- **Page-object mode**: collect elements with **+ Page object**, edit member names, copy a class in TypeScript, Python, Java or C#.
- **Recording**: clicks, typed values, checkbox changes and selections become steps; **Copy test** renders a test skeleton. Survives navigation.
- **Stability tag** (strong / good / fragile) on the primary locator and on alternatives; scoped chains report the weaker of ancestor and child.
- **Live re-verification of history** each time the popup opens.
- **DevTools sidebar** in the Elements panel for the inspected node.
- **Java and C# output**, rendered from the same analysis as JS/Python.
- **Regex names** when an accessible name contains a live value: `getByRole("button", { name: /items in cart/ })`.
- **Configurable test-id attribute** in the popup.
- **Column names** on index-based table cells (`// column "Rate"`).
- **Dark mode** for the popup; the overlay remembers its dragged position.
- **Keyboard-only picking**: Tab moves focus, Enter captures.
- **Bulk verify**: paste several lines or a whole test.

- **`exact` mode setting**: always (default) or only when needed.
- **Recording** captures Enter presses and navigations (`goto`), dedupes repeated fills, and is owned by the top frame so iframes never corrupt it.
- **Time budget** (400 ms) for generation on very large pages, with a 20k-element benchmark test.
- **Popup e2e tests** (opened as an extension page) and a **GitHub Actions** workflow.
- The popup falls back to the most recently used web tab when it is itself the active tab.
- **Design pass**: the popup is one calm surface with hairline sections instead of a numbered card stack; the settings row uses a grid that cannot overflow; a proper light/dark token set; the on-page overlay, picking badge and DevTools pane share the same palette, pill badges and type scale.

### Changed

- The `selectOption("…")` call moved from the locator into the action snippet, so the locator itself stays pure.

---

## v2.0.0 — Engine rewrite

The locator engine now mirrors Playwright's own semantics and is verified against real Chromium. What the badge says is what Playwright will find.

### Fixed

- **Uniqueness badge could lie.** The verifier and the generator shared a hand-rolled role/name model that disagreed with Playwright (`<li>`, `<nav>`, `<select>` and other containers got names from their text; `<a>` without `href` was a link; `<input type="search">` was a textbox; contenteditable was a textbox). A locator shown as `✓ 1` could match nothing in a real test.
- **`.nth()` was stripped before counting**, so the table fallback locator was always reported with the wrong count.
- **Omitted `exact` was treated as `true`** in the verifier; Playwright defaults to a case-insensitive substring match. Pasted locators that worked in tests reported 0 matches.
- **iframe and Shadow DOM support never triggered**: the content script did not run in frames, and shadow elements were retargeted to their host.
- **ids starting with a digit** produced broken selectors (`#\31 st` inside a string literal).
- **Hidden duplicates** (`display:none`, `aria-hidden`, closed `<details>`) were counted as matches.
- **"Pick element" failed on tabs opened before the extension was installed** ("Could not connect"); scripts are now injected on demand.
- History no longer fills up with duplicates of the same locator.
- Inline `outline` styles on hovered/highlighted elements are restored instead of cleared.

### Added

- **Accessible-name computation per accname**: `aria-labelledby`, `aria-label`, `<label>` (`for=` and wrapping), descendant content including `alt` of icon images, `value` of submit buttons, `title`, placeholder fallback.
- **Uniqueness-driven generation**: the first strategy that is unique wins; otherwise a unique ancestor is found (`#id`, named region, row filter…) and the locator is scoped to it. Only then `.nth()`, and only after that a CSS path.
- **Stable-text extraction**: when text contains a live value ("Updated 14:32", "Notifications (12)", "EUR/USD 1.0823") the stable part is used as a substring `getByText` or as a `filter({ hasText })` anchor. Any embedded decimal number now counts as dynamic (except "Version 2.1"-style text).
- `getByRole(...).filter({ hasText })` for list items, rows and other containers.
- **Frames**: elements in same-origin iframes get `page.locator(iframe).contentFrame()…` chains (nested frames supported); cross-origin frames get a note. Sub-frame picks are relayed to the top-frame overlay.
- **Shadow DOM**: elements inside open shadow roots are picked directly; all queries pierce shadow roots.
- **Verifier parser** for real code: JS and Python, `await`, `expect(...)`, trailing actions, regex names (`/x/i`, `re.compile`), `filter({ has, hasNot, hasText, hasNotText })`, `nth/first/last`, `and/or`, `frameLocator`, `contentFrame`, `level/checked/selected/pressed/expanded/disabled/includeHidden`, `>>` chains, `:has-text()`, `:text-is()`, `:visible`. Parse errors are reported instead of "0 matches".
- Alternatives now show their own match counts.
- Picking mode swallows `mousedown`/`pointerdown`/`mouseup` so menus stay open and the page never reacts to the pick.
- History entries load into the verifier on click; the popup updates live when a locator is captured.
- A note on `getByTestId` when the attribute is not `data-testid` (`testIdAttribute` config needed).
- **Test suite** (`npm test`): generated locators are evaluated with the real Playwright API; a verifier corpus is compared with Playwright's counts; the unpacked extension is driven end-to-end in Chromium.

### Changed

- Code split into `locator-core.js` (pure engine) and `content.js` (UI).
- Popup sections are ordered 1 → 2 → 3; framework labels spell out Python and JavaScript/TypeScript.
- Removed the misleading "pierce:" note for Shadow DOM (Playwright pierces open shadow roots by default).
- Dead picking-state bookkeeping removed from the service worker.

---

## v1.1.0

- Keyboard shortcut works without clicking the icon first (two-step `executeScript` injection).

## v1.0.0 — Initial release

- Smart strategy selection: `getByTestId` → `getByRole` → `getByLabel` → `getByPlaceholder` → `getByAltText` → `getByTitle` → `getByText` → chained ancestor → CSS fallback
- Dynamic value detection for rates, prices, dates, times and counters
- Native `<select>` support with `selectOption()`
- Table cell locators anchored to the row
- Uniqueness badge, alternatives panel, `{ }` variables button, draggable overlay
- Keyboard shortcut `Alt+Shift+L` / `⌘+Shift+L`
- Verify Selector for Playwright syntax, XPath, CSS and shorthands
- Locator history (last 8)
- Pytest and JavaScript output
