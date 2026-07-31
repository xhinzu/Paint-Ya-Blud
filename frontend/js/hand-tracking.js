/* Paint Ya Blud - MediaPipe Hands Air-Brush Tracker */

(function () {
  let hands = null;
  let camera = null;
  let isTracking = false;
  let isPinching = false;
  let lastX = 0, lastY = 0;

  window.initAirBrushTracking = function (videoElemId, canvasElemId) {
    const videoElement = document.getElementById(videoElemId);
    const canvasElement = document.getElementById(canvasElemId);
    if (!videoElement || !canvasElement) return;

    // Load MediaPipe Hands dynamically if available
    if (typeof Hands === 'undefined') {
      console.warn('MediaPipe Hands library not loaded. Air-brush mode disabled until CDN script loads.');
      return;
    }

    hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.7
    });

    hands.onResults((results) => {
      if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
        isPinching = false;
        return;
      }

      const landmarks = results.multiHandLandmarks[0];
      const thumbTip = landmarks[4];
      const indexTip = landmarks[8];

      // Calculate distance between thumb tip and index tip (Pinch gesture)
      const distance = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
      const pinchThreshold = 0.06;

      const rect = canvasElement.getBoundingClientRect();
      const currX = (1 - indexTip.x) * rect.width; // Mirrored horizontal
      const currY = indexTip.y * rect.height;

      if (distance < pinchThreshold) {
        if (!isPinching) {
          isPinching = true;
          lastX = currX;
          lastY = currY;
        } else {
          // Trigger drawing segment
          if (window.drawSegment) {
            window.drawSegment(lastX, lastY, currX, currY);
          }
          if (window.sendRemoteStroke) {
            window.sendRemoteStroke({ x1: lastX, y1: lastY, x2: currX, y2: currY, color: '#2ecc71', tool: 'crayon' });
          }
          lastX = currX;
          lastY = currY;
        }
      } else {
        isPinching = false;
      }
    });

    // Start Camera loop
    if (typeof Camera !== 'undefined') {
      camera = new Camera(videoElement, {
        onFrame: async () => {
          if (isTracking) {
            await hands.send({ image: videoElement });
          }
        },
        width: 640,
        height: 480
      });
      camera.start();
      isTracking = true;
    }
  };

  window.toggleAirBrush = function () {
    isTracking = !isTracking;
    return isTracking;
  };
})();
