// Toolbar click: open Explore in a full-screen window with no browser bars and remember that tab.
// Every time that tab finishes loading a midjourney.com page, inject the slideshow.
// Music plays from an offscreen page while a slideshow window is open.
const START = 'https://www.midjourney.com/explore?tab=top';
const key = (id) => 'slideshow-tab-' + id;

async function startMusic(force) {
  if (await chrome.offscreen.hasDocument()) return;
  const { muted } = await chrome.storage.local.get('muted');
  if (muted && !force) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html' + (muted ? '?muted' : ''),
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Background classical music for the slideshow.',
  }).catch(() => {}); // already being created
}

async function stopMusicIfIdle() {
  const all = await chrome.storage.session.get(null);
  if (!Object.keys(all).some((k) => k.startsWith('slideshow-tab-'))) chrome.offscreen.closeDocument().catch(() => {});
}

chrome.action.onClicked.addListener(async () => {
  const w = await chrome.windows.create({ url: START, type: 'popup', state: 'fullscreen' });
  await chrome.storage.session.set({ [key(w.tabs[0].id)]: true });
  chrome.windows.update(w.id, { state: 'fullscreen', focused: true }).catch(() => {}); // macOS sometimes ignores state on create
  startMusic();
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete') return;
  if (!tab.url || !tab.url.startsWith('https://www.midjourney.com/')) return;
  const k = key(tabId);
  if (!(await chrome.storage.session.get(k))[k]) return;
  chrome.scripting.executeScript({ target: { tabId }, files: ['slideshow.js'] }).catch(() => {});
  startMusic();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await chrome.storage.session.remove(key(tabId));
  stopMusicIfIdle();
});

// Messages from the slideshow: M = mute on/off (remembered), N = next piece,
// 'ensure' = restart the music if Chrome closed it (it closes a silent offscreen page after 30 s).
chrome.runtime.onMessage.addListener((m, sender) => {
  if (!m?.music || !sender.tab) return;
  (async () => {
    const { muted } = await chrome.storage.local.get('muted');
    if (m.music === 'ensure') { startMusic(); return; }
    if (m.music === 'mute') {
      await chrome.storage.local.set({ muted: !muted });
      await startMusic(true);
      chrome.runtime.sendMessage({ target: 'offscreen', cmd: 'mute', muted: !muted }).catch(() => {});
    } else if (m.music === 'next') {
      await startMusic(true);
      chrome.runtime.sendMessage({ target: 'offscreen', cmd: 'next' }).catch(() => {});
    }
  })();
});
