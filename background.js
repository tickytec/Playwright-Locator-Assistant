/*
 * background.js — MV3 service worker.
 *
 *  - keyboard shortcut: inject the scripts (idempotent) into every frame and
 *    ask each to capture what is under the cursor
 *  - relay: when a sub-frame captures an element, show the overlay in the top
 *    frame and end picking mode in all other frames
 */
const SCRIPTS = ['locator-core.js', 'content.js'];

function isInjectable(url) {
    return !!url && /^(https?|file|ftp):/.test(url);
}

// Prefer every frame; if one frame refuses injection (sandboxed / restricted),
// fall back to the top frame so the shortcut still works on the page.
async function executeInFrames(tabId, injection) {
    try {
        return await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, ...injection });
    } catch (_) {
        return chrome.scripting.executeScript({ target: { tabId }, ...injection });
    }
}

async function injectScripts(tabId) {
    await executeInFrames(tabId, { files: SCRIPTS });
}

async function togglePicking(tabId, framework, fromShortcut) {
    const results = await executeInFrames(tabId, {
        func: (fw, shortcut) => (window.__pwTogglePicking ? window.__pwTogglePicking(fw, shortcut) : 'missing'),
        args: [framework, fromShortcut],
    });
    return results.map((r) => r && r.result);
}

chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-picking-mode') return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !isInjectable(tab.url)) return;
    const { selectedFramework = 'pytest' } = await chrome.storage.local.get('selectedFramework');
    try {
        await injectScripts(tab.id);
        const states = await togglePicking(tab.id, selectedFramework, true);
        // A sub-frame captured while the top frame fell back to picking mode:
        // stop the picking so the user only sees the result.
        if (states.includes('captured') && states.includes('enabled')) {
            chrome.tabs.sendMessage(tab.id, { action: 'disablePickingMode' }).catch(() => {});
        }
    } catch (_) {
        // Restricted page (chrome://, web store, PDF viewer) — nothing to do.
    }
});

chrome.runtime.onMessage.addListener((message, sender) => {
    if (!message || !sender.tab) return;
    const tabId = sender.tab.id;
    if (message.action === 'elementPicked') {
        chrome.tabs.sendMessage(tabId, { action: 'disablePickingMode' }).catch(() => {});
        if (!message.fromTopFrame) {
            chrome.tabs.sendMessage(tabId, { action: 'showLocator', result: message.result }, { frameId: 0 }).catch(() => {});
        }
    } else if (message.action === 'pickingCancelled') {
        chrome.tabs.sendMessage(tabId, { action: 'disablePickingMode' }).catch(() => {});
    }
});
