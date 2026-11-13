iconst TOTAL_TAPS = 12;
let targetBPM = 100;
let timestamps = [];
let isFinished = false;
let audioCtx = null;
let metronomeInterval = null;
let deferredPrompt = null;

// Sélecteurs DOM
const tapBtn = document.getElementById('tapBtn');
const targetBox = document.getElementById('targetBox');
const targetDisplay = document.getElementById('targetDisplay');
const progressFill = document.getElementById('progressFill');
const statusText = document.getElementById('statusText');
const resultsBox = document.getElementById('resultsBox');
const listenBtn = document.getElementById('listenBtn');
const installBtn = document.getElementById('installBtn');

function getRandomBPM() {
  return Math.floor(Math.random() * (155 - 60 + 1)) + 60;
}

function ensureAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function playClick(isReference = false) {
  ensureAudioCtx();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  if (isReference) {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.035);
  } else {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(600, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(120, audioCtx.currentTime + 0.04);
  }

  gain.gain.setValueAtTime(0.28, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.045);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.05);
}

// Métronome de correction
function toggleCorrectionMetronome() {
  if (metronomeInterval) {
    stopCorrectionMetronome();
  } else {
    startCorrectionMetronome();
  }
}

function startCorrectionMetronome() {
  stopCorrectionMetronome();
  const intervalMs = 60000 / targetBPM;

  listenBtn.classList.add('playing');
  listenBtn.innerHTML = `⏹ Arrêter l'écoute (${targetBPM} BPM)`;

  const tick = () => {
    playClick(true);
    targetBox.classList.add('pulse');
    setTimeout(() => targetBox.classList.remove('pulse'), 100);
  };

  tick();
  metronomeInterval = setInterval(tick, intervalMs);
}

function stopCorrectionMetronome() {
  if (metronomeInterval) {
    clearInterval(metronomeInterval);
    metronomeInterval = null;
  }
  targetBox.classList.remove('pulse');
  listenBtn.classList.remove('playing');
  listenBtn.innerHTML = `🔊 Écouter le vrai tempo (<span id="listenBpmLabel">${targetBPM}</span> BPM)`;
}

function registerTap() {
  if (isFinished) return;

  playClick(false);
  const now = performance.now();

  if (timestamps.length > 0 && now - timestamps[timestamps.length - 1] > 3000) {
    timestamps = [];
  }

  timestamps.push(now);
  const count = timestamps.length;

  const pct = Math.min((count / TOTAL_TAPS) * 100, 100);
  progressFill.style.width = pct + '%';

  if (count < TOTAL_TAPS) {
    statusText.textContent = `Continuez régulièrement... (${count} / ${TOTAL_TAPS})`;
  } else {
    finishRound();
  }
}

function finishRound() {
  isFinished = true;
  tapBtn.disabled = true;
  statusText.textContent = `Terminé ! Écoutez le vrai tempo ou passez au suivant.`;

  const intervals = [];
  for (let i = 1; i < timestamps.length; i++) {
    intervals.push(timestamps[i] - timestamps[i - 1]);
  }

  const targetInterval = 60000 / targetBPM;
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const actualBPM = 60000 / avgInterval;

  const bpmErrorRatio = Math.abs(actualBPM - targetBPM) / targetBPM;
  const targetAccuracy = Math.max(0, (1 - bpmErrorRatio) * 100);

  const variance = intervals.reduce((sum, val) => sum + Math.pow(val - avgInterval, 2), 0) / intervals.length;
  const stdDev = Math.sqrt(variance);
  const jitterRatio = stdDev / avgInterval;
  const consistency = Math.max(0, (1 - jitterRatio * 1.5) * 100);

  const globalScore = (targetAccuracy * 0.6 + consistency * 0.4);

  displayResults(actualBPM, globalScore, consistency, intervals, targetInterval);
}

function displayResults(actualBPM, globalScore, consistency, intervals, targetInterval) {
  resultsBox.style.display = 'block';
  stopCorrectionMetronome();

  const scoreEl = document.getElementById('accuracyScore');
  const verdictEl = document.getElementById('verdictText');
  scoreEl.textContent = globalScore.toFixed(1) + '%';

  if (globalScore >= 96) {
    scoreEl.style.color = 'var(--success)';
    verdictEl.textContent = '🎯 Métronome humain ! Précision chirurgicale.';
  } else if (globalScore >= 90) {
    scoreEl.style.color = 'var(--accent)';
    verdictEl.textContent = '🔥 Très solide ! Excellent sens du rythme.';
  } else if (globalScore >= 80) {
    scoreEl.style.color = 'var(--warning)';
    verdictEl.textContent = '👍 Pas mal, mais le tempo dérive un peu.';
  } else {
    scoreEl.style.color = 'var(--danger)';
    verdictEl.textContent = '😅 À côté du tempo ! Écoute la correction ci-dessous.';
  }

  document.getElementById('userBpmVal').textContent = actualBPM.toFixed(1);
  const diff = actualBPM - targetBPM;
  const diffEl = document.getElementById('diffBpmVal');
  diffEl.textContent = (diff >= 0 ? '+' : '') + diff.toFixed(1);
  diffEl.style.color = Math.abs(diff) <= 2 ? 'var(--success)' : 'var(--warning)';

  document.getElementById('consistencyVal').textContent = consistency.toFixed(0) + '%';

  const barsContainer = document.getElementById('barsContainer');
  barsContainer.innerHTML = '';

  intervals.forEach((iv, idx) => {
    const bar = document.createElement('div');
    bar.className = 'bar';
    const errorPct = Math.abs(iv - targetInterval) / targetInterval;
    const heightPct = Math.max(15, Math.min(100, (1 - errorPct * 2) * 100));
    bar.style.height = heightPct + '%';

    if (errorPct < 0.04) bar.style.background = 'var(--success)';
    else if (errorPct < 0.1) bar.style.background = 'var(--accent)';
    else bar.style.background = 'var(--danger)';

    const tapBpm = (60000 / iv).toFixed(0);
    bar.title = `Frappe ${idx + 1}→${idx + 2} : ${tapBpm} BPM`;
    barsContainer.appendChild(bar);
  });
}

function resetRound(changeBpm = true) {
  stopCorrectionMetronome();
  timestamps = [];
  isFinished = false;
  tapBtn.disabled = false;
  progressFill.style.width = '0%';
  resultsBox.style.display = 'none';
  statusText.textContent = `Prêt : tapez pour démarrer (0 / ${TOTAL_TAPS})`;

  if (changeBpm) {
    let nextBpm = getRandomBPM();
    while (nextBpm === targetBPM) {
      nextBpm = getRandomBPM();
    }
    targetBPM = nextBpm;
    targetDisplay.textContent = targetBPM;
  }
}

function setCustomBPM() {
  const val = parseInt(document.getElementById('customBpmInput').value, 10);
  if (val >= 40 && val <= 240) {
    targetBPM = val;
    targetDisplay.textContent = targetBPM;
    resetRound(false);
  }
}

// Écouteurs d'événements UI
document.getElementById('randomBpmBtn').addEventListener('click', () => resetRound(true));
document.getElementById('setBpmBtn').addEventListener('click', setCustomBPM);
document.getElementById('listenBtn').addEventListener('click', toggleCorrectionMetronome);
document.getElementById('replayBtn').addEventListener('click', () => resetRound(false));
document.getElementById('nextRoundBtn').addEventListener('click', () => resetRound(true));

tapBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  registerTap();
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault();
    if (!e.repeat && !isFinished) {
      tapBtn.classList.add('active');
      registerTap();
    }
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    tapBtn.classList.remove('active');
  }
});

// --- PWA : Service Worker & Installation ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service Worker non enregistré :', err);
    });
  });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
});

installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.hidden = true;
});

// Démarrage initial
resetRound(true);
