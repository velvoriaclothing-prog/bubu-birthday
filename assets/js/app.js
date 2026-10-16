
'use strict';
// ============================================================
// BUBU BIRTHDAY WORLD — MAIN APPLICATION
// ============================================================

// ── State ──────────────────────────────────────────────────
const STATE = {
  unlocked: false,
  currentPage: 'home',
  manifest: null,
  settings: {
    ambientVideoEnabled: true,
    ambientLoopPlaylist: true,
    ambientShuffle: false,
    ambientMuted: true,
    ambientPauseHidden: true,
    ambientLowBandwidth: false,
    slideshowAuto: true,
    slideshowSpeed: 5000,
    slideshowShuffle: false,
    slideshowFavoritesOnly: false,
    floatingHeartsEnabled: true,
    floatingPhotosEnabled: true,
    animatedBgEnabled: true,
    reducedMotion: false,
    musicEnabled: false,
    musicVolume: 0.4,
  },
  slideshow: { index: 0, paused: false, timer: null, photos: [] },
  video: {
    playlist: [],
    current: -1,
    element: null,
    playing: false,
    retryCount: 0,
    maxRetry: 2,
  },
  lightbox: { open: false, index: 0, photos: [] },
  gifts: new Set(),
  quiz: { qIndex: 0, score: 0 },
  memory: { cards: [], flipped: [], matches: 0, locked: false, moves: 0, timer: null, elapsed: 0 },
  preload: { done: 0, total: 0, phase: 0 },
  animFrame: null,
  heartsInterval: null,
  polaroidInterval: null,
  canvas: { ctx: null, particles: [] },
  currentAlbum: 'all',
  currentGamePage: null,
};

// ── Helpers ────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const shuffle = arr => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const lerp = (a, b, t) => a + (b - a) * t;
const saveSettings = () => {
  try { localStorage.setItem('bubu_settings', JSON.stringify(STATE.settings)); } catch(e) {}
};
const loadSettings = () => {
  try {
    const s = localStorage.getItem('bubu_settings');
    if (s) Object.assign(STATE.settings, JSON.parse(s));
  } catch(e) {}
};

// ── Preloader ──────────────────────────────────────────────
class AssetPreloader {
  constructor() {
    this.queue = [];
    this.active = 0;
    this.maxConcurrent = 4;
    this.loaded = 0;
    this.total = 0;
    this.onProgress = null;
  }

  add(src, priority = 5, type = 'image') {
    this.queue.push({ src, priority, type });
    this.queue.sort((a, b) => a.priority - b.priority);
    this.total++;
  }

  start() {
    this._pump();
  }

  _pump() {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift();
      this.active++;
      this._load(item).then(() => {
        this.active--;
        this.loaded++;
        this.onProgress && this.onProgress(this.loaded, this.total);
        this._pump();
      }).catch(() => {
        this.active--;
        this.loaded++;
        this.onProgress && this.onProgress(this.loaded, this.total);
        this._pump();
      });
    }
  }

  _load(item) {
    return new Promise((resolve, reject) => {
      if (item.type === 'image') {
        const img = new Image();
        img.onload = resolve;
        img.onerror = reject;
        img.src = item.src;
      } else if (item.type === 'video-metadata') {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = resolve;
        v.onerror = reject;
        v.src = item.src;
        setTimeout(resolve, 3000); // fallback timeout
      } else {
        resolve();
      }
    });
  }
}

const preloader = new AssetPreloader();

// ── Manifest Loader ────────────────────────────────────────
async function loadManifest() {
  try {
    const r = await fetch('media-manifest.json');
    STATE.manifest = await r.json();
    return STATE.manifest;
  } catch (e) {
    console.warn('Manifest not found, using empty state');
    STATE.manifest = { photos: [], videos: [], albums: [], loveLetters: [], birthdaySchedule: [], mysteryGifts: [] };
    return STATE.manifest;
  }
}

// ── Background Preparation ─────────────────────────────────
function scheduleBackgroundPreload(manifest) {
  if (!manifest) return;

  // Priority 1: Lock screen assets (already visible) — nothing heavy needed
  // Priority 2: Featured photo + first few thumbs
  const featured = manifest.photos.find(p => p.featured);
  if (featured) preloader.add(featured.file, 2, 'image');

  const favorites = manifest.photos.filter(p => p.favorite).slice(0, 6);
  favorites.forEach(p => preloader.add(p.file, 2, 'image'));

  // Priority 3: First batch of photos
  manifest.photos.slice(0, 12).forEach(p => preloader.add(p.file, 3, 'image'));

  // Priority 4: Featured video metadata
  const featuredVid = manifest.videos.find(v => v.featured);
  if (featuredVid) preloader.add(featuredVid.file, 4, 'video-metadata');

  // Priority 5: Remaining photos
  manifest.photos.slice(12).forEach(p => preloader.add(p.file, 5, 'image'));

  // Track progress
  preloader.onProgress = (done, total) => {
    STATE.preload.done = done;
    STATE.preload.total = total;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const bar = document.querySelector('.lock-preload-progress');
    if (bar) bar.style.width = pct + '%';
  };

  preloader.start();
}

// ── Canvas Background ──────────────────────────────────────
function initCanvas() {
  const canvas = $('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  STATE.canvas.ctx = ctx;
  STATE.canvas.particles = [];

  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  resize();
  window.addEventListener('resize', resize);

  // Create gradient particles
  for (let i = 0; i < 60; i++) {
    STATE.canvas.particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 3 + 0.5,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      alpha: Math.random() * 0.5 + 0.1,
      color: Math.random() > 0.5 ? '#ff85b5' : '#c084fc',
    });
  }

  animateCanvas();
}

function animateCanvas() {
  if (STATE.settings.reducedMotion || !STATE.settings.animatedBgEnabled) return;
  const { ctx, particles } = STATE.canvas;
  if (!ctx) return;
  const w = ctx.canvas.width, h = ctx.canvas.height;

  ctx.clearRect(0, 0, w, h);

  // Draw gradient orbs
  const t = Date.now() * 0.0004;
  const orbs = [
    { x: w * (0.3 + 0.15 * Math.sin(t)), y: h * (0.25 + 0.1 * Math.cos(t * 0.7)), r: Math.min(w, h) * 0.4, c1: 'rgba(255,92,155,0.06)', c2: 'rgba(255,92,155,0)' },
    { x: w * (0.7 + 0.12 * Math.cos(t * 1.1)), y: h * (0.6 + 0.12 * Math.sin(t * 0.9)), r: Math.min(w, h) * 0.35, c1: 'rgba(192,132,252,0.05)', c2: 'rgba(192,132,252,0)' },
    { x: w * (0.5 + 0.1 * Math.sin(t * 0.5)), y: h * (0.8 + 0.08 * Math.cos(t * 1.3)), r: Math.min(w, h) * 0.3, c1: 'rgba(255,133,181,0.04)', c2: 'rgba(255,133,181,0)' },
  ];

  orbs.forEach(o => {
    const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
    g.addColorStop(0, o.c1);
    g.addColorStop(1, o.c2);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
    ctx.fill();
  });

  // Particles
  particles.forEach(p => {
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0) p.x = w;
    if (p.x > w) p.x = 0;
    if (p.y < 0) p.y = h;
    if (p.y > h) p.y = 0;
    ctx.globalAlpha = p.alpha * 0.6;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });

  STATE.animFrame = requestAnimationFrame(animateCanvas);
}

function stopCanvas() {
  if (STATE.animFrame) cancelAnimationFrame(STATE.animFrame);
  STATE.animFrame = null;
}

// ── Floating Hearts ────────────────────────────────────────
const HEARTS = ['💗', '💕', '💖', '💝', '💓', '🌸', '✨', '⭐', '🎀', '💫'];

function startFloatingHearts() {
  if (STATE.heartsInterval) clearInterval(STATE.heartsInterval);
  if (!STATE.settings.floatingHeartsEnabled || STATE.settings.reducedMotion) return;

  const container = $('floating-hearts');
  if (!container) return;

  const density = window.innerWidth > 768 ? 2200 : 3500;

  STATE.heartsInterval = setInterval(() => {
    if (document.hidden) return;
    const h = el('span', 'floating-heart');
    h.textContent = HEARTS[Math.floor(Math.random() * HEARTS.length)];
    h.style.left = Math.random() * 100 + '%';
    h.style.fontSize = (Math.random() * 12 + 10) + 'px';
    const dur = Math.random() * 8 + 8;
    h.style.animationDuration = dur + 's';
    h.style.animationDelay = Math.random() * 2 + 's';
    container.appendChild(h);
    setTimeout(() => h.remove(), (dur + 2) * 1000);
  }, density);
}

function stopFloatingHearts() {
  if (STATE.heartsInterval) clearInterval(STATE.heartsInterval);
  STATE.heartsInterval = null;
  const container = $('floating-hearts');
  if (container) container.innerHTML = '';
}

// ── Floating Polaroids ─────────────────────────────────────
function startFloatingPolaroids() {
  if (!STATE.manifest || !STATE.settings.floatingPhotosEnabled || STATE.settings.reducedMotion) return;
  if (window.innerWidth < 768) return; // Only on larger screens

  const existingPolaroids = document.querySelectorAll('.floating-polaroid');
  existingPolaroids.forEach(p => p.remove());

  const photos = STATE.manifest.photos.filter(p => p.favorite).slice(0, 4);
  if (photos.length === 0) return;

  photos.forEach((photo, i) => {
    const div = el('div', 'floating-polaroid');
    const rotS = (Math.random() - 0.5) * 14;
    const rotE = (Math.random() - 0.5) * 14;
    div.style.setProperty('--rot-s', rotS + 'deg');
    div.style.setProperty('--rot-e', rotE + 'deg');
    div.style.left = (10 + Math.random() * 80) + '%';
    div.style.top = (10 + Math.random() * 70) + '%';
    div.style.animationDuration = (6 + Math.random() * 6) + 's';
    div.style.animationDelay = (i * 1.5) + 's';
    div.style.opacity = '0.25';
    div.style.zIndex = '1';

    const inner = el('div', 'floating-polaroid-inner');
    const img = document.createElement('img');
    img.src = photo.file;
    img.alt = photo.caption || '';
    img.loading = 'lazy';
    inner.appendChild(img);
    const lbl = el('div', 'polar-label');
    lbl.textContent = '💗';
    inner.appendChild(lbl);
    div.appendChild(inner);
    document.body.appendChild(div);
  });
}

// ── Lock Screen ────────────────────────────────────────────
const PASSCODE = '1710';
let pinBuffer = '';

function initLockScreen() {
  const lockScreen = $('lock-screen');
  if (!lockScreen) return;

  // Set hero image if available  
  const heroImg = document.querySelector('.lock-illustration img');
  if (heroImg) {
    heroImg.onerror = () => {
      const parent = heroImg.parentElement;
      parent.innerHTML = '<div class="lock-illustration-placeholder">💗</div>';
    };
  }

  // Keypad
  document.querySelectorAll('.keypad-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.val;
      if (val === 'del') {
        pinBuffer = pinBuffer.slice(0, -1);
      } else if (val && pinBuffer.length < 4) {
        pinBuffer += val;
      }
      updatePinDisplay();
      if (pinBuffer.length === 4) {
        setTimeout(checkPasscode, 150);
      }
    });
  });

  // Keyboard support
  document.addEventListener('keydown', e => {
    if (STATE.unlocked) return;
    if (e.key >= '0' && e.key <= '9' && pinBuffer.length < 4) {
      pinBuffer += e.key;
      updatePinDisplay();
      if (pinBuffer.length === 4) setTimeout(checkPasscode, 150);
    } else if (e.key === 'Backspace') {
      pinBuffer = pinBuffer.slice(0, -1);
      updatePinDisplay();
    }
  });
}

function updatePinDisplay() {
  document.querySelectorAll('.pin-dot').forEach((dot, i) => {
    dot.classList.toggle('filled', i < pinBuffer.length);
    dot.classList.remove('error');
  });
}

function checkPasscode() {
  if (pinBuffer === PASSCODE) {
    unlockSite();
  } else {
    document.querySelectorAll('.pin-dot').forEach(d => d.classList.add('error'));
    const hint = document.querySelector('.unlock-hint');
    if (hint) { hint.textContent = 'Wrong code... Try again! 💗'; hint.classList.add('error-msg'); }
    setTimeout(() => {
      pinBuffer = '';
      updatePinDisplay();
      document.querySelectorAll('.pin-dot').forEach(d => d.classList.remove('error'));
      if (hint) { hint.textContent = ''; hint.classList.remove('error-msg'); }
    }, 1000);
  }
}

function unlockSite() {
  STATE.unlocked = true;
  const lockScreen = $('lock-screen');
  const mainApp = $('main-app');

  if (lockScreen) {
    lockScreen.classList.remove('active');
    lockScreen.classList.add('hidden');
  }
  if (mainApp) {
    mainApp.classList.remove('hidden');
  }

  // Build all sections now
  buildHomePage();
  buildGalleryPage();
  buildVideosPage();
  buildLettersPage();
  buildGamesPage();
  buildMorePage();

  navigateTo('home');

  // Start ambient systems
  setTimeout(() => {
    startAmbientVideo();
    startFloatingPolaroids();
    launchConfetti(50);
  }, 500);

  try { localStorage.setItem('bubu_visited', '1'); } catch(e) {}
}

// ── Navigation ─────────────────────────────────────────────
function navigateTo(pageId) {
  STATE.currentPage = pageId;

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const page = $('page-' + pageId);
  if (page) page.classList.add('active');

  const navItem = document.querySelector(`.nav-item[data-page="${pageId}"]`);
  if (navItem) navItem.classList.add('active');

  // Pause slideshow on non-gallery pages
  if (pageId !== 'gallery' && pageId !== 'home') pauseSlideshow();
  if (pageId === 'gallery') resumeSlideshow();

  // Reduce decorations on games
  if (pageId === 'games') {
    stopFloatingHearts();
  } else if (STATE.settings.floatingHeartsEnabled) {
    startFloatingHearts();
  }
}

function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      if (page) {
        navigateTo(page);
        if (page === 'games') {
          startMemoryGame();
          startQuiz();
        }
      }
    });
  });

  window.addEventListener('hashchange', () => {
    if (!STATE.unlocked) return;
    const hash = window.location.hash.replace('#', '').replace('page-', '');
    if (['home', 'gallery', 'videos', 'letters', 'games', 'more'].includes(hash)) {
      navigateTo(hash);
      if (hash === 'games') {
        startMemoryGame();
        startQuiz();
      }
    }
  });
}

// ── Ambient Video System ───────────────────────────────────
function initVideoElement() {
  if (STATE.video.element) return STATE.video.element;
  const v = document.createElement('video');
  v.id = 'ambient-video';
  v.muted = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.preload = 'metadata';
  v.addEventListener('ended', onVideoEnded);
  v.addEventListener('error', onVideoError);
  v.addEventListener('loadedmetadata', onVideoLoaded);
  const container = $('ambient-video-container');
  if (container) container.prepend(v);
  STATE.video.element = v;
  return v;
}

function buildVideoPlaylist() {
  if (!STATE.manifest) return [];
  let videos = [...STATE.manifest.videos];
  if (STATE.settings.ambientShuffle) videos = shuffle(videos);
  else {
    // Favorites first
    const favs = videos.filter(v => v.favorite);
    const rest = videos.filter(v => !v.favorite);
    videos = [...favs, ...rest];
  }
  // Filter to supported formats (MOV may have issues on some browsers)
  return videos;
}

function startAmbientVideo() {
  if (!STATE.settings.ambientVideoEnabled) return;
  STATE.video.playlist = buildVideoPlaylist();
  if (STATE.video.playlist.length === 0) return;
  STATE.video.current = -1;
  advanceVideo();
}

function advanceVideo(skipCurrent = false) {
  const { playlist } = STATE.video;
  if (playlist.length === 0) return;

  if (skipCurrent) {
    STATE.video.current = (STATE.video.current + 1) % playlist.length;
  } else {
    STATE.video.current = (STATE.video.current + 1) % playlist.length;
  }

  STATE.video.retryCount = 0;
  loadAndPlayVideo(playlist[STATE.video.current].file);

  // Preload next
  const nextIdx = (STATE.video.current + 1) % playlist.length;
  if (nextIdx !== STATE.video.current) {
    const nextV = document.createElement('video');
    nextV.preload = 'metadata';
    nextV.src = playlist[nextIdx].file;
  }
}

function loadAndPlayVideo(src) {
  const v = initVideoElement();
  const container = $('ambient-video-container');

  v.src = src;
  v.muted = STATE.settings.ambientMuted;
  v.load();

  const tryPlay = () => {
    if (!STATE.settings.ambientVideoEnabled) return;
    v.play().then(() => {
      STATE.video.playing = true;
      if (container) container.classList.add('active');
      updateAmbientUI();
    }).catch(err => {
      if (err.name === 'NotAllowedError') {
        // Show tap-to-play indicator
        showAutoplayBlocked();
      } else {
        onVideoError();
      }
    });
  };

  v.addEventListener('canplay', tryPlay, { once: true });
  setTimeout(tryPlay, 1000); // fallback
}

function onVideoEnded() {
  if (!STATE.settings.ambientLoopPlaylist) return;
  advanceVideo();
}

function onVideoLoaded() {
  updateAmbientUI();
}

function onVideoError() {
  STATE.video.retryCount++;
  if (STATE.video.retryCount <= STATE.video.maxRetry) {
    setTimeout(() => advanceVideo(true), 1000);
  } else {
    STATE.video.retryCount = 0;
    advanceVideo(true);
  }
}

function showAutoplayBlocked() {
  const msg = document.querySelector('.autoplay-blocked-msg');
  if (msg) msg.classList.add('visible');
}

function pauseAmbientVideo() {
  const v = STATE.video.element;
  if (v && STATE.video.playing) {
    v.pause();
    STATE.video.playing = false;
    updateAmbientUI();
  }
}

function resumeAmbientVideo() {
  if (!STATE.settings.ambientVideoEnabled) return;
  const v = STATE.video.element;
  if (v && !STATE.video.playing) {
    v.play().catch(() => {});
    STATE.video.playing = true;
    updateAmbientUI();
  }
}

function updateAmbientUI() {
  const playBtn = $('ambient-play-btn');
  if (playBtn) playBtn.textContent = STATE.video.playing ? '⏸' : '▶';
  const muteBtn = $('ambient-mute-btn');
  if (muteBtn) muteBtn.textContent = STATE.settings.ambientMuted ? '🔇' : '🔊';
}

// ── Page Builders ──────────────────────────────────────────
function buildHomePage() {
  const page = $('page-home');
  if (!page || !STATE.manifest) return;

  const featured = STATE.manifest.photos.find(p => p.featured) || STATE.manifest.photos[0];
  const heroImg = page.querySelector('.hero-photo-frame img');
  if (heroImg && featured) {
    heroImg.src = featured.file;
    heroImg.alt = 'Bubu';
    heroImg.className = '';
    heroImg.addEventListener('load', () => heroImg.classList.add('loaded'));
    heroImg.onerror = () => { heroImg.parentElement.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:4rem">💗</div>'; };
  }
}

function buildGalleryPage() {
  const page = $('page-gallery');
  if (!page || !STATE.manifest) return;

  // Build album tabs
  const tabContainer = page.querySelector('.album-tabs');
  if (tabContainer) {
    tabContainer.innerHTML = '';
    const allTab = el('button', 'album-tab active', '🌸 All');
    allTab.dataset.album = 'all';
    allTab.addEventListener('click', () => filterByAlbum('all'));
    tabContainer.appendChild(allTab);

    STATE.manifest.albums.filter(a => a.id !== 'clips').forEach(album => {
      const tab = el('button', 'album-tab', album.name);
      tab.dataset.album = album.id;
      tab.addEventListener('click', () => filterByAlbum(album.id));
      tabContainer.appendChild(tab);
    });
  }

  // Build photo grid
  buildPhotoGrid(STATE.manifest.photos);

  // Init slideshow
  initSlideshow();
}

function buildPhotoGrid(photos) {
  const grid = document.querySelector('#page-gallery .photo-grid');
  if (!grid) return;
  grid.innerHTML = '';

  photos.forEach((photo, idx) => {
    const thumb = el('div', 'photo-thumb');
    thumb.dataset.index = idx;
    thumb.dataset.file = photo.file;

    const placeholder = el('div', 'img-placeholder', '🌸');
    thumb.appendChild(placeholder);

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = photo.caption || 'Bubu';
    img.src = photo.file;
    img.addEventListener('load', () => {
      img.classList.add('loaded');
      placeholder.style.display = 'none';
    });
    img.onerror = () => { placeholder.textContent = '🌸'; };

    if (photo.favorite) {
      const badge = el('span', 'heart-badge', '💗');
      thumb.appendChild(badge);
    }

    thumb.appendChild(img);
    thumb.addEventListener('click', () => openLightbox(idx, photos));
    grid.appendChild(thumb);
  });
}

function filterByAlbum(albumId) {
  STATE.currentAlbum = albumId;
  document.querySelectorAll('.album-tab').forEach(t => t.classList.toggle('active', t.dataset.album === albumId));
  const photos = albumId === 'all' ? STATE.manifest.photos : STATE.manifest.photos.filter(p => p.album === albumId);
  buildPhotoGrid(photos);
}

// ── Slideshow ──────────────────────────────────────────────
function initSlideshow() {
  if (!STATE.manifest) return;
  let photos = STATE.manifest.photos;
  if (STATE.settings.slideshowFavoritesOnly) photos = photos.filter(p => p.favorite);
  if (STATE.settings.slideshowShuffle) photos = shuffle(photos);
  STATE.slideshow.photos = photos;
  STATE.slideshow.index = 0;
  renderSlideshowFrame();
  if (STATE.settings.slideshowAuto) startSlideshowTimer();
}

function renderSlideshowFrame() {
  const player = document.querySelector('.slideshow-player');
  if (!player || STATE.slideshow.photos.length === 0) return;

  const photos = STATE.slideshow.photos;
  const idx = STATE.slideshow.index;
  const photo = photos[idx];

  // Clear old slides
  const existing = player.querySelectorAll('.slide-img');
  existing.forEach(s => s.classList.remove('active'));

  let slide = player.querySelector(`.slide-img[data-idx="${idx}"]`);
  if (!slide) {
    slide = document.createElement('img');
    slide.className = 'slide-img';
    slide.dataset.idx = idx;
    slide.src = photo.file;
    slide.alt = photo.caption || '';
    slide.loading = idx === 0 ? 'eager' : 'lazy';
    player.insertBefore(slide, player.querySelector('.slideshow-caption'));
  }
  requestAnimationFrame(() => slide.classList.add('active'));

  const caption = player.querySelector('.slideshow-caption');
  if (caption) caption.textContent = photo.caption || '';

  // Update dots
  const dotsContainer = document.querySelector('.slideshow-indicators');
  if (dotsContainer) {
    dotsContainer.querySelectorAll('.slideshow-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
  }

  // Preload next
  const nextIdx = (idx + 1) % photos.length;
  if (photos[nextIdx]) {
    const preImg = new Image();
    preImg.src = photos[nextIdx].file;
  }
}

function startSlideshowTimer() {
  clearInterval(STATE.slideshow.timer);
  STATE.slideshow.paused = false;
  const speed = STATE.settings.slideshowSpeed || 5000;
  STATE.slideshow.timer = setInterval(() => {
    if (!document.hidden && !STATE.slideshow.paused) {
      nextSlide();
    }
  }, speed);
}

function pauseSlideshow() {
  STATE.slideshow.paused = true;
  clearInterval(STATE.slideshow.timer);
}

function resumeSlideshow() {
  if (STATE.settings.slideshowAuto) startSlideshowTimer();
}

function nextSlide() {
  STATE.slideshow.index = (STATE.slideshow.index + 1) % STATE.slideshow.photos.length;
  renderSlideshowFrame();
}

function prevSlide() {
  STATE.slideshow.index = (STATE.slideshow.index - 1 + STATE.slideshow.photos.length) % STATE.slideshow.photos.length;
  renderSlideshowFrame();
}

// ── Videos Page ────────────────────────────────────────────
function buildVideosPage() {
  const page = $('page-videos');
  if (!page || !STATE.manifest) return;

  const list = page.querySelector('.video-thumb-list');
  if (!list) return;
  list.innerHTML = '';

  // Featured video player
  const playerWrapper = page.querySelector('.video-player-wrapper');

  const videos = STATE.manifest.videos.slice(0, 30); // Show first 30
  videos.forEach((video, idx) => {
    const item = el('div', 'video-thumb-item');
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');

    const placeholder = el('div', 'img-placeholder', '🎬');
    item.appendChild(placeholder);

    const overlay = el('div', 'play-overlay', '▶');
    item.appendChild(overlay);

    const label = el('div', 'video-title-label');
    label.textContent = video.title || video.file;
    item.appendChild(label);

    if (video.favorite) {
      const badge = el('span', 'heart-badge', '💗');
      item.appendChild(badge);
    }

    item.addEventListener('click', () => openVideoPlayer(video, playerWrapper));
    list.appendChild(item);
  });
}

function openVideoPlayer(video, wrapper) {
  if (!wrapper) return;
  let videoEl = wrapper.querySelector('video');
  if (!videoEl) {
    videoEl = document.createElement('video');
    videoEl.controls = false;
    videoEl.playsInline = true;
    videoEl.setAttribute('playsinline', '');
    wrapper.prepend(videoEl);
    initVideoControls(wrapper, videoEl);
  }

  videoEl.src = video.file;
  videoEl.load();
  videoEl.play().catch(() => {
    wrapper.classList.add('show-controls');
  });
  wrapper.classList.add('show-controls');

  // Update title
  const titleEl = wrapper.closest('.page-content')?.querySelector('.now-playing-title');
  if (titleEl) titleEl.textContent = video.title || video.file;
}

function initVideoControls(wrapper, videoEl) {
  const bar = wrapper.querySelector('.video-controls-bar');
  if (!bar) return;

  const playBtn = bar.querySelector('.video-play-btn');
  const muteBtn = bar.querySelector('.video-mute-btn');
  const progress = bar.querySelector('.video-progress');
  const fill = bar.querySelector('.video-progress-fill');

  if (playBtn) {
    playBtn.addEventListener('click', () => {
      if (videoEl.paused) videoEl.play();
      else videoEl.pause();
      playBtn.textContent = videoEl.paused ? '▶' : '⏸';
    });
  }

  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      videoEl.muted = !videoEl.muted;
      muteBtn.textContent = videoEl.muted ? '🔇' : '🔊';
    });
  }

  if (progress && fill) {
    videoEl.addEventListener('timeupdate', () => {
      if (videoEl.duration) {
        fill.style.width = (videoEl.currentTime / videoEl.duration * 100) + '%';
      }
    });
    progress.addEventListener('click', e => {
      const r = progress.getBoundingClientRect();
      const pct = (e.clientX - r.left) / r.width;
      videoEl.currentTime = pct * videoEl.duration;
    });
  }

  videoEl.addEventListener('play', () => { if (playBtn) playBtn.textContent = '⏸'; });
  videoEl.addEventListener('pause', () => { if (playBtn) playBtn.textContent = '▶'; });
  videoEl.addEventListener('ended', () => { if (playBtn) playBtn.textContent = '▶'; });

  // Auto-hide controls
  let hideTimer;
  const showControls = () => {
    wrapper.classList.add('show-controls');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => wrapper.classList.remove('show-controls'), 3000);
  };
  wrapper.addEventListener('click', showControls);
  wrapper.addEventListener('mousemove', showControls);
}

// ── Love Letters ───────────────────────────────────────────
function buildLettersPage() {
  const page = $('page-letters');
  if (!page || !STATE.manifest) return;

  const container = page.querySelector('.letters-grid');
  if (!container) return;
  container.innerHTML = '';

  STATE.manifest.loveLetters.forEach(letter => {
    const env = el('div', 'letter-envelope');
    env.innerHTML = `
      <div class="letter-envelope-inner">
        <span class="letter-icon">💌</span>
        <div class="letter-title">${letter.title}</div>
        <p class="letter-preview">${letter.content.slice(0, 80)}...</p>
        <span class="letter-sealed-badge">💗 Tap to open</span>
      </div>
    `;
    env.addEventListener('click', () => openLetter(letter));
    container.appendChild(env);
  });
}

function openLetter(letter) {
  const overlay = $('letter-modal');
  if (!overlay) return;
  const titleEl = overlay.querySelector('.letter-content-title');
  const bodyEl = overlay.querySelector('.letter-body');
  if (titleEl) titleEl.textContent = letter.title;
  if (bodyEl) bodyEl.textContent = letter.content;
  overlay.classList.add('open');
  launchConfetti(20);
}

// ── Mystery Gifts ──────────────────────────────────────────
function buildMorePage() {
  const page = $('page-more');
  if (!page || !STATE.manifest) return;

  // Gifts
  const giftGrid = page.querySelector('.gift-grid');
  if (giftGrid) {
    giftGrid.innerHTML = '';
    STATE.manifest.mysteryGifts.forEach(gift => {
      const box = el('div', 'gift-box');
      box.id = 'gift-' + gift.id;
      box.innerHTML = `
        <span class="gift-icon">${gift.icon}</span>
        <div class="gift-label">${gift.title}</div>
        <div class="gift-reveal">${gift.description}</div>
      `;
      box.addEventListener('click', () => openGift(gift.id, box));
      giftGrid.appendChild(box);
    });
  }

  // Schedule
  const timeline = page.querySelector('.timeline');
  if (timeline) {
    timeline.innerHTML = '';
    STATE.manifest.birthdaySchedule.forEach(item => {
      const ti = el('div', 'timeline-item');
      ti.innerHTML = `
        <div class="timeline-time">${item.emoji} ${item.time}</div>
        <div class="timeline-title">${item.title}</div>
        <div class="timeline-desc">${item.description}</div>
      `;
      timeline.appendChild(ti);
    });
  }
}

function openGift(id, box) {
  if (STATE.gifts.has(id)) return;
  STATE.gifts.add(id);
  box.classList.add('opened');
  const reveal = box.querySelector('.gift-reveal');
  if (reveal) reveal.style.display = 'block';
  launchConfetti(30);
}

// ── Games ──────────────────────────────────────────────────
const MEMORY_EMOJIS = ['💗', '🌸', '💖', '🎀', '💝', '✨', '🦋', '🌷'];

function buildGamesPage() {
  // Games are rendered inline in HTML, just init them
}

function startMemoryGame() {
  const board = $('memory-game-board');
  if (!board) return;

  STATE.memory.cards = shuffle([...MEMORY_EMOJIS, ...MEMORY_EMOJIS]);
  STATE.memory.flipped = [];
  STATE.memory.matches = 0;
  STATE.memory.locked = false;
  STATE.memory.moves = 0;
  STATE.memory.elapsed = 0;

  board.innerHTML = '';

  STATE.memory.cards.forEach((emoji, i) => {
    const card = el('div', 'memory-card');
    card.dataset.index = i;
    card.innerHTML = `<div class="memory-front">❓</div><div class="memory-back">${emoji}</div>`;
    card.addEventListener('click', () => flipMemoryCard(card, emoji));
    board.appendChild(card);
  });

  // Timer
  clearInterval(STATE.memory.timer);
  STATE.memory.timer = setInterval(() => {
    STATE.memory.elapsed++;
    const timerEl = $('memory-timer');
    if (timerEl) timerEl.textContent = STATE.memory.elapsed + 's';
  }, 1000);

  updateMemoryStats();
}

function flipMemoryCard(card, emoji) {
  if (STATE.memory.locked) return;
  if (card.classList.contains('flipped') || card.classList.contains('matched')) return;

  card.classList.add('flipped');
  STATE.memory.flipped.push({ card, emoji });

  if (STATE.memory.flipped.length === 2) {
    STATE.memory.moves++;
    STATE.memory.locked = true;
    const [a, b] = STATE.memory.flipped;

    if (a.emoji === b.emoji) {
      a.card.classList.add('matched');
      b.card.classList.add('matched');
      STATE.memory.matches++;
      STATE.memory.flipped = [];
      STATE.memory.locked = false;
      updateMemoryStats();

      if (STATE.memory.matches === MEMORY_EMOJIS.length) {
        clearInterval(STATE.memory.timer);
        setTimeout(() => {
          launchConfetti(80);
          alert(`You won! ${STATE.memory.moves} moves in ${STATE.memory.elapsed}s 💗`);
        }, 400);
      }
    } else {
      setTimeout(() => {
        a.card.classList.remove('flipped');
        b.card.classList.remove('flipped');
        STATE.memory.flipped = [];
        STATE.memory.locked = false;
      }, 900);
    }
  }
}

function updateMemoryStats() {
  const movesEl = $('memory-moves');
  const matchesEl = $('memory-matches');
  if (movesEl) movesEl.textContent = STATE.memory.moves;
  if (matchesEl) matchesEl.textContent = STATE.memory.matches + '/' + MEMORY_EMOJIS.length;
}

const QUIZ_DATA = [
  { q: 'What is the passcode of this website?', opts: ['1910', '1710', '2801', '1017'], correct: 1 },
  { q: 'What does "Bubu" mean to me?', opts: ['A nickname', 'My whole world', 'My favorite person', 'All of the above 💗'], correct: 3 },
  { q: 'How much do I love you?', opts: ['A lot', 'Very much', 'More than words', 'To infinity and beyond 💕'], correct: 3 },
  { q: 'What is the color of your smile?', opts: ['Pink', 'Golden', 'Sunshine', 'It is its own color 🌸'], correct: 3 },
  { q: 'What makes you special?', opts: ['Your laugh', 'Your kindness', 'Your whole being', 'Absolutely everything 💝'], correct: 3 },
];

function startQuiz() {
  STATE.quiz.qIndex = 0;
  STATE.quiz.score = 0;
  renderQuizQuestion();
}

function renderQuizQuestion() {
  const container = $('quiz-container');
  if (!container) return;

  if (STATE.quiz.qIndex >= QUIZ_DATA.length) {
    container.innerHTML = `
      <div class="text-center" style="padding:24px">
        <div style="font-size:3rem;margin-bottom:16px">🎉</div>
        <div class="quiz-question">You scored ${STATE.quiz.score}/${QUIZ_DATA.length}!</div>
        <p style="color:var(--text-muted);margin:12px 0 24px">You know us so well 💗</p>
        <button class="btn-primary" onclick="startQuiz()">Play Again</button>
      </div>
    `;
    if (STATE.quiz.score === QUIZ_DATA.length) launchConfetti(60);
    return;
  }

  const q = QUIZ_DATA[STATE.quiz.qIndex];
  container.innerHTML = `
    <div style="text-align:center;margin-bottom:8px;color:var(--text-muted);font-size:.85rem">Question ${STATE.quiz.qIndex + 1} of ${QUIZ_DATA.length}</div>
    <div class="quiz-question">${q.q}</div>
    <div class="quiz-options">
      ${q.opts.map((opt, i) => `<button class="quiz-option" data-idx="${i}">${opt}</button>`).join('')}
    </div>
  `;

  container.querySelectorAll('.quiz-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const chosen = parseInt(btn.dataset.idx);
      const correct = q.correct;
      container.querySelectorAll('.quiz-option').forEach(b => b.disabled = true);
      if (chosen === correct) {
        btn.classList.add('correct');
        STATE.quiz.score++;
        launchConfetti(15);
      } else {
        btn.classList.add('wrong');
        container.querySelectorAll('.quiz-option')[correct]?.classList.add('correct');
      }
      setTimeout(() => {
        STATE.quiz.qIndex++;
        renderQuizQuestion();
      }, 1200);
    });
  });
}

// ── Lightbox ───────────────────────────────────────────────
function openLightbox(idx, photos) {
  STATE.lightbox.open = true;
  STATE.lightbox.photos = photos;
  STATE.lightbox.index = idx;
  renderLightbox();
  $('lightbox')?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  STATE.lightbox.open = false;
  $('lightbox')?.classList.remove('open');
  document.body.style.overflow = '';
}

function renderLightbox() {
  const lb = $('lightbox');
  if (!lb) return;
  const photo = STATE.lightbox.photos[STATE.lightbox.index];
  if (!photo) return;

  const img = lb.querySelector('.lightbox-img');
  const caption = lb.querySelector('.lightbox-caption');
  if (img) {
    img.src = photo.file;
    img.alt = photo.caption || '';
  }
  if (caption) caption.textContent = photo.caption || '';
}

function lightboxNext() {
  const { photos } = STATE.lightbox;
  STATE.lightbox.index = (STATE.lightbox.index + 1) % photos.length;
  renderLightbox();
}

function lightboxPrev() {
  const { photos } = STATE.lightbox;
  STATE.lightbox.index = (STATE.lightbox.index - 1 + photos.length) % photos.length;
  renderLightbox();
}

// ── Confetti ───────────────────────────────────────────────
const CONFETTI_COLORS = ['#ff85b5', '#ff5c9b', '#c084fc', '#fb7185', '#ffd6e8', '#ffb7c5', '#dab3ff', '#ffffff'];

function launchConfetti(count = 40) {
  if (STATE.settings.reducedMotion) return;
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const p = el('div', 'confetti-particle');
      p.style.cssText = `
        left:${Math.random() * 100}vw;
        top:0;
        width:${Math.random() * 8 + 4}px;
        height:${Math.random() * 8 + 4}px;
        background:${CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]};
        animation-duration:${Math.random() * 2 + 1.5}s;
        border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
      `;
      document.body.appendChild(p);
      p.addEventListener('animationend', () => p.remove());
    }, i * 40);
  }
}

// ── Music Player ───────────────────────────────────────────
let musicEl = null;

function initMusicPlayer() {
  musicEl = document.createElement('audio');
  musicEl.loop = true;
  musicEl.volume = STATE.settings.musicVolume;
  // musicEl.src = 'assets/audio/bgm.mp3'; // Uncomment and add audio file

  const playBtn = document.querySelector('.music-play-btn');
  const muteBtn = document.querySelector('.music-mute-btn');
  const noteIcon = document.querySelector('.music-note-icon');

  if (playBtn) {
    playBtn.addEventListener('click', () => {
      if (!STATE.settings.musicEnabled) {
        STATE.settings.musicEnabled = true;
        musicEl.play().then(() => {
          if (noteIcon) noteIcon.classList.add('playing');
          playBtn.textContent = '⏸';
        }).catch(() => {
          STATE.settings.musicEnabled = false;
        });
      } else {
        STATE.settings.musicEnabled = false;
        musicEl.pause();
        if (noteIcon) noteIcon.classList.remove('playing');
        playBtn.textContent = '▶';
      }
      saveSettings();
      updateSettingsUI();
    });
  }

  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      musicEl.muted = !musicEl.muted;
      muteBtn.textContent = musicEl.muted ? '🔇' : '🔊';
    });
  }
}

// ── Settings Panel ─────────────────────────────────────────
function initSettings() {
  const panel = $('settings-panel');
  const overlay = $('settings-overlay');

  const openBtn = document.querySelector('.settings-open-btn');
  if (openBtn) openBtn.addEventListener('click', () => {
    panel?.classList.add('open');
    overlay?.classList.add('open');
    renderPhotoManagerList();
  });

  const closeBtn = document.querySelector('.settings-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', closeSettings);
  if (overlay) overlay.addEventListener('click', closeSettings);

  bindSettingToggle('setting-ambient', 'ambientVideoEnabled', () => {
    if (STATE.settings.ambientVideoEnabled) startAmbientVideo();
    else pauseAmbientVideo();
  });
  bindSettingToggle('setting-ambient-loop', 'ambientLoopPlaylist');
  bindSettingToggle('setting-ambient-shuffle', 'ambientShuffle');
  bindSettingToggle('setting-ambient-muted', 'ambientMuted', () => {
    if (STATE.video.element) STATE.video.element.muted = STATE.settings.ambientMuted;
    updateAmbientUI();
  });
  bindSettingToggle('setting-ambient-pause-hidden', 'ambientPauseHidden');
  bindSettingToggle('setting-ambient-low-bw', 'ambientLowBandwidth');
  bindSettingToggle('setting-slideshow-auto', 'slideshowAuto', () => {
    if (STATE.settings.slideshowAuto) resumeSlideshow();
    else pauseSlideshow();
  });
  bindSettingToggle('setting-slideshow-shuffle', 'slideshowShuffle', () => initSlideshow());
  bindSettingToggle('setting-slideshow-favorites', 'slideshowFavoritesOnly', () => initSlideshow());
  bindSettingToggle('setting-hearts', 'floatingHeartsEnabled', () => {
    if (STATE.settings.floatingHeartsEnabled) startFloatingHearts();
    else stopFloatingHearts();
  });
  bindSettingToggle('setting-polaroids', 'floatingPhotosEnabled', () => {
    if (STATE.settings.floatingPhotosEnabled) startFloatingPolaroids();
    else document.querySelectorAll('.floating-polaroid').forEach(p => p.remove());
  });
  bindSettingToggle('setting-animated-bg', 'animatedBgEnabled', () => {
    if (STATE.settings.animatedBgEnabled) { stopCanvas(); animateCanvas(); }
    else stopCanvas();
  });
  bindSettingToggle('setting-reduced-motion', 'reducedMotion', () => {
    document.body.classList.toggle('reduced-motion', STATE.settings.reducedMotion);
    if (STATE.settings.reducedMotion) { stopFloatingHearts(); stopCanvas(); }
    else { startFloatingHearts(); animateCanvas(); }
  });
  bindSettingToggle('setting-music', 'musicEnabled');

  // Speed slider
  const speedSlider = $('setting-slideshow-speed');
  if (speedSlider) {
    speedSlider.value = STATE.settings.slideshowSpeed / 1000;
    speedSlider.addEventListener('input', () => {
      STATE.settings.slideshowSpeed = speedSlider.value * 1000;
      saveSettings();
      if (STATE.settings.slideshowAuto) resumeSlideshow();
    });
  }

  // Volume slider
  const volSlider = $('setting-music-volume');
  if (volSlider) {
    volSlider.value = STATE.settings.musicVolume;
    volSlider.addEventListener('input', () => {
      STATE.settings.musicVolume = parseFloat(volSlider.value);
      if (musicEl) musicEl.volume = STATE.settings.musicVolume;
      saveSettings();
    });
  }

  updateSettingsUI();
  initPhotoManager();
}

function bindSettingToggle(id, key, callback) {
  const el = $(id);
  if (!el) return;
  el.checked = STATE.settings[key];
  el.addEventListener('change', () => {
    STATE.settings[key] = el.checked;
    saveSettings();
    callback && callback();
    updateSettingsUI();
  });
}

function updateSettingsUI() {
  // Sync all toggles
  Object.entries(STATE.settings).forEach(([key, val]) => {
    const snake = 'setting-' + key.replace(/([A-Z])/g, m => '-' + m.toLowerCase());
    const el = document.getElementById(snake);
    if (el && el.type === 'checkbox') el.checked = val;
  });
}

function closeSettings() {
  $('settings-panel')?.classList.remove('open');
  $('settings-overlay')?.classList.remove('open');
}

// ── Photo Manager (Permanent Add / Delete) ───────────────────
let pendingPhotoData = null; // { filename, base64 }

function initPhotoManager() {
  const dropzone = $('photo-dropzone');
  const fileInput = $('photo-file-input');
  const previewImg = $('photo-upload-preview');
  const placeholder = $('photo-preview-placeholder');
  const btnUpload = $('btn-upload-photo');
  const statusEl = $('photo-upload-status');
  const searchInput = $('photo-search-input');

  if (!dropzone || !fileInput) return;

  // File selection via click
  dropzone.addEventListener('click', (e) => {
    if (e.target.tagName !== 'INPUT') fileInput.click();
  });

  // Drag & drop
  ['dragenter', 'dragover'].forEach(ev => {
    dropzone.addEventListener(ev, e => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(ev => {
    dropzone.addEventListener(ev, e => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', e => {
    const files = e.dataTransfer?.files;
    if (files && files[0]) handlePhotoFile(files[0]);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) {
      handlePhotoFile(fileInput.files[0]);
    }
  });

  function handlePhotoFile(file) {
    if (!file.type.startsWith('image/')) {
      if (statusEl) {
        statusEl.textContent = '⚠️ Please select an image file (JPG, PNG, WebP)';
        statusEl.style.color = '#fca5a5';
      }
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      pendingPhotoData = {
        filename: file.name,
        base64: e.target.result
      };
      if (previewImg) {
        previewImg.src = e.target.result;
        previewImg.classList.remove('hidden');
      }
      if (placeholder) placeholder.classList.add('hidden');
      if (statusEl) {
        statusEl.textContent = `Selected: ${file.name} (${Math.round(file.size / 1024)} KB)`;
        statusEl.style.color = 'var(--pink-400)';
      }
    };
    reader.readAsDataURL(file);
  }

  // Upload button
  if (btnUpload) {
    btnUpload.addEventListener('click', async () => {
      if (!pendingPhotoData) {
        if (statusEl) {
          statusEl.textContent = '⚠️ Please choose or drop a photo first!';
          statusEl.style.color = '#fca5a5';
        }
        return;
      }

      const captionInput = $('photo-caption-input');
      const albumSelect = $('photo-album-select');
      const favCheck = $('photo-fav-check');

      const caption = captionInput?.value.trim() || 'My beautiful Bubu 💗';
      const album = albumSelect?.value || 'moments';
      const favorite = favCheck?.checked || false;

      btnUpload.disabled = true;
      btnUpload.innerHTML = '<span>⏳ Saving to World...</span>';

      try {
        const res = await fetch('/api/upload-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: pendingPhotoData.filename,
            data: pendingPhotoData.base64,
            caption: caption,
            album: album,
            favorite: favorite
          })
        });

        const data = await res.json();
        if (data.success && data.photo) {
          // Add to current in-memory manifest
          if (!STATE.manifest) STATE.manifest = { photos: [] };
          STATE.manifest.photos.unshift(data.photo);

          // Update Gallery & Slideshow in real time
          if (STATE.currentPage === 'gallery') {
            filterByAlbum(STATE.currentAlbum || 'all');
          } else {
            buildPhotoGrid(STATE.manifest.photos);
          }
          initSlideshow();
          renderPhotoManagerList();

          // Reset upload UI
          pendingPhotoData = null;
          fileInput.value = '';
          if (previewImg) {
            previewImg.src = '';
            previewImg.classList.add('hidden');
          }
          if (placeholder) placeholder.classList.remove('hidden');
          if (captionInput) captionInput.value = '';
          if (favCheck) favCheck.checked = false;

          if (statusEl) {
            statusEl.textContent = `✅ Photo permanently added to ${album}! 🌸`;
            statusEl.style.color = '#86efac';
          }
          launchConfetti(40);
        } else {
          throw new Error(data.error || 'Server rejected photo');
        }
      } catch (err) {
        console.error('Upload error:', err);
        if (statusEl) {
          statusEl.textContent = `❌ Error: ${err.message}`;
          statusEl.style.color = '#fca5a5';
        }
      } finally {
        btnUpload.disabled = false;
        btnUpload.innerHTML = '<span>➕ Permanently Add Photo</span>';
      }
    });
  }

  // Search filter
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderPhotoManagerList(searchInput.value.trim().toLowerCase());
    });
  }

  // Initial render of existing photos
  renderPhotoManagerList();
}

function renderPhotoManagerList(filter = '') {
  const container = $('photo-manager-list');
  const countEl = $('photo-manager-count');
  if (!container) return;

  if (!STATE.manifest || !STATE.manifest.photos) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:.8rem;padding:8px">No photos found.</div>';
    if (countEl) countEl.textContent = '0';
    return;
  }

  let photos = STATE.manifest.photos;
  if (countEl) countEl.textContent = photos.length;

  if (filter) {
    photos = photos.filter(p => 
      (p.caption && p.caption.toLowerCase().includes(filter)) ||
      (p.file && p.file.toLowerCase().includes(filter)) ||
      (p.album && p.album.toLowerCase().includes(filter))
    );
  }

  if (photos.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:.8rem;padding:12px;text-align:center">No matching photos found.</div>';
    return;
  }

  container.innerHTML = '';
  photos.forEach(photo => {
    const item = el('div', 'photo-manager-item');
    item.dataset.file = photo.file;

    const img = document.createElement('img');
    img.className = 'photo-manager-thumb';
    img.src = photo.file;
    img.alt = photo.caption || photo.file;
    img.loading = 'lazy';
    item.appendChild(img);

    const info = el('div', 'photo-manager-info');
    const cap = el('div', 'photo-manager-caption', (photo.favorite ? '💗 ' : '') + (photo.caption || photo.file));
    const meta = el('div', 'photo-manager-meta');
    meta.innerHTML = `<span class="tag" style="padding:1px 6px;font-size:.65rem">${photo.album || 'moments'}</span> <span style="font-family:monospace">${photo.file}</span>`;
    info.appendChild(cap);
    info.appendChild(meta);
    item.appendChild(info);

    const delBtn = el('button', 'btn-delete-photo', '🗑️ Delete');
    delBtn.title = `Permanently delete ${photo.file}`;
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const confirmed = confirm(`Are you sure you want to permanently delete this photo?\n\n"${photo.caption || photo.file}"\nFile: ${photo.file}`);
      if (!confirmed) return;

      delBtn.disabled = true;
      delBtn.textContent = 'Deleting...';

      try {
        const res = await fetch('/api/delete-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file: photo.file })
        });
        const data = await res.json();
        if (data.success) {
          // Remove from manifest in memory
          STATE.manifest.photos = STATE.manifest.photos.filter(p => p.file !== photo.file);

          // Update gallery and slideshow
          if (STATE.currentPage === 'gallery') {
            filterByAlbum(STATE.currentAlbum || 'all');
          } else {
            buildPhotoGrid(STATE.manifest.photos);
          }
          initSlideshow();
          renderPhotoManagerList($('photo-search-input')?.value.trim().toLowerCase() || '');

          const statusEl = $('photo-upload-status');
          if (statusEl) {
            statusEl.textContent = `🗑️ Photo ${photo.file} permanently deleted.`;
            statusEl.style.color = '#fca5a5';
          }
        } else {
          alert('Failed to delete photo: ' + (data.error || 'Unknown error'));
          delBtn.disabled = false;
          delBtn.textContent = '🗑️ Delete';
        }
      } catch (err) {
        console.error('Delete error:', err);
        alert('Error deleting photo: ' + err.message);
        delBtn.disabled = false;
        delBtn.textContent = '🗑️ Delete';
      }
    });

    item.appendChild(delBtn);
    container.appendChild(item);
  });
}

// ── Visibility Change ──────────────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (document.hidden && STATE.settings.ambientPauseHidden) {
    pauseAmbientVideo();
    pauseSlideshow();
  } else if (!document.hidden) {
    if (STATE.settings.ambientVideoEnabled) resumeAmbientVideo();
    if (STATE.settings.slideshowAuto) resumeSlideshow();
  }
});

// ── Keyboard Navigation ────────────────────────────────────
document.addEventListener('keydown', e => {
  if (!STATE.unlocked) return;
  if (STATE.lightbox.open) {
    if (e.key === 'ArrowRight') lightboxNext();
    if (e.key === 'ArrowLeft') lightboxPrev();
    if (e.key === 'Escape') closeLightbox();
  }
  if (e.key === 'Escape') closeSettings();
});

// ── Touch Swipe for Lightbox ──────────────────────────────
let touchStartX = 0;
document.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
document.addEventListener('touchend', e => {
  if (!STATE.lightbox.open) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(dx) > 50) {
    if (dx < 0) lightboxNext();
    else lightboxPrev();
  }
}, { passive: true });

// ── Boot Sequence ──────────────────────────────────────────
async function boot() {
  loadSettings();

  // Apply reduced motion immediately
  if (STATE.settings.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    STATE.settings.reducedMotion = true;
    document.body.classList.add('reduced-motion');
  }

  // Show lock screen immediately
  const lockScreen = $('lock-screen');
  if (lockScreen) lockScreen.classList.add('active');

  // Init canvas background
  initCanvas();

  // Start hearts
  if (STATE.settings.floatingHeartsEnabled && !STATE.settings.reducedMotion) {
    startFloatingHearts();
  }

  // Init lock screen
  initLockScreen();

  // Init navigation
  initNavigation();

  // Init music player
  initMusicPlayer();

  // Init settings panel
  initSettings();

  // Load manifest in background while user sees lock screen
  const manifest = await loadManifest();

  // Start background preloading immediately (while user enters pin)
  scheduleBackgroundPreload(manifest);

  // Check if previously visited (skip passcode for dev - remove in production)
  // if (localStorage.getItem('bubu_visited') === '1') unlockSite();
}

// Start the app
document.addEventListener('DOMContentLoaded', boot);
