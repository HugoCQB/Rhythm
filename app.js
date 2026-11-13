(() => {
  // =========================================================
  // ÉTAT GLOBAL & AUDIO PARTAGÉ
  // =========================================================
  let activeMode = 'guess'; // 'guess' | 'tap'
  let audioCtx = null;
  let deferredPrompt = null;
  // Muet par défaut pour jouer sans son dès le lancement (modifiable via le bouton)
  let isMuted = localStorage.getItem('bpm_muted') !== null
    ? localStorage.getItem('bpm_muted') === 'true'
    : true;

  const muteBtn = document.getElementById('muteBtn');
  const installBtn = document.getElementById('installBtn');
  const tabGuess = document.getElementById('tabGuess');
  const tabTap = document.getElementById('tabTap');
  const viewGuess = document.getElementById('viewGuess');
  const viewTap = document.getElementById('viewTap');

  function ensureAudioCtx() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function playClick(isReference) {
    if (isMuted) return;
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

    gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.045);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.05);
  }

  function updateMuteUI() {
    if (isMuted) {
      muteBtn.classList.add('muted');
      muteBtn.textContent = '🔇 Muet';
    } else {
      muteBtn.classList.remove('muted');
      muteBtn.textContent = '🔊 Son';
    }
    updateListenBtnLabel();
  }

  muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    localStorage.setItem('bpm_muted', isMuted);
    updateMuteUI();
    muteBtn.blur();
  });

  function getRandomBPM(min = 60, max = 165) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // =========================================================
  // GESTION DU CHANGEMENT DE MODE
  // =========================================================
  function switchMode(newMode) {
    if (activeMode === newMode) return;
    activeMode = newMode;

    // Arrête les boucles actives de l'autre mode
    stopCorrectionMetronome();
    guessIsObserving = false;
    guessMetronomeOrb.classList.remove('tick');

    if (activeMode === 'guess') {
      tabGuess.classList.add('active');
      tabGuess.setAttribute('aria-selected', 'true');
      tabTap.classList.remove('active');
      tabTap.setAttribute('aria-selected', 'false');

      viewGuess.classList.remove('hidden');
      viewTap.classList.add('hidden');
      startGuessRound();
    } else {
      tabTap.classList.add('active');
      tabTap.setAttribute('aria-selected', 'true');
      tabGuess.classList.remove('active');
      tabGuess.setAttribute('aria-selected', 'false');

      viewTap.classList.remove('hidden');
      viewGuess.classList.add('hidden');
      resetTapRound(true);
    }
  }

  tabGuess.addEventListener('click', () => switchMode('guess'));
  tabTap.addEventListener('click', () => switchMode('tap'));

  // =========================================================
  // MODE 1 : DEVINER LE BPM (10s d'observation puis à l'aveugle)
  // =========================================================
  const OBSERVE_DURATION_MS = 10000;
  const TICK_VISIBLE_MS = 95;
  const MAX_GUESS_TAP_HISTORY = 8;
  const GUESS_TAP_RESET_MS = 2200;

  let guessTargetBpm = 120;
  let guessScore = 0;
  let guessRoundCompleted = false;
  let guessIsObserving = false;
  let guessStartTime = 0;
  let guessLastBeatIndex = -1;
  let guessTapTimestamps = [];

  const guessPhaseBadge = document.getElementById('guessPhaseBadge');
  const guessTotalScoreEl = document.getElementById('guessTotalScore');
  const guessMetronomeOrb = document.getElementById('guessMetronomeOrb');
  const guessOrbValue = document.getElementById('guessOrbValue');
  const guessOrbLabel = document.getElementById('guessOrbLabel');
  const guessInstruction = document.getElementById('guessInstruction');
  const guessTapBtn = document.getElementById('guessTapBtn');
  const guessTapStatus = document.getElementById('guessTapStatus');
  const guessSlider = document.getElementById('guessSlider');
  const guessInput = document.getElementById('guessInput');
  const guessConfirmBtn = document.getElementById('guessConfirmBtn');
  const guessNextBtn = document.getElementById('guessNextBtn');
  const guessFeedback = document.getElementById('guessFeedback');

  function guessLoop(now) {
    if (activeMode === 'guess' && guessIsObserving && !guessRoundCompleted) {
      const elapsed = now - guessStartTime;
      const remainingMs = Math.max(0, OBSERVE_DURATION_MS - elapsed);

      guessPhaseBadge.textContent = `Observation : ${(remainingMs / 1000).toFixed(1)}s`;

      if (remainingMs > 0) {
        const beatInterval = 60000 / guessTargetBpm;
        const currentBeatIndex = Math.floor(elapsed / beatInterval);
        const timeInsideBeat = elapsed % beatInterval;

        if (currentBeatIndex !== guessLastBeatIndex) {
          guessLastBeatIndex = currentBeatIndex;
          playClick(true);
        }

        const isTickActive = timeInsideBeat < Math.min(TICK_VISIBLE_MS, beatInterval * 0.45);
        guessMetronomeOrb.classList.toggle('tick', isTickActive);
      } else {
        stopGuessObservation();
      }
    }
    requestAnimationFrame(guessLoop);
  }

  function stopGuessObservation() {
    guessIsObserving = false;
    guessMetronomeOrb.classList.remove('tick');
    guessMetronomeOrb.classList.add('stopped');
    guessPhaseBadge.textContent = 'Métronome arrêté — À toi de jouer';
    guessPhaseBadge.classList.add('blind');
    guessInstruction.innerHTML = 'Le tempo s\'est arrêté. Continue de taper de mémoire ou ajuste le curseur, puis confirme.';
  }

  function startGuessRound() {
    guessRoundCompleted = false;
    guessTargetBpm = getRandomBPM(60, 170);
    guessTapTimestamps = [];
    guessStartTime = performance.now();
    guessLastBeatIndex = -1;
    guessIsObserving = true;

    guessMetronomeOrb.classList.remove('stopped', 'tick');
    guessPhaseBadge.classList.remove('blind');
    guessOrbValue.textContent = '?';
    guessOrbLabel.textContent = 'BPM CIBLE';
    guessFeedback.textContent = '';

    guessInstruction.innerHTML = 'Le métronome bat pendant <strong>10 secondes</strong>. Appuie sur n\'importe quelle touche pour suivre le tempo.';
    guessTapBtn.disabled = false;
    guessTapStatus.textContent = 'Tape plusieurs fois pour estimer le BPM';
    guessSlider.disabled = false;
    guessInput.disabled = false;

    guessConfirmBtn.classList.remove('hidden');
    guessNextBtn.classList.add('hidden');
  }

  function handleGuessTap() {
    if (guessRoundCompleted) return;
    const now = performance.now();

    guessTapBtn.classList.add('pressed');
    setTimeout(() => guessTapBtn.classList.remove('pressed'), 75);

    if (guessTapTimestamps.length > 0 && (now - guessTapTimestamps[guessTapTimestamps.length - 1]) > GUESS_TAP_RESET_MS) {
      guessTapTimestamps = [];
    }

    guessTapTimestamps.push(now);
    if (guessTapTimestamps.length > MAX_GUESS_TAP_HISTORY) {
      guessTapTimestamps.shift();
    }

    if (guessTapTimestamps.length === 1) {
      guessTapStatus.textContent = '1er temps enregistré — continue de taper...';
      return;
    }

    let totalInterval = 0;
    for (let i = 1; i < guessTapTimestamps.length; i++) {
      totalInterval += guessTapTimestamps[i] - guessTapTimestamps[i - 1];
    }
    const avgInterval = totalInterval / (guessTapTimestamps.length - 1);
    const estimatedBpm = Math.min(200, Math.max(40, Math.round(60000 / avgInterval)));

    guessSlider.value = estimatedBpm;
    guessInput.value = estimatedBpm;
    guessTapStatus.textContent = `Ton rythme : ~${estimatedBpm} BPM (${guessTapTimestamps.length} taps)`;
  }

  function confirmGuessRound() {
    if (guessRoundCompleted) return;
    guessRoundCompleted = true;
    guessIsObserving = false;

    const guessVal = parseInt(guessInput.value, 10) || 110;
    const diff = Math.abs(guessTargetBpm - guessVal);

    guessMetronomeOrb.classList.remove('tick', 'stopped');
    guessOrbValue.textContent = guessTargetBpm;
    guessOrbLabel.textContent = 'BPM RÉEL';
    guessPhaseBadge.textContent = 'Résultat';
    guessPhaseBadge.classList.remove('blind');

    if (diff === 0) {
      guessScore += 100;
      guessFeedback.innerHTML = `<span style="color: var(--success)">🎯 PARFAIT ! Exactement ${guessTargetBpm} BPM (+100 pts)</span>`;
    } else if (diff <= 3) {
      guessScore += 75;
      guessFeedback.innerHTML = `<span style="color: var(--success)">🔥 Très précis ! À ${diff} BPM près (${guessTargetBpm} BPM) (+75 pts)</span>`;
    } else if (diff <= 8) {
      guessScore += 40;
      guessFeedback.innerHTML = `<span style="color: var(--warning)">👍 Bien joué ! Écart de ${diff} BPM (${guessTargetBpm} BPM) (+40 pts)</span>`;
    } else {
      guessFeedback.innerHTML = `<span style="color: var(--danger)">❌ Trop loin ! C'était ${guessTargetBpm} BPM (écart de ${diff})</span>`;
    }

    guessTotalScoreEl.textContent = guessScore;
    guessTapBtn.disabled = true;
    guessSlider.disabled = true;
    guessInput.disabled = true;

    guessConfirmBtn.classList.add('hidden');
    guessNextBtn.classList.remove('hidden');
  }

  guessTapBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handleGuessTap();
  });
  guessSlider.addEventListener('input', (e) => { guessInput.value = e.target.value; });
  guessInput.addEventListener('input', (e) => { guessSlider.value = e.target.value; });
  guessConfirmBtn.addEventListener('click', confirmGuessRound);
  guessNextBtn.addEventListener('click', startGuessRound);

  // =========================================================
  // MODE 2 : PRODUIRE LE BPM (12 frappes régulières)
  // =========================================================
  const TOTAL_TAPS = 12;
  let tapTargetBPM = 100;
  let tapTimestamps = [];
  let tapIsFinished = false;
  let metronomeInterval = null;

  const tapBtn = document.getElementById('tapBtn');
  const tapRipple = document.getElementById('tapRipple');
  const targetBox = document.getElementById('targetBox');
  const targetDisplay = document.getElementById('targetDisplay');
  const progressFill = document.getElementById('progressFill');
  const statusText = document.getElementById('statusText');
  const resultsBox = document.getElementById('resultsBox');
  const listenBtn = document.getElementById('listenBtn');
  const dots = document.querySelectorAll('#beatDots .dot');

  function triggerVisualBeat(type, index) {
    dots.forEach((d) => d.classList.remove('active-tap', 'active-ref'));

    const activeDot = dots[index % dots.length];
    if (activeDot) {
      activeDot.classList.add(type === 'ref' ? 'active-ref' : 'active-tap');
    }

    if (type === 'tap') {
      tapRipple.classList.remove('animate');
      void tapRipple.offsetWidth;
      tapRipple.classList.add('animate');
    }
  }

  function clearBeatDots() {
    dots.forEach((d) => d.classList.remove('active-tap', 'active-ref'));
  }

  function updateListenBtnLabel() {
    if (metronomeInterval) {
      listenBtn.textContent = `⏹ Arrêter le métronome (${tapTargetBPM} BPM)`;
    } else {
      const icon = isMuted ? '👁️' : '👁️/🔊';
      listenBtn.textContent = `${icon} Voir le vrai tempo (${tapTargetBPM} BPM)`;
    }
  }

  function toggleCorrectionMetronome() {
    if (metronomeInterval) stopCorrectionMetronome();
    else startCorrectionMetronome();
  }

  function startCorrectionMetronome() {
    stopCorrectionMetronome();
    const intervalMs = 60000 / tapTargetBPM;
    let refStep = 0;

    listenBtn.classList.add('playing');
    updateListenBtnLabel();

    const tick = () => {
      playClick(true);
      triggerVisualBeat('ref', refStep);
      refStep++;

      targetBox.classList.add('pulse');
      setTimeout(() => {
        targetBox.classList.remove('pulse');
      }, Math.min(120, intervalMs * 0.4));
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
    clearBeatDots();
    listenBtn.classList.remove('playing');
    updateListenBtnLabel();
  }

  function registerTap() {
    if (tapIsFinished) return;

    playClick(false);
    const now = performance.now();

    if (tapTimestamps.length > 0 && now - tapTimestamps[tapTimestamps.length - 1] > 3000) {
      tapTimestamps = [];
    }

    tapTimestamps.push(now);
    const count = tapTimestamps.length;

    triggerVisualBeat('tap', count - 1);

    const pct = Math.min((count / TOTAL_TAPS) * 100, 100);
    progressFill.style.width = `${pct}%`;

    if (count < TOTAL_TAPS) {
      statusText.textContent = `Continuez régulièrement... (${count} / ${TOTAL_TAPS})`;
    } else {
      finishTapRound();
    }
  }

  function finishTapRound() {
    tapIsFinished = true;
    tapBtn.disabled = true;
    statusText.textContent = 'Terminé ! Comparez avec le vrai tempo ci-dessous.';

    const intervals = [];
    for (let i = 1; i < tapTimestamps.length; i++) {
      intervals.push(tapTimestamps[i] - tapTimestamps[i - 1]);
    }

    const targetInterval = 60000 / tapTargetBPM;
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const actualBPM = 60000 / avgInterval;

    const bpmErrorRatio = Math.abs(actualBPM - tapTargetBPM) / tapTargetBPM;
    const targetAccuracy = Math.max(0, (1 - bpmErrorRatio) * 100);

    const variance = intervals.reduce((sum, val) => sum + Math.pow(val - avgInterval, 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    const jitterRatio = stdDev / avgInterval;
    const consistency = Math.max(0, (1 - jitterRatio * 1.5) * 100);

    const globalScore = targetAccuracy * 0.6 + consistency * 0.4;

    displayTapResults(actualBPM, globalScore, consistency, intervals, targetInterval);
  }

  function displayTapResults(actualBPM, globalScore, consistency, intervals, targetInterval) {
    resultsBox.style.display = 'block';
    stopCorrectionMetronome();

    const scoreEl = document.getElementById('accuracyScore');
    const verdictEl = document.getElementById('verdictText');
    scoreEl.textContent = `${globalScore.toFixed(1)}%`;

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
      verdictEl.textContent = '😅 À côté du tempo ! Regardez le flash du vrai tempo.';
    }

    document.getElementById('userBpmVal').textContent = actualBPM.toFixed(1);
    const diff = actualBPM - tapTargetBPM;
    const diffEl = document.getElementById('diffBpmVal');
    diffEl.textContent = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}`;
    diffEl.style.color = Math.abs(diff) <= 2 ? 'var(--success)' : 'var(--warning)';

    document.getElementById('consistencyVal').textContent = `${consistency.toFixed(0)}%`;

    const barsContainer = document.getElementById('barsContainer');
    barsContainer.innerHTML = '';

    intervals.forEach((iv, idx) => {
      const bar = document.createElement('div');
      bar.className = 'bar';
      const errorPct = Math.abs(iv - targetInterval) / targetInterval;
      const heightPct = Math.max(15, Math.min(100, (1 - errorPct * 2) * 100));
      bar.style.height = `${heightPct}%`;

      if (errorPct < 0.04) bar.style.background = 'var(--success)';
      else if (errorPct < 0.1) bar.style.background = 'var(--accent)';
      else bar.style.background = 'var(--danger)';

      const tapBpm = (60000 / iv).toFixed(0);
      bar.title = `Frappe ${idx + 1} -> ${idx + 2} : ${tapBpm} BPM`;
      barsContainer.appendChild(bar);
    });
  }

  function resetTapRound(changeBpm) {
    stopCorrectionMetronome();
    tapTimestamps = [];
    tapIsFinished = false;
    tapBtn.disabled = false;
    progressFill.style.width = '0%';
    resultsBox.style.display = 'none';
    statusText.textContent = `Prêt : tapez pour démarrer (0 / ${TOTAL_TAPS})`;

    if (changeBpm) {
      let nextBpm = getRandomBPM(60, 155);
      while (nextBpm === tapTargetBPM) {
        nextBpm = getRandomBPM(60, 155);
      }
      tapTargetBPM = nextBpm;
      targetDisplay.textContent = tapTargetBPM;
    }
    updateListenBtnLabel();
  }

  function setCustomBPM() {
    const val = parseInt(document.getElementById('customBpmInput').value, 10);
    if (val >= 40 && val <= 240) {
      tapTargetBPM = val;
      targetDisplay.textContent = tapTargetBPM;
      resetTapRound(false);
    }
  }

  document.getElementById('randomBpmBtn').addEventListener('click', () => resetTapRound(true));
  document.getElementById('setBpmBtn').addEventListener('click', setCustomBPM);
  listenBtn.addEventListener('click', toggleCorrectionMetronome);
  document.getElementById('replayBtn').addEventListener('click', () => resetTapRound(false));
  document.getElementById('nextRoundBtn').addEventListener('click', () => resetTapRound(true));

  tapBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    registerTap();
  });

  // =========================================================
  // RACCOURCIS CLAVIER UNIFIÉS
  // =========================================================
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;

    // Laisse l'utilisateur saisir ses chiffres librement dans les champs <input type="number">
    if (document.activeElement && document.activeElement.tagName === 'INPUT') {
      if (e.code === 'Enter') {
        e.preventDefault();
        if (activeMode === 'tap') setCustomBPM();
        document.activeElement.blur();
      }
      return;
    }

    if (activeMode === 'guess') {
      if (e.code === 'Enter') {
        e.preventDefault();
        if (guessRoundCompleted) startGuessRound();
        else confirmGuessRound();
        return;
      }

      const ignoredKeys = [
        'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Escape',
        'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'
      ];
      if (ignoredKeys.includes(e.key)) return;

      if (!guessRoundCompleted) {
        e.preventDefault();
        handleGuessTap();
      }
    } else if (activeMode === 'tap') {
      if (e.code === 'Space') {
        e.preventDefault();
        if (!tapIsFinished) {
          tapBtn.classList.add('active');
          registerTap();
        }
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      tapBtn.classList.remove('active');
    }
  });

  // =========================================================
  // PWA (SERVICE WORKER & INSTALLATION)
  // =========================================================
  if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost')) {
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

  // =========================================================
  // INITIALISATION
  // =========================================================
  updateMuteUI();
  startGuessRound();
  requestAnimationFrame(guessLoop);
})();
