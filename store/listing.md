# Chrome Web Store listing

Screenshots: `npm run screenshots` → `store/screenshots/01…05.jpg` (1280×800 JPEG, no alpha).
Store limits: short description 132 characters; detailed description is plain text.

## Short description

Generate, verify and record stable Playwright locators for any element. Python, JS/TS, Java and C#.

## Detailed description

Playwright Locator Assistant generates the locator Playwright itself would choose, checks it against the live page, and turns it into ready-to-paste test code — without opening DevTools.

WHY IT'S DIFFERENT
The uniqueness badge is built on an engine that mirrors Playwright's own role, accessible-name and text semantics. When the extension says "✓ 1", real Playwright finds exactly that element. Every release is verified by running the generated locators through the real Playwright API.

GENERATE
• Click an element, or hover it and press Alt+Shift+L (⌘+Shift+L on Mac) so menus and dropdowns stay open
• Strategies in Playwright's recommended order: getByTestId → getByLabel → getByRole + name → getByPlaceholder → getByText → getByTitle → scoped chains → .nth() → CSS, first unique wins
• Dynamic values (prices, rates, dates, times, counters) are never baked into a locator; names with a live part become regex names
• Table cells are anchored to their row and name their column
• Same-origin iframes get the full contentFrame() chain; open Shadow DOM elements are picked directly
• Stability tag on every locator: strong, good or fragile
• Up to 5 alternatives, each with its own match count

USE
• Copy the locator, the action (.click(), .fill(""), .check(), .selectOption("…")) or the assertion (toHaveText, toHaveValue, toBeChecked, toBeVisible)
• { } turns row anchors, cell values and options into variables for parameterised tests
• Output in Python (pytest), JavaScript/TypeScript, Java or C#
• Configure your testIdAttribute and whether exact: true is always emitted or only when needed

PAGE OBJECTS
Collect elements with "+ Page object", rename them, and copy a complete class: TypeScript getters, a Python class with properties, a Java class or a C# class.

RECORD A FLOW
Start recording, use the page, stop. Clicks, typed values, Enter presses, checkbox changes, selections and navigations become steps with the generated locators, rendered as a test skeleton in your language.

VERIFY
Paste any locator — or a whole test — and matching elements are highlighted with a count. Understands JS and Python syntax, await and expect() wrappers, filter({ hasText, has }), nth/first/last, and/or, frameLocator, regex names, CSS (including :has-text), XPath and text= shorthands. Unparseable input is reported as an error, not as "0 matches".

MORE
• DevTools sidebar in the Elements panel for the inspected node
• Recent locators are re-checked against the current page every time the popup opens
• Keyboard-only picking: Tab to move, Enter to capture, Esc to cancel
• Light and dark mode

PRIVACY
Everything runs locally in your browser. Nothing is sent anywhere.

Open source: https://github.com/tickytec/Playwright-Locator-Assistant

## What's new (2.1.0)

• Locator engine rewritten to match Playwright's own semantics; the uniqueness badge now reflects what Playwright will actually find
• Copy action and Copy assert, page-object builder, flow recording
• Java and C# output alongside Python and JavaScript/TypeScript
• iframe and Shadow DOM support, keyboard-only picking, DevTools sidebar
• Bulk verification of pasted tests, history re-checked live, stability tags
• Configurable test-id attribute and exact-matching mode
• Dark mode and a redesigned popup

## Permission justification

• host_permissions <all_urls> / content script: the picker, overlay and verifier must run on whichever site the user is testing.
• activeTab + scripting: inject the engine on demand into the current tab and its frames when the user clicks Pick, presses the shortcut or verifies a locator.
• storage: language, settings, recent locators, page-object entries and recordings are kept locally.
