/* Paint Ya Blud - Mobile Landscape Enforcer
 *
 * On touch/mobile devices:
 *  - Injects the landscape lock overlay into the DOM
 *  - Shows it when the device is in portrait orientation
 *  - Hides it immediately when rotated to landscape
 *  - Attempts screen.orientation.lock('landscape') where browser supports it
 *  - Works on iOS Safari, Android Chrome, and all modern mobile browsers
 */

(function () {
  // Only activate on touch/mobile devices
  const isMobile = (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  );

  if (!isMobile) return;

  /* ---- Inject landscape lock overlay ---- */
  function injectOverlay() {
    if (document.getElementById('landscapeLockOverlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'landscapeLockOverlay';
    overlay.innerHTML = `
      <div class="landscape-lock-icon">📱</div>
      <div class="landscape-lock-text">Rotate your phone!</div>
      <div class="landscape-lock-sub">Paint Ya Blud plays best in landscape 🎨</div>
    `;
    document.body.appendChild(overlay);
  }

  /* ---- Check orientation and show/hide overlay ---- */
  function checkOrientation() {
    const isPortrait =
      window.innerHeight > window.innerWidth ||
      (screen.orientation && screen.orientation.type.startsWith('portrait'));

    const overlay = document.getElementById('landscapeLockOverlay');
    if (!overlay) return;

    if (isPortrait) {
      overlay.classList.add('visible');
    } else {
      overlay.classList.remove('visible');
    }
  }

  /* ---- Attempt native landscape lock (where supported) ---- */
  function tryLockOrientation() {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {
        // Lock not supported or permission denied — that's OK, overlay handles it
      });
    } else if (screen.lockOrientation) {
      // Legacy Firefox / older Android
      screen.lockOrientation('landscape');
    } else if (screen.mozLockOrientation) {
      screen.mozLockOrientation('landscape');
    }
  }

  /* ---- Init after DOM is ready ---- */
  function init() {
    injectOverlay();
    checkOrientation();
    tryLockOrientation();

    // Listen for orientation changes
    window.addEventListener('orientationchange', () => {
      // Small delay as some browsers fire before layout is updated
      setTimeout(checkOrientation, 100);
    });

    window.addEventListener('resize', checkOrientation);

    if (screen.orientation) {
      screen.orientation.addEventListener('change', checkOrientation);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
