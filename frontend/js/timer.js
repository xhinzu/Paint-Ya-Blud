/* Paint Ya Blud - Countdown Timer */

(function () {
  let timerInterval = null;

  window.startCountdownTimer = function (durationSeconds, displayId, onComplete) {
    let remaining = durationSeconds;
    const display = document.getElementById(displayId);

    function updateDisplay() {
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      if (display) display.innerText = formatted;
    }

    updateDisplay();

    timerInterval = setInterval(() => {
      remaining--;
      updateDisplay();

      if (remaining <= 0) {
        clearInterval(timerInterval);
        if (typeof onComplete === 'function') {
          onComplete();
        }
      }
    }, 1000);
  };
})();
