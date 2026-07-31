/* Paint Ya Blud - AR Face Painting Engine
 *
 * How it works:
 * 1. MediaPipe FaceMesh runs on the peer video in real-time
 * 2. When you draw at pixel (x,y), we find the NEAREST of 468 face landmarks
 * 3. We store the stroke as an OFFSET from that landmark (in normalized 0-1 space)
 * 4. Every animation frame we CLEAR the canvas and REDRAW all strokes by projecting
 *    the stored face-relative offsets back to screen coords using CURRENT landmark positions
 * 5. Result: paint moves, rotates, scales with the face in 3D
 *
 * Fallback: If no face is detected, strokes are stored as absolute coords
 *           and rendered at fixed positions (standard canvas mode).
 */

(function () {
  /* ---- State ---- */
  let canvas, ctx;
  let peerVideoElem = null;
  let faceLandmarks = null; // Current frame: array of 468 {x,y,z} in normalized [0-1] space

  let arStrokes    = [];   // All committed strokes
  let currentStroke = null; // Stroke being drawn right now
  let isDrawing    = false;
  let lastPos      = null;

  // Tool state
  let currentColor = '#e74c3c';
  let currentTool  = 'crayon';
  let brushSize    = 16;

  /* ---- Seeded deterministic PRNG (so crayon texture is stable across frames) ---- */
  function seededRand(seed) {
    const x = Math.sin(seed + 1) * 43758.5453123;
    return x - Math.floor(x);
  }

  function genCrayonDots(seed, size) {
    const dots = [];
    for (let i = 0; i < 22; i++) {
      const b = seed + i * 137.508;
      dots.push({
        ox: (seededRand(b)     - 0.5) * size,
        oy: (seededRand(b + 1) - 0.5) * size,
        r:   seededRand(b + 2) * 2.2 + 0.5,
        a:   seededRand(b + 3) * 0.55 + 0.35
      });
    }
    return dots;
  }

  /* ---- Coordinate conversion ---- */

  // Canvas pixel → face-relative coordinate
  function toFaceRelative(cx, cy) {
    const nx = cx / canvas.width;
    const ny = cy / canvas.height;

    if (!faceLandmarks || faceLandmarks.length === 0) {
      return { lmIdx: -1, dx: nx, dy: ny }; // No face: store as absolute
    }

    // Find nearest of the 468 landmarks
    let minD = Infinity, nearIdx = 0;
    for (let i = 0; i < faceLandmarks.length; i++) {
      const lm = faceLandmarks[i];
      const d  = (nx - lm.x) ** 2 + (ny - lm.y) ** 2;
      if (d < minD) { minD = d; nearIdx = i; }
    }

    const lm = faceLandmarks[nearIdx];
    return { lmIdx: nearIdx, dx: nx - lm.x, dy: ny - lm.y };
  }

  // Face-relative coordinate → canvas pixel
  function fromFaceRelative(pt) {
    if (pt.lmIdx === -1) {
      // Absolute (stored without face detection)
      return { x: pt.dx * canvas.width, y: pt.dy * canvas.height };
    }
    if (!faceLandmarks) return null; // No face visible right now — skip, draw when face returns
    const lm = faceLandmarks[pt.lmIdx];
    return {
      x: (lm.x + pt.dx) * canvas.width,
      y: (lm.y + pt.dy) * canvas.height
    };
  }

  /* ---- Pointer input ---- */

  function getCanvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width  / rect.width;
    const sy = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top)  * sy
    };
  }

  function onDown(e) {
    isDrawing = true;
    const pos = getCanvasPos(e);
    currentStroke = { color: currentColor, tool: currentTool, size: brushSize, pts: [] };
    addPoint(pos.x, pos.y);
    lastPos = pos;
  }

  function onMove(e) {
    if (!isDrawing || !currentStroke) return;
    const pos = getCanvasPos(e);
    if (Math.hypot(pos.x - lastPos.x, pos.y - lastPos.y) < 2) return;
    addPoint(pos.x, pos.y);
    lastPos = pos;
  }

  function onUp() {
    if (!isDrawing || !currentStroke) return;
    isDrawing = false;
    if (currentStroke.pts.length > 0) {
      arStrokes.push(currentStroke);

      // Broadcast to peer (send as absolute coords for compatibility)
      if (window.PYBMultiplayer) {
        const absoluteStroke = {
          color: currentStroke.color,
          tool:  currentStroke.tool,
          size:  currentStroke.size,
          pts: currentStroke.pts.map(pt => {
            const screen = fromFaceRelative(pt);
            if (!screen) return null;
            return {
              lmIdx: -1,
              dx: screen.x / canvas.width,
              dy: screen.y / canvas.height,
              dots: pt.dots
            };
          }).filter(Boolean)
        };
        window.PYBMultiplayer.sendStrokePoint({ arStroke: absoluteStroke });
      }
    }
    currentStroke = null;
    lastPos = null;
  }

  function addPoint(x, y) {
    const rel  = toFaceRelative(x, y);
    const seed = Math.round(x * 17) + Math.round(y * 31) * 1000;
    const dots = (currentTool === 'crayon') ? genCrayonDots(seed, currentStroke.size) : null;
    currentStroke.pts.push({ ...rel, dots });
  }

  /* ---- Render loop (clears + redraws every frame using current landmarks) ---- */

  function renderLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of arStrokes)  renderStroke(s);
    if (currentStroke)           renderStroke(currentStroke);
    requestAnimationFrame(renderLoop);
  }

  function renderStroke(stroke) {
    for (const pt of stroke.pts) {
      const screen = fromFaceRelative(pt);
      if (!screen) continue;
      drawDot(screen.x, screen.y, stroke.color, stroke.tool, stroke.size, pt.dots);
    }
  }

  function drawDot(x, y, color, tool, size, dots) {
    if (tool === 'rubber') {
      ctx.clearRect(x - size / 2, y - size / 2, size, size);
      return;
    }
    if (tool === 'crayon' && dots) {
      ctx.fillStyle = color;
      for (const d of dots) {
        ctx.globalAlpha = d.a;
        ctx.beginPath();
        ctx.arc(x + d.ox, y + d.oy, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ---- MediaPipe Face Mesh ---- */

  async function initFaceMesh() {
    if (typeof FaceMesh === 'undefined') {
      console.warn('[FaceAR] MediaPipe not loaded — static canvas mode active.');
      return;
    }

    try {
      const fm = new FaceMesh({
        locateFile: (f) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${f}`
      });

      fm.setOptions({
        maxNumFaces: 1,
        refineLandmarks: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      fm.onResults((results) => {
        faceLandmarks =
          results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0
            ? results.multiFaceLandmarks[0]
            : null;

        // Update face indicator
        const indicator = document.getElementById('faceIndicator');
        if (indicator) {
          indicator.textContent = faceLandmarks ? '😀 Face locked' : '👤 No face';
          indicator.style.color = faceLandmarks ? '#27ae60' : '#e74c3c';
        }
      });

      await fm.initialize();
      console.log('[FaceAR] FaceMesh ready ✓');

      // Continuously send video frames to face mesh
      (async function frameLoop() {
        if (
          peerVideoElem &&
          peerVideoElem.readyState >= 2 &&
          !peerVideoElem.paused &&
          peerVideoElem.videoWidth > 0
        ) {
          try { await fm.send({ image: peerVideoElem }); } catch (_) { /* ignore single frame errors */ }
        }
        requestAnimationFrame(frameLoop);
      })();

    } catch (err) {
      console.error('[FaceAR] FaceMesh failed to initialize:', err);
    }
  }

  /* ---- Public API ---- */

  window.initFaceAR = async function (canvasId, videoId) {
    canvas        = document.getElementById(canvasId);
    peerVideoElem = document.getElementById(videoId);
    if (!canvas) return;

    ctx = canvas.getContext('2d');

    function resizeCanvas() {
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width  = rect.width;
      canvas.height = rect.height;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Pointer events
    canvas.addEventListener('mousedown',  onDown);
    canvas.addEventListener('mousemove',  onMove);
    canvas.addEventListener('mouseup',    onUp);
    canvas.addEventListener('mouseleave', onUp);
    canvas.addEventListener('touchstart', e => { e.preventDefault(); onDown(e.touches[0]); }, { passive: false });
    canvas.addEventListener('touchmove',  e => { e.preventDefault(); onMove(e.touches[0]); }, { passive: false });
    canvas.addEventListener('touchend',   onUp);

    // Boot face tracking
    await initFaceMesh();

    // Start render loop
    renderLoop();
  };

  window.selectColor = function (color, dotElem) {
    currentColor = color;
    if (currentTool === 'rubber') { currentTool = 'crayon'; brushSize = 16; }
    if (dotElem) {
      document.querySelectorAll('.color-swatch').forEach(d => d.classList.remove('active'));
      dotElem.classList.add('active');
    }
  };

  window.selectTool = function (tool) {
    currentTool = tool;
    document.querySelectorAll('.tool-btn').forEach(t => t.classList.remove('active'));
    const sizes = { crayon: 16, pen: 8, rubber: 30, pencil: 3 };
    const ids   = { crayon: 'toolCrayon', pen: 'toolPen', rubber: 'toolRubber', pencil: 'toolPencil' };
    brushSize = sizes[tool] ?? 14;
    document.getElementById(ids[tool])?.classList.add('active');
  };

  // Receive remote AR stroke from peer
  window.renderRemoteStrokePoint = function (data) {
    if (data && data.arStroke) {
      arStrokes.push(data.arStroke);
    }
    // Legacy support for old plain stroke format
    else if (data && data.nx !== undefined) {
      const s = {
        color: data.color || '#e74c3c',
        tool:  data.tool  || 'crayon',
        size:  data.size  || 16,
        pts:   [{ lmIdx: -1, dx: data.nx, dy: data.ny, dots: null }]
      };
      arStrokes.push(s);
    }
  };

  window.clearCanvasRemote = function () { arStrokes = []; };

  window.getARStrokes = function () { return arStrokes; };
  window.setARStrokes = function (strokes) { if (Array.isArray(strokes)) arStrokes = strokes; };

})();
