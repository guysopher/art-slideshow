// Background music: plays playlist.json (Musopen recordings, public domain, archive.org).
// Works are shuffled; the movements inside a work keep their order. Loops forever.
const BASE = 'https://archive.org/download/';
const VOLUME = 0.5;   // 0..1
const FADE_MS = 3000; // fade in at start, fade on mute / unmute

const audio = document.querySelector('audio');
let muted = new URLSearchParams(location.search).has('muted');
let works = [], queue = [], ramp = null;

const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function fadeTo(target, done) {
  clearInterval(ramp);
  const from = audio.volume, t0 = performance.now();
  ramp = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / FADE_MS);
    audio.volume = from + (target - from) * k;
    if (k === 1) { clearInterval(ramp); done?.(); }
  }, 50);
}

function next() {
  if (!queue.length) queue = shuffle(works).flat();
  audio.src = BASE + queue.shift();
  if (!muted) audio.play().catch(() => {});
}

audio.addEventListener('ended', next);
// Broken file or network down: try the next track a bit later.
audio.addEventListener('error', () => setTimeout(next, 5000));

chrome.runtime.onMessage.addListener((m) => {
  if (m?.target !== 'offscreen') return;
  if (m.cmd === 'mute') {
    muted = m.muted;
    if (muted) fadeTo(0, () => audio.pause());
    else { audio.play().catch(() => {}); fadeTo(VOLUME); }
  } else if (m.cmd === 'next') next();
});

fetch('playlist.json').then((r) => r.json()).then((w) => {
  works = w;
  audio.volume = 0;
  next();
  if (muted) audio.pause(); else fadeTo(VOLUME);
});
