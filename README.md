# Playwright Locator Assistant

A Chrome extension that generates, verifies and keeps track of stable Playwright locators for any element on a page — without opening DevTools.

Built for QA engineers and developers who want resilient, readable tests written faster. Every locator the extension rates as unique is checked with an engine that mirrors Playwright's own role, accessible-name and text semantics, and the test suite proves that agreement against real Chromium.

---

## Features

### Locator generation that follows Playwright's rules

Click any element (or hover it and press the shortcut). The extension tries strategies in priority order and returns the first one that is **unique on the page**:

1. `getByTestId` — `data-testid`, plus `data-test-id`, `data-test`, `data-qa`, `data-cy`, `data-automation-id` (with a note when your config needs `testIdAttribute`)
2. `getByLabel` — form controls named by a `<label>` (`for=` or wrapping)
3. `getByAltText` — images
4. `getByRole` + accessible name — computed the way Playwright computes it: `aria-labelledby`, `aria-label`, labels, descendant content (including `alt` on icon images), `title`, placeholder
5. `getByPlaceholder`
6. `getByText` — exact for stable text, or a stable substring when the text contains a live value
7. `getByTitle`
8. `getByRole` alone, or `getByRole(...).filter({ hasText })` for containers such as list items and rows
9. Scoped chains — a unique ancestor (`#id`, `getByRole("region", { name })`, a row filter…) followed by a locator unique inside it
10. `.nth(i)` on the best semantic locator, then a CSS path — both with a warning to add a `data-testid`

Roles follow the HTML-AAM mapping Playwright uses: `<a>` without `href` is not a link, `<input type="search">` is a `searchbox`, `<select multiple>` is a `listbox`, `<section>` is a `region` only when named, decorative images are skipped, hidden elements are ignored, and so on.

### Dynamic value filtering

Prices, exchange rates, dates, times, counters and "12 results"-style text are detected and kept out of locator names, so tests stay green across data refreshes.

Names with a live part become regex names: `getByRole("button", { name: /items in cart/ })`.

### Tables

Cells are anchored to their row, and index-based cells name their column:

```js
page.getByRole("row").filter({ hasText: "Widget" }).getByRole("cell").nth(1)  // column "Price"
page.getByRole("row").filter({ hasText: "Gadget" }).getByRole("button", { name: "Edit", exact: true })
```

### Actions, assertions and stability

The overlay offers **Copy**, **Copy action** and **Copy assert** for every pick. A button becomes `.click()`, an input `.fill("")`, a checkbox `.check()`, a select `.selectOption("…")`; assertions use `toHaveText` / `toHaveValue` / `toBeChecked` / `toBeVisible` depending on the element. Each locator carries a stability tag: **strong** (test id, label, role + name), **good** (text, placeholder, filters, scoped chains) or **fragile** (CSS classes, paths, `.nth()`).

### Page objects

Click **+ Page object** in the overlay to collect elements. The popup lists them with editable names (`saveButton`, `emailAddressInput`, …) and **Copy class** renders a class in the selected language: TypeScript getters, a Python class with properties, a Java class with `Locator` methods, or a C# class with `ILocator` properties.

### Record a flow

**Start recording** in the popup, use the page normally, then **Stop**. Clicks, typed values, Enter presses, checkbox changes and selections become steps with the generated locators; navigating to another page adds a `goto`. **Copy test** renders a test skeleton in the selected language.

### DevTools sidebar

In the Elements panel, the **Playwright Locator** sidebar shows the locator, count, stability, action and assertion for the currently inspected node (`$0`), with alternatives.

### iframes and Shadow DOM

- Elements inside same-origin iframes get the full chain: `page.getByTitle("Payment frame").contentFrame().getByRole(...)`. Nested frames are supported; cross-origin frames get a note to add `frameLocator()`.
- Elements inside open shadow roots are picked directly and located without special syntax (Playwright pierces open shadow DOM).

### Four languages

Python (pytest), JavaScript/TypeScript, Java and C# output for locators, actions, assertions, page objects and recordings. Java and C# are rendered from the same analysis (`AriaRole.BUTTON`, `new Page.GetByRoleOptions().setName(...)`, `new() { Name = ..., Exact = true }`).

### Settings

- **Test id attribute**: choose your project's `testIdAttribute`; matching attributes are emitted without a note and other attributes get one.
- **`exact: true`**: *always* (default, robust against "Save" vs "Save as") or *only when needed* (the loose, case-insensitive form is used whenever it is already unique, like Playwright's codegen).

### Uniqueness badge you can trust

Every locator is resolved against the live page by the same engine the verifier uses:

- `✓ 1` — unique, safe to use
- `⚠ N` — not unique (the generator only shows this when nothing better exists)
- `✗ 0` — no match

### Alternatives with counts

Expand **Alternatives** to see up to 5 other strategies for the same element, each with its own match count and Copy button.

### Keyboard shortcut — capture without clicking

Hover an element and press `Alt+Shift+L` (Windows/Linux) or `⌘+Shift+L` (macOS). Menus, dropdowns and hover states stay open. In picking mode, `Tab` moves focus between elements, `Enter` captures the hovered or focused element and `Esc` cancels; mouse presses are swallowed so the page never reacts to the pick. The overlay remembers where you dragged it.

### Variables for parameterised tests

The `{ }` button swaps row anchors, cell values and select options for variable names (`rowText` / `cellValue` / `optionText`, or `row_text` / `cell_value` / `option_text` in Python).

### Verify any locator

Paste a locator into **Verify locator** and matching elements are highlighted on the page with a count. Accepts:

- JS and Python Playwright syntax: `getByRole`, `getByText`, `getByLabel`, `getByPlaceholder`, `getByAltText`, `getByTitle`, `getByTestId`, `locator()`, `get_by_*`
- Options: `exact`, `name` as string or regex (`/save/i`, `re.compile(...)`), `level`, `checked`, `selected`, `pressed`, `expanded`, `disabled`, `includeHidden`
- Chains and narrowing: `.filter({ hasText, hasNotText, has, hasNot })`, `.nth()`, `.first()`, `.last()`, `.and()`, `.or()`
- Frames: `frameLocator("#f")`, `locator("iframe").contentFrame()` / `.content_frame`
- Wrappers and actions are ignored: `await`, `expect(...)`, `.click()`, `.fill()`, `.select_option()`…
- Selector strings: CSS (including `:has-text()`, `:text-is()`, `:visible`), XPath (`//…` or `xpath=`), `text=`, `css=`, `data-testid=`, and `>>` chains

Unparseable input is reported as an error rather than "0 matches". Paste several lines, or a whole test, to check every locator in it at once.

### History

The last 8 locators are kept across sessions and re-verified against the current page every time the popup opens, so you see at once which ones a redesign broke. Click one to load it into the verifier, or copy it.

---

## Install

Until the store listing is updated, load it unpacked:

1. Clone this repository.
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and select the repository folder.

## Use

1. Click the extension icon, choose a framework, click **Pick element**, then click any element on the page — or hover an element and press the shortcut.
2. The locator appears in an overlay on the page (draggable) and in the popup. Click **Copy**.
3. To check a locator, paste it into **Verify locator** and press Enter.

> **Native `<select>` tip:** the OS dropdown swallows keyboard events. Open it, close it with Esc, then press the shortcut; the generated `selectOption("…")` uses the currently selected option — replace it with the one your test needs.

---

## Development

```bash
npm install
npx playwright install chromium
npm test
```

The suite (`tests/`) has three layers:

- `generator.spec.js` — every generated locator is evaluated with the **real Playwright API** and must resolve to exactly the picked element; the Python output must resolve to the same element.
- `verifier.spec.js` — a corpus of hand-written locators where the extension's count must equal Playwright's, plus Python/JS equivalence and error reporting.
- `extension.spec.js` — the unpacked extension loaded into Chromium and driven through its service worker: picking, overlay, iframe relay, shortcut, shadow DOM, keyboard picking, page-object add and recording.
- `unit.spec.js` — heuristics, formatting, parsing, Java/C# translation, page-object and recording rendering, bulk counting.

The popup is covered by opening it as an extension page inside the same context (history counts, bulk verify, page object, recording, settings). Not covered automatically: the DevTools sidebar, which Playwright cannot drive.

`npm run package` produces the zip for the Chrome Web Store.

### Performance

Generation resolves each candidate against the live page. A 400 ms budget bounds the search on very large DOMs: once spent, the remaining scoped variants are skipped and the CSS path is used as the last resort. The suite includes a 20k-element page as a benchmark.

### CI

`.github/workflows/test.yml` runs the syntax check and the full suite on every push and pull request.

### Layout

| File | Purpose |
| --- | --- |
| `locator-core.js` | Pure engine: roles, accessible names, dynamic-text heuristics, generation, locator parsing and resolution. No `chrome.*` calls. |
| `content.js` | Page UI: cursor tracking, picking mode, overlay, frame plumbing. Runs in every frame. |
| `background.js` | Service worker: keyboard shortcut and cross-frame relay. |
| `popup.html` / `popup.js` | Popup: pick, verify (single or bulk), recording, page object, history with live counts, language and test-id settings. |
| `devtools.html` / `devtools.js` / `sidebar.html` / `sidebar.js` | Elements-panel sidebar for the inspected node. |

---

## Privacy

Everything runs locally in your browser. No data leaves the page. See `privacy.html`.

## License

MIT
