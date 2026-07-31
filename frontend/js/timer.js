/* Paint Ya Blud - Synchronized Wall-Clock Timer */

(function () {
  let timerInterval = null;

  window.startSyncTimer = function (durationSeconds, displayId, onComplete) {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    let startTime = parseInt(sessionStorage.getItem('pyb_game_start_time') || '0', 10);
    if (!startTime || isNaN(startTime)) {
      startTime = Date.now();
      sessionStorage.setItem('pyb_game_start_time', startTime);
    }

    const endTime = startTime + (durationSeconds * 1000);

    function tick() {
      const now = Date.now();
      const remainingMs = endTime - now;
      const remainingSecs = Math.max(0, Math.ceil(remainingMs / 1000));

      const mins = Math.floor(remainingSecs / 60);
      const secs = remainingSecs % 60;
      const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

      const display = document.getElementById(displayId);
      if (display) display.innerText = formatted;

      if (remainingMs <= 0) {
        if (timerInterval) {
          clearInterval(timerInterval);
          timerInterval = null;
        }
        if (typeof onComplete === 'function') {
          onComplete();
        }
      }
    }

    tick();
    timerInterval = setInterval(tick, 250);
  };

  // Backwards compatibility alias
  window.startCountdownTimer = function (durationSeconds, displayId, onComplete) {
    window.startSyncTimer(durationSeconds, displayId, onComplete);
  };
})();
