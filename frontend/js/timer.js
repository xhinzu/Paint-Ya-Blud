/* Paint Ya Blud - Synchronized Wall-Clock Timer
 *
 * Uses an absolute wall-clock startTime (passed via URL `?t=` param and stored in
 * sessionStorage as `pyb_game_start_time`) so BOTH players share the exact same countdown
 * regardless of when they opened play.html.
 *
 * If no startTime is found (solo/dev mode), falls back to right now.
 */

(function () {
  let timerInterval = null;

  window.startSyncTimer = function (durationSeconds, displayId, onComplete) {
    // Cancel any existing timer
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    // Use the canonical startTime from sessionStorage (set by host when game begins)
    let startTime = parseInt(sessionStorage.getItem('pyb_game_start_time') || '0', 10);
    if (!startTime || isNaN(startTime) || startTime <= 0) {
      // Fallback for solo/dev mode: start now
      startTime = Date.now();
      sessionStorage.setItem('pyb_game_start_time', String(startTime));
      console.warn('[Timer] No canonical startTime found, using Date.now() as fallback.');
    }

    const endTime = startTime + (durationSeconds * 1000);
    let onCompleteFired = false;

    function tick() {
      const now          = Date.now();
      const remainingMs  = endTime - now;
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
        if (!onCompleteFired && typeof onComplete === 'function') {
          onCompleteFired = true;
          onComplete();
        }
      }
    }

    // Run immediately, then every 250ms for smooth display
    tick();
    timerInterval = setInterval(tick, 250);
  };

  // Backwards compatibility alias
  window.startCountdownTimer = function (durationSeconds, displayId, onComplete) {
    window.startSyncTimer(durationSeconds, displayId, onComplete);
  };

  // Expose cleanup for page transitions
  window.stopSyncTimer = function () {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  };
})();
