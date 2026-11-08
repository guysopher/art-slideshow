// Explore Slideshow — injected by background.js into the window it opened.
// Reads the Explore feed with your own browser session and plays it full screen.
(() => {
  // Skip Cloudflare's check page so it stays visible; the real page gets injected after it.
  if (window.__mjSlideshow || /just a moment/i.test(document.title)) return;
  window.__mjSlideshow = true;

  const SHOW_MS = 10_000;          // each image stays 10 s
  const FADE_AUTO = 2.5;           // seconds, slow crossfade
  const FADE_MANUAL = 1;           // seconds, after an arrow / space / enter
  const FEED = 'top_month';        // what midjourney.com/explore shows by default
  const PAGES = 4;                 // 50 jobs per page
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
      img {
        position: absolute; inset: 0; width: 100%; height: 100%;
        object-fit: contain; background: #000; opacity: 0;
        transition: opacity var(--fade, ${FADE_AUTO}s) ease-in-out;
        user-select: none; -webkit-user-drag: none;
      }
      img.on { opacity: 1; }
    </style>
    <div class="stage idle"><img alt=""><img alt=""></div>`;
  document.documentElement.appendChild(host);
  document.documentElement.style.overflow = 'hidden';
  document.title = 'Explore';
  const stage = root.querySelector('.stage');
  const layers = [...root.querySelectorAll('img')];

  // Keep the site underneath quiet: no videos playing behind the overlay.
  setInterval(() => document.querySelectorAll('video').forEach((v) => { v.muted = true; v.pause(); }), 2000);

  // ---- feed ----
  let list = [], pos = -1, front = 0, timer = null, token = 0, fails = 0;

  const imageUrl = (it) => `https://cdn.midjourney.com/${it.id}/0_${it.index}.webp`;

  function toItems(jobs) {
    const out = [];
    for (const j of jobs) {
      if (!j?.id || j.type !== 'image') continue;
      const index = (j.items || []).findIndex((x) => x && x.server_filtered === false);
      if (index < 0) continue;
      out.push({ key: `${j.id}_${index}`, id: j.id, index });
    }
    return out;
  }

  async function readFeed() {
    const all = [];
    for (let p = 0; p < PAGES; p++) {
      const r = await fetch(`/api/explore?page=${p}&feed=${FEED}&_ql=explore`, {
        headers: { 'x-csrf-protection': '1' }, credentials: 'include', cache: 'no-store',
      });
      if (!r.ok) throw new Error('feed ' + r.status);
      const jobs = await r.json();
      if (!Array.isArray(jobs) || !jobs.length) break;
      all.push(...toItems(jobs));
    }
    const seen = new Set();
    return all.filter((x) => !seen.has(x.key) && seen.add(x.key));
  }

  async function refresh() {
    try {
      const fresh = await readFeed();
      fails = 0;
      if (!fresh.length) return;
      const curKey = list[pos]?.key;
      list = fresh;
      const i = list.findIndex((x) => x.key === curKey);
      pos = i >= 0 ? i : Math.min(pos, list.length - 1);
      if (!timer && token === 0) go(1, false);
    } catch {
      // Session expired or network hiccup: retry soon; after 3 misses reload the page
      // (the browser renews its Midjourney session, the slideshow restarts itself).
      if (++fails >= 3) location.reload();
      else setTimeout(refresh, 30_000);
    }
  }

  // ---- playback ----
  function preload(k) {
    if (!list.length) return;
    const it = list[((pos + k) % list.length + list.length) % list.length];
    const im = new Image(); im.src = imageUrl(it);
  }

  async function go(step, manual) {
    if (!list.length) return;
    clearTimeout(timer); timer = null;
    const my = ++token;
    pos = ((pos + step) % list.length + list.length) % list.length;
    const back = layers[1 - front];
    back.src = imageUrl(list[pos]);
    try { await back.decode(); }
    catch { if (my === token) timer = setTimeout(() => go(step < 0 ? -1 : 1, manual), 200); return; }
    if (my !== token) return;
    const fade = (manual ? FADE_MANUAL : FADE_AUTO) + 's';
    layers.forEach((l) => l.style.setProperty('--fade', fade));
    back.classList.add('on');
    layers[front].classList.remove('on');
    front = 1 - front;
    preload(1); preload(2); preload(-1);
    timer = setTimeout(() => go(1, false), SHOW_MS);
  }

  // ---- input ----
  const fullscreen = () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); };
  window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowRight' || k === ' ' || k === 'Enter') go(1, true);
    else if (k === 'ArrowLeft') go(-1, true);
    else if (k === 'f' || k === 'F') document.fullscreenElement ? document.exitFullscreen() : fullscreen();
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
