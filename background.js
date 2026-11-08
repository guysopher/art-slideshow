// Toolbar click: open Explore in a full-screen window and remember that tab.
// Every time that tab finishes loading a midjourney.com page, inject the slideshow.
const START = 'https://www.midjourney.com/explore?tab=top';
const key = (id) => 'slideshow-tab-' + id;

chrome.action.onClicked.addListener(async () => {
  const w = await chrome.windows.create({ url: START, state: 'fullscreen' });
  await chrome.storage.session.set({ [key(w.tabs[0].id)]: true });
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete') return;
  if (!tab.url || !tab.url.startsWith('https://www.midjourney.com/')) return;
  const k = key(tabId);
  if (!(await chrome.storage.session.get(k))[k]) return;
  chrome.scripting.executeScript({ target: { tabId }, files: ['slideshow.js'] }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(key(tabId)));
