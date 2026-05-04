const isPickingModeActive = {};

// Keyboard shortcut handler — activates picking without any click,
// so open dropdowns/menus stay open while the user hovers and picks.
//
// Uses two sequential executeScript calls instead of message passing:
// message passing has a timing/permission window where it silently fails
// (the send succeeds but the listener isn't ready), causing the shortcut
// to appear dead unless the icon was clicked first.
chrome.commands.onCommand.addListener((command) => {
    if (command !== 'toggle-picking-mode') return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs.length) return;
        const tabId = tabs[0].id;

        chrome.storage.local.get(['selectedFramework'], (result) => {
            const framework = result.selectedFramework || 'pytest';

            // Step 1: ensure content.js is present (idempotency guard makes this safe).
            chrome.scripting.executeScript(
                { target: { tabId }, files: ['content.js'] },
                () => {
                    if (chrome.runtime.lastError) return; // restricted page (chrome://)

                    // Step 2: call the exposed toggle function directly — no message needed.
                    chrome.scripting.executeScript({
                        target: { tabId },
                        func: (fw) => window.__pwTogglePicking?.(fw, true),
                        args: [framework],
                    }, () => { void chrome.runtime.lastError; });
                }
            );
        });
    });
});

chrome.runtime.onMessage.addListener((message, sender) => {
    if (message.action === 'elementPicked') {
        if (sender.tab?.id) {
            isPickingModeActive[sender.tab.id] = false;
        }
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    delete isPickingModeActive[tabId];
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading' && isPickingModeActive[tabId]) {
        isPickingModeActive[tabId] = false;
        chrome.tabs.sendMessage(tabId, { action: 'disablePickingMode' }).catch(() => {});
    }
});
