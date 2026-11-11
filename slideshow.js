// Explore Slideshow — injected by background.js into the window it opened.
// Reads the Explore feed with your own browser session and plays it full screen.
(() => {
  // Skip Cloudflare's check page so it stays visible; the real page gets injected after it.
  if (window.__mjSlideshow || /just a moment/i.test(document.title)) return;
  window.__mjSlideshow = true;

  const SHOW_MS = 30_000;          // default time per image or video; Up / Down change it by 1 s (remembered)
  const MIN_MS = 3_000, MAX_MS = 600_000;
  const FADE_AUTO = 2.5;           // seconds, slow crossfade
  const FADE_MANUAL = 1;           // seconds, after an arrow / space / enter
  const FEEDS = ['top_month', 'video_top_month']; // Explore's Images and Videos tabs
  const PAGES = 4;                 // 50 jobs per page
  const VIDEOS = true;             // include videos (muted, looping; at least one full play each)
  const GALLERIES = true;          // also show each Explore creator's public gallery (images and videos)
  const GALLERY_PARALLEL = 8;      // galleries read at the same time
  const REFRESH_MS = 10 * 60_000;  // re-read the feed every 10 min

  // ---- overlay (shadow DOM so the site's CSS cannot touch it) ----
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#000;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      :host, .stage { all: initial; }
      .stage { position: fixed; inset: 0; background: #000; overflow: hidden; display: block; }
      .stage.idle { cursor: none; }
      img, video {
        position: absolute; inset: 0; width: 100%; height: 100%;
        object-fit: contain; background: #000; opacity: 0;
        transition: opacity var(--fade, ${FADE_AUTO}s) ease-in-out;
        user-select: none; -webkit-user-drag: none;
      }
      img.on, video.on { opacity: 1; }
      .hud {
        position: absolute; left: 50%; bottom: 7%; transform: translateX(-50%);
        padding: 10px 24px; border-radius: 999px; background: rgba(0,0,0,.55);
        color: #fff; font: 600 26px/1.2 -apple-system, system-ui, sans-serif; letter-spacing: .02em;
        opacity: 0; pointer-events: none; white-space: nowrap;
      }
      .hud.show { animation: hud 1.4s ease-out forwards; }
      @keyframes hud {
        0% { opacity: 0; transform: translateX(-50%) scale(.92); }
        12% { opacity: 1; transform: translateX(-50%) scale(1); }
        65% { opacity: 1; }
        100% { opacity: 0; }
      }
    </style>
    <div class="stage idle"><img alt=""><video muted loop playsinline></video><img alt=""><video muted loop playsinline></video><div class="hud"></div></div>`;
  document.documentElement.appendChild(host);
  document.documentElement.style.overflow = 'hidden';
  document.title = 'Art Slideshow';
  const setIcon = () => {
    document.querySelectorAll('link[rel~="icon"]').forEach((l) => l.remove());
    const l = document.createElement('link');
    l.rel = 'icon'; l.href = chrome.runtime.getURL('icons/icon-32.png');
    document.head?.appendChild(l);
  };
  setIcon(); setTimeout(setIcon, 3000); // the site may put its own back while it loads
  const stage = root.querySelector('.stage');
  // Two layers crossfade; each has an <img> and a <video>, and uses the one the item needs.
  const imgs = [...root.querySelectorAll('img')], vids = [...root.querySelectorAll('video')];
  vids.forEach((v) => { v.muted = true; });
  const layers = [0, 1].map((i) => ({ img: imgs[i], vid: vids[i] }));
  const hud = root.querySelector('.hud');
  function flash(text) {
    hud.textContent = text;
    hud.classList.remove('show'); void hud.offsetWidth; hud.classList.add('show');
  }

  // Keep the site underneath quiet: no videos playing behind the overlay.
  // (The slideshow's own videos sit in a closed shadow root, which this does not reach.)
  setInterval(() => document.querySelectorAll('video').forEach((v) => { v.muted = true; v.pause(); }), 2000);

  // ---- feed ----
  let list = [], pos = -1, front = 0, timer = null, token = 0, fails = 0;
  let showMs = SHOW_MS, paused = false;
  let muted = false;
  chrome.storage.local.get(['showMs', 'muted']).then((v) => {
    if (v.showMs) showMs = v.showMs;
    muted = !!v.muted;
  }).catch(() => {});
  // Music on/off can come from M here or from the Chrome-wide shortcut: show it either way.
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local' || !c.muted) return;
    muted = !!c.muted.newValue;
    flash(muted ? '\u266A  Music off' : '\u266A  Music on');
  });

  const url = (it) => it.video
    ? `https://cdn.midjourney.com/video/${it.id}/${it.index}.mp4`
    : `https://cdn.midjourney.com/${it.id}/0_${it.index}.webp`;

  const item = (id, index, video = false) => ({ key: `${video ? 'v' : 'i'}_${id}_${index}`, id, index, video });
  const api = (path) => fetch(path, { headers: { 'x-csrf-protection': '1' }, credentials: 'include', cache: 'no-store' });

  function toItems(jobs) {
    const out = [];
    for (const j of jobs) {
      const video = j?.type === 'video';
      if (!j?.id || (j.type !== 'image' && !(video && VIDEOS))) continue;
      const index = (j.items || []).findIndex((x) => x && x.server_filtered === false);
      if (index < 0) continue;
      out.push({ ...item(j.id, index, video), user: j.username_v2 });
    }
    return out;
  }

  async function readExplore() {
    const all = [];
    for (const feed of VIDEOS ? FEEDS : FEEDS.slice(0, 1)) {
      for (let p = 0; p < PAGES; p++) {
        const r = await api(`/api/explore?page=${p}&feed=${feed}&_ql=explore`);
        if (!r.ok) throw new Error('feed ' + r.status);
        const jobs = await r.json();
        if (!Array.isArray(jobs) || !jobs.length) break;
        all.push(...toItems(jobs));
      }
    }
    return all;
  }

  // One creator's public gallery (their profile page): up to 50 images and videos.
  // "Virtual" upscales have no file of their own; their parent image is the same picture.
  async function readGallery(user) {
    try {
      const r = await api(`/api/spotlight-feed?username_v2=${encodeURIComponent(user)}`);
      const jobs = r.ok ? await r.json() : [];
      return (Array.isArray(jobs) ? jobs : [])
        .filter((j) => j?.id && (VIDEOS || !j.video_segments) && j.published !== false && j.event_type !== 'uploaded')
        .map((j) => j.video_segments ? item(j.id, j.grid_index ?? 0, true)
          : /_virtual/.test(j.event_type) && j.parent_id ? item(j.parent_id, j.parent_grid ?? 0)
          : item(j.id, j.grid_index ?? 0));
    } catch { return []; }
  }

  // Galleries of every creator on Explore, a few at a time.
  async function readGalleries(explore) {
    const users = [...new Set(explore.map((x) => x.user).filter(Boolean))];
    const out = [];
    for (let i = 0; i < users.length; i += GALLERY_PARALLEL) {
      (await Promise.all(users.slice(i, i + GALLERY_PARALLEL).map(readGallery))).forEach((l) => out.push(...l));
    }
    return out;
  }

  const dedupe = (a) => { const seen = new Set(); return a.filter((x) => !seen.has(x.key) && seen.add(x.key)); };

  // Random order: every item gets a random rank once, so a refresh slots new items in at random
  // places without reshuffling what is already queued. After a full round the ranks are redrawn.
  let rank = new Map();
  const rankOf = (k) => { if (!rank.has(k)) rank.set(k, Math.random()); return rank.get(k); };
  const shuffled = (a) => a.sort((x, y) => rankOf(x.key) - rankOf(y.key));

  function setList(fresh) {
    const curKey = list[pos]?.key;
    list = shuffled(dedupe(fresh));
    const i = list.findIndex((x) => x.key === curKey);
    pos = i >= 0 ? i : Math.min(pos, list.length - 1);
    if (!timer && token === 0) go(1, false);
  }

  let galleries = [];
  async function refresh() {
    try {
      const explore = await readExplore();
      fails = 0;
      if (!explore.length) return;
      setList([...explore, ...galleries]); // the show starts right away, before the galleries arrive
      if (!GALLERIES) return;
      galleries = await readGalleries(explore);
      setList([...explore, ...galleries]);
    } catch {
      // Session expired or network hiccup: retry soon; after 3 misses reload the page
      // (the browser renews its Midjourney session, the slideshow restarts itself).
      if (++fails >= 3) location.reload();
      else setTimeout(refresh, 30_000);
    }
  }

  // ---- playback ----
  const preloads = [];
  function preload(k) {
    if (!list.length) return;
    const it = list[((pos + k) % list.length + list.length) % list.length];
    if (!it.video) { const im = new Image(); im.src = url(it); return; }
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.src = url(it);
    preloads.push(v); if (preloads.length > 3) preloads.shift().removeAttribute('src');
  }

  // Resolves when the video can play, rejects on error or after 15 s.
  const ready = (v) => new Promise((ok, fail) => {
    if (v.readyState >= 3) return ok();
    const t = setTimeout(() => done(fail), 15_000);
    const done = (f) => { clearTimeout(t); v.oncanplay = v.onerror = null; f(); };
    v.oncanplay = () => done(ok);
    v.onerror = () => done(fail);
  });

  let shownVideo = null; // the video on screen, so its length can stretch the time on screen
  async function go(step, manual) {
    if (!list.length) return;
    clearTimeout(timer); timer = null;
    const my = ++token;
    const next = pos + step;
    if (!manual && next >= list.length) { rank = new Map(); list = shuffled(list); pos = -1; } // new round, new order
    pos = ((pos + step) % list.length + list.length) % list.length;
    const it = list[pos];
    const back = layers[1 - front];
    const el = it.video ? back.vid : back.img;
    if (!it.video) { back.vid.pause(); back.vid.removeAttribute('src'); back.vid.load(); } // no hidden video left running
    el.src = url(it);
    try {
      if (it.video) { await ready(el); el.currentTime = 0; await el.play(); }
      else await el.decode();
    } catch {
      if (my === token) timer = setTimeout(() => go(step < 0 ? -1 : 1, manual), 200);
      return;
    }
    if (my !== token) { if (it.video) el.pause(); return; }
    const fade = (manual ? FADE_MANUAL : FADE_AUTO) + 's';
    [...imgs, ...vids].forEach((l) => l.style.setProperty('--fade', fade));
    (it.video ? back.img : back.vid).classList.remove('on');
    el.classList.add('on');
    const old = layers[front];
    old.img.classList.remove('on'); old.vid.classList.remove('on');
    // After the fade, stop the old video, unless a newer step already reuses that layer.
    setTimeout(() => { if (my === token) { old.vid.pause(); old.vid.removeAttribute('src'); old.vid.load(); } },
      (manual ? FADE_MANUAL : FADE_AUTO) * 1000 + 100);
    front = 1 - front;
    shownVideo = it.video ? el : null;
    preload(1); preload(2); preload(-1);
    schedule();
  }

  // Images stay showMs. Videos loop and stay showMs too, but always play through at least once.
  function schedule() {
    clearTimeout(timer); timer = null;
    if (paused) return;
    const len = shownVideo && isFinite(shownVideo.duration) ? shownVideo.duration * 1000 : 0;
    timer = setTimeout(() => go(1, false), Math.max(showMs, len));
  }

  function setSpeed(deltaMs) {
    showMs = Math.min(MAX_MS, Math.max(MIN_MS, showMs + deltaMs));
    chrome.storage.local.set({ showMs }).catch(() => {});
    if (pos >= 0) schedule(); // the current item now waits the new time
    flash(`${showMs / 1000} s${paused ? ' \u00B7 paused' : ''}`);
  }

  function togglePause() {
    paused = !paused;
    if (pos >= 0) schedule();
    flash(paused ? '\u275A\u275A  Paused' : `\u25B6  ${showMs / 1000} s`);
  }

  // ---- input ----
  const fullscreen = () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); };
  const music = (cmd) => chrome.runtime.sendMessage({ music: cmd }).catch(() => {});
  setInterval(() => music('ensure'), 60_000);
  // First key press also hides everything but the image (page full screen needs a key or click).
  let firstKey = true;
  window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (firstKey && k !== 'f' && k !== 'F') { firstKey = false; fullscreen(); }
    if (k === 'ArrowRight' || k === 'Enter') go(1, true);
    else if (k === 'ArrowLeft') go(-1, true);
    else if (k === ' ') { if (!e.repeat) togglePause(); }
    else if (k === 'ArrowUp') setSpeed(1000);
    else if (k === 'ArrowDown') setSpeed(-1000);
    else if (k === 'f' || k === 'F') document.fullscreenElement ? document.exitFullscreen() : fullscreen();
    else if (k === 'm' || k === 'M') music('mute');
    else if (k === 'n' || k === 'N') { music('next'); flash(muted ? '\u266A  Next piece \u00B7 music off' : '\u266A  Next piece'); }
    else return;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  host.addEventListener('click', fullscreen);

  let idle;
  host.addEventListener('mousemove', () => {
    stage.classList.remove('idle');
    clearTimeout(idle); idle = setTimeout(() => stage.classList.add('idle'), 1500);
  });

  refresh();
  setInterval(refresh, REFRESH_MS);
})();
