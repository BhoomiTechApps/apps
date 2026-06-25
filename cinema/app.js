let ytPlayer = null;
let pollTimer = null;
let curtainVeiling = false;
let curtainOpenTimer = null;
let hasOpenedOnce = false;
let pendingVideoId = null;

// ── YouTube IFrame API ──
function loadYTApi() {
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
}
loadYTApi();

window.onYouTubeIframeAPIReady = function () {
  ytPlayer = new YT.Player('yt-player', {
    height: '100%', width: '100%',
    playerVars: { autoplay: 0, controls: 1, modestbranding: 1, rel: 0, iv_load_policy: 3 },
    events: { onReady: onPlayerReady, onStateChange: onPlayerState }
  });
};

function onPlayerReady() {
  if (pendingVideoId) {
    ytPlayer.loadVideoById(pendingVideoId);
    pendingVideoId = null;
  }
}

function onPlayerState(e) {
  const S = YT.PlayerState;
  if (e.data === S.PLAYING) onVideoPlay();
  else if (e.data === S.PAUSED) onVideoPause();
  else if (e.data === S.ENDED) onVideoEnded();
}

// ── Playback lifecycle ──
function onVideoPlay() {
  dimTheatre(true);
  clearInterval(pollTimer);
  pollTimer = setInterval(checkNearEnd, 1000);

  if (curtainVeiling) return;

  const c = document.getElementById('curtain');
  clearTimeout(curtainOpenTimer);

  if (!hasOpenedOnce) {
    curtainOpenTimer = setTimeout(() => {
      if (curtainVeiling) return;
      hasOpenedOnce = true;
      c.className = 'unveiling';
      curtainOpenTimer = setTimeout(() => { if (!curtainVeiling) c.className = 'open'; }, 15200);
    }, 5000);
  } else if (c.className !== 'open' && c.className !== 'unveiling') {
    c.className = 'unveiling';
    curtainOpenTimer = setTimeout(() => { if (!curtainVeiling) c.className = 'open'; }, 15200);
  }
}

function onVideoPause() {
  dimTheatre(false);
  clearInterval(pollTimer);
  if (curtainVeiling) return;
  clearTimeout(curtainOpenTimer);
  document.getElementById('curtain').className = 'veiling';
}

function onVideoEnded() {
  dimTheatre(false);
  clearInterval(pollTimer);
  curtainVeiling = true;
  clearTimeout(curtainOpenTimer);
  document.getElementById('curtain').className = 'veiling';
}

function checkNearEnd() {
  if (!ytPlayer || typeof ytPlayer.getDuration !== 'function') return;
  const dur = ytPlayer.getDuration();
  const cur = ytPlayer.getCurrentTime();
  if (dur > 0 && (dur - cur) <= 30 && !curtainVeiling) {
    curtainVeiling = true;
    clearTimeout(curtainOpenTimer);
    document.getElementById('curtain').className = 'veiling';
    dimTheatre(false);
    toast('Lights coming up…');
  }
  if (dur > 0 && cur >= dur) clearInterval(pollTimer);
}

// ── Theatre atmosphere ──
function dimTheatre(dim) {
  const overlay = document.getElementById('theatre-dim');
  const spots = document.querySelectorAll('.spotlight');
  if (dim) {
    overlay.classList.add('dimmed');
    spots.forEach(s => s.classList.add('dim'));
  } else {
    overlay.classList.remove('dimmed');
    spots.forEach(s => s.classList.remove('dim'));
  }
}

// ── Video ID extraction ──
function extractId(input) {
  input = input.trim();
  const pats = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of pats) { const m = input.match(p); if (m) return m[1]; }
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  return null;
}

// ── Load video ──
function loadVideo() {
  const vid = extractId(document.getElementById('url-input').value);
  if (!vid) { toast('Paste a valid YouTube URL or ID'); return; }
  const c = document.getElementById('curtain');
  clearTimeout(curtainOpenTimer);
  c.className = '';
  curtainVeiling = false;
  hasOpenedOnce = false;
  clearInterval(pollTimer);
  if (ytPlayer && ytPlayer.loadVideoById) {
    ytPlayer.loadVideoById(vid);
    toast('Loading…');
  } else {
    pendingVideoId = vid;
    toast('Loading…');
  }
}

// ── Event listeners ──
document.getElementById('play-btn').addEventListener('click', loadVideo);
document.getElementById('url-input').addEventListener('keydown', e => { if (e.key === 'Enter') loadVideo(); });
document.getElementById('full-btn').addEventListener('click', () => {
  const el = document.getElementById('stage');
  if (!document.fullscreenElement) el.requestFullscreen && el.requestFullscreen();
  else document.exitFullscreen && document.exitFullscreen();
});

// ── Toast notification ──
let toastTimer = null;
function toast(msg, dur = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), dur);
}

document.getElementById('url-input').value = 'https://youtu.be/nBH9i6YKIdE?si=ffgv8lcMEsKlYzPW';
loadVideo();

// ── Service Worker ──
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
