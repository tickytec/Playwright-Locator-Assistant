document.addEventListener('DOMContentLoaded', function () {
    const pickElementButton = document.getElementById('pickElementButton');
    const locatorOutputDiv = document.getElementById('locatorOutput');
    const copyLocatorButton = document.getElementById('copyLocatorButton');
    const frameworkSelector = document.querySelectorAll('input[name="framework"]');
    const checkButton = document.getElementById('checkButton');
    const locatorInput = document.getElementById('locatorInput');
    const messageDiv = document.getElementById('message');

    const isMac = /mac/i.test(navigator.platform || navigator.userAgent);
    const shortcutEl = document.getElementById('pickShortcut');
    if (shortcutEl && isMac) shortcutEl.textContent = '⌘+Shift+L';

    let currentLocator = '';
    let selectedFramework = 'pytest';

    chrome.storage.local.get(['lastGeneratedLocator', 'selectedFramework'], function (result) {
        if (result.lastGeneratedLocator) {
            locatorOutputDiv.textContent = result.lastGeneratedLocator;
            currentLocator = result.lastGeneratedLocator;
            copyLocatorButton.style.display = 'block';
        } else {
            locatorOutputDiv.textContent = 'Click "Pick Element" to start.';
        }
        if (result.selectedFramework) {
            selectedFramework = result.selectedFramework;
            document.getElementById(selectedFramework).checked = true;
        }
    });

    frameworkSelector.forEach(radio => {
        radio.addEventListener('change', function () {
            selectedFramework = this.value;
            chrome.storage.local.set({ selectedFramework });
        });
    });

    pickElementButton.addEventListener('click', function () {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (!tabs.length) return;
            chrome.tabs.sendMessage(tabs[0].id, { action: 'togglePickingMode', framework: selectedFramework }, function (response) {
                if (chrome.runtime.lastError) {
                    locatorOutputDiv.textContent = 'Error: Could not connect. Please refresh the page.';
                    return;
                }
                if (response && response.status === 'enabled') {
                    window.close();
                }
            });
        });
    });

    copyLocatorButton.addEventListener('click', function () {
        if (currentLocator) {
            const pureLocator = currentLocator.replace(/\s+(#|\/\/) WARNING:.*$/, '').trim();
            navigator.clipboard.writeText(pureLocator).then(() => {
                copyLocatorButton.textContent = 'Copied!';
                setTimeout(() => { copyLocatorButton.textContent = 'Copy Locator'; }, 1500);
            });
        }
    });

    checkButton.addEventListener('click', function () {
        const selector = locatorInput.value.trim();
        messageDiv.style.display = 'block';
        if (!selector) {
            messageDiv.textContent = 'Please enter a selector or locator.';
            messageDiv.style.color = '#d9534f';
            return;
        }

        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (!tabs.length) {
                messageDiv.textContent = 'No active tab found.';
                messageDiv.style.color = '#d9534f';
                return;
            }

            const tabId = tabs[0].id;

            // Inject content.js first so findAndHighlight is always available,
            // even on pages the content script hasn't run on yet.
            chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }, () => {
                if (chrome.runtime.lastError) {
                    messageDiv.textContent = `Error: ${chrome.runtime.lastError.message}`;
                    messageDiv.style.color = '#d9534f';
                    return;
                }
                chrome.scripting.executeScript({
                    target: { tabId },
                    func: (sel) => findAndHighlight(sel),
                    args: [selector]
                }, (results) => {
                    if (chrome.runtime.lastError) {
                        messageDiv.textContent = `Error: ${chrome.runtime.lastError.message}. Try refreshing the page.`;
                        messageDiv.style.color = '#d9534f';
                    } else if (results && results[0] && results[0].result !== undefined) {
                        const count = results[0].result;
                        if (count > 0) {
                            messageDiv.textContent = `Found and highlighted ${count} element(s).`;
                            messageDiv.style.color = '#5cb85c';
                        } else {
                            messageDiv.textContent = 'No elements found with this locator.';
                            messageDiv.style.color = '#f0ad4e';
                        }
                    } else {
                        messageDiv.textContent = 'Could not execute script on the page. It may be protected.';
                        messageDiv.style.color = '#d9534f';
                    }
                });
            });
        });
    });

    function renderHistory(history) {
        const section = document.getElementById('historySection');
        const divider = document.getElementById('historyDivider');
        const list = document.getElementById('historyList');
        const clearBtn = document.getElementById('clearHistoryBtn');
        if (!section || !list) return;

        if (!history || history.length === 0) {
            section.style.display = 'none';
            if (divider) divider.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        if (divider) divider.style.display = 'block';
        list.innerHTML = '';

        history.forEach(locator => {
            const entry = document.createElement('div');
            entry.className = 'history-entry';

            const code = document.createElement('code');
            code.textContent = locator;
            code.className = 'history-code';

            const btn = document.createElement('button');
            btn.textContent = 'Copy';
            btn.className = 'btn history-copy';
            btn.addEventListener('click', () => {
                navigator.clipboard.writeText(locator).then(() => {
                    btn.textContent = '✓';
                    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
                });
            });

            entry.appendChild(code);
            entry.appendChild(btn);
            list.appendChild(entry);
        });

        if (clearBtn) {
            clearBtn.onclick = () => {
                chrome.storage.local.set({ locatorHistory: [] }, () => renderHistory([]));
            };
        }
    }

    chrome.storage.local.get(['locatorHistory'], r => renderHistory(r.locatorHistory || []));

    chrome.runtime.onMessage.addListener((request) => {
        if (request.action === 'elementPicked') {
            const generatedLocator = request.locator;
            locatorOutputDiv.textContent = generatedLocator;
            currentLocator = generatedLocator;
            chrome.storage.local.set({ lastGeneratedLocator: generatedLocator });
            copyLocatorButton.style.display = 'block';
            chrome.storage.local.get(['locatorHistory'], r => renderHistory(r.locatorHistory || []));
        }
    });
});
