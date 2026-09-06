// devtools.js — registers a sidebar pane in the Elements panel. The pane's own
// page (sidebar.html) does the work for the currently inspected element ($0).
chrome.devtools.panels.elements.createSidebarPane('Playwright Locator', (pane) => {
    pane.setPage('sidebar.html');
});
