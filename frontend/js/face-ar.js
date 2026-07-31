/* Paint Ya Blud - Dual-Canvas AR Face Painting Engine
 *
 * Clean stroke separation:
 * 1. `localStrokes`: The strokes YOU paint on your friend's face (#drawingCanvas on top of #peerVideo)
 * 2. `remoteStrokes`: The strokes YOUR FRIEND paints on your face (received over network and rendered on #localDrawingCanvas on top of #localVideo)
 */

(function () {
  /* ---- State ---- */
  let canvas, ctx;
  let localPipCanvas = null, localPipCtx = null;
  let peerVideoElem = null;
  let faceLandmarks = null; // 468 landmarks in normalized [0-1] space

  let localStrokes  = []; // Strokes YOU drew on your friend
  let remoteStrokes = []; // Strokes YOUR FRIEND drew on you
  let currentStroke = null; // Active stroke being drawn right now
  let isDrawing     = false;
  let lastPos       = null;

  // Tool state
  let currentColor = '#e74c3c';
  let currentTool  = 'crayon';
  let brushSize    = 16;

  /* ---- Seeded deterministic PRNG for stable crayon texture ---- */
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

  function toFaceRelative(cx, cy) {
    const nx = cx / canvas.width;
    const ny = cy / canvas.height;

    if (!faceLandmarks || faceLandmarks.length === 0) {
      return { lmIdx: -1, dx: nx, dy: ny };
    }

    let minD = Infinity, nearIdx = 0;
    for (let i = 0; i < faceLandmarks.length; i++) {
      const lm = faceLandmarks[i];
      const d  = (nx - lm.x) ** 2 + (ny - lm.y) ** 2;
      if (d < minD) { minD = d; nearIdx = i; }
    }

    const lm = faceLandmarks[nearIdx];
    return { lmIdx: nearIdx, dx: nx - lm.x, dy: ny - lm.y };
  }

  function fromFaceRelative(pt, targetCanvas) {
    const c = targetCanvas || canvas;
    if (pt.lmIdx === -1) {
      return { x: pt.dx * c.width, y: pt.dy * c.height };
    }
    if (!faceLandmarks) return null;
    const lm = faceLandmarks[pt.lmIdx];
    return {
      x: (lm.x + pt.dx) * c.width,
      y: (lm.y + pt.dy) * c.height
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
      localStrokes.push(currentStroke);

      // Send to peer
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

  /* ---- Render loop ---- */

  function renderLoop() {
    // 1. Render LOCAL strokes (your drawings on friend's face)
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const s of localStrokes) renderStroke(ctx, canvas, s);
      if (currentStroke)            renderStroke(ctx, canvas, currentStroke);
    }

    // 2. Render REMOTE strokes (friend's drawings on your face inside PIP)
    if (localPipCtx && localPipCanvas) {
      localPipCtx.clearRect(0, 0, localPipCanvas.width, localPipCanvas.height);
      for (const s of remoteStrokes) renderStroke(localPipCtx, localPipCanvas, s);
    }

    requestAnimationFrame(renderLoop);
  }

  function renderStroke(targetCtx, targetCanvas, stroke) {
    for (const pt of stroke.pts) {
      const screen = fromFaceRelative(pt, targetCanvas);
      if (!screen) continue;
      drawDot(targetCtx, screen.x, screen.y, stroke.color, stroke.tool, stroke.size, pt.dots);
    }
  }

  function drawDot(targetCtx, x, y, color, tool, size, dots) {
    if (tool === 'rubber') {
      targetCtx.clearRect(x - size / 2, y - size / 2, size, size);
      return;
    }
    if (tool === 'crayon' && dots) {
      targetCtx.fillStyle = color;
      for (const d of dots) {
        targetCtx.globalAlpha = d.a;
        targetCtx.beginPath();
        targetCtx.arc(x + d.ox, y + d.oy, d.r, 0, Math.PI * 2);
        targetCtx.fill();
      }
      targetCtx.globalAlpha = 1;
    } else {
      targetCtx.fillStyle = color;
      targetCtx.beginPath();
      targetCtx.arc(x, y, size / 2, 0, Math.PI * 2);
      targetCtx.fill();
    }
  }

  /* ---- MediaPipe Face Mesh ---- */

  async function initFaceMesh() {
    if (typeof FaceMesh === 'undefined') {
      console.warn('[FaceAR] MediaPipe not loaded.');
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

        const indicator = document.getElementById('faceIndicator');
        if (indicator) {
          indicator.textContent = faceLandmarks ? '😀 Face locked' : '👤 No face';
          indicator.style.color = faceLandmarks ? '#27ae60' : '#e74c3c';
        }
      });

      await fm.initialize();
      console.log('[FaceAR] FaceMesh ready ✓');

      let lastFaceCheck = 0;
      (async function frameLoop(timestamp) {
        if (
          peerVideoElem &&
          peerVideoElem.readyState >= 2 &&
          !peerVideoElem.paused &&
          peerVideoElem.videoWidth > 0
        ) {
          if (timestamp - lastFaceCheck > 45) { // ~22 FPS AI face tracking (saves 70% CPU!)
            lastFaceCheck = timestamp;
            try { await fm.send({ image: peerVideoElem }); } catch (_) {}
          }
        }
        requestAnimationFrame(frameLoop);
      })();

    } catch (err) {
      console.error('[FaceAR] FaceMesh error:', err);
    }
  }

  /* ---- Public API ---- */

  window.initFaceAR = async function (canvasId, videoId, pipCanvasId) {
    canvas        = document.getElementById(canvasId);
    peerVideoElem = document.getElementById(videoId);
    if (!canvas) return;

    ctx = canvas.getContext('2d');

    if (pipCanvasId) {
      localPipCanvas = document.getElementById(pipCanvasId);
      if (localPipCanvas) localPipCtx = localPipCanvas.getContext('2d');
    }

    function resizeCanvas() {
      if (canvas && canvas.parentElement) {
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width  = rect.width;
        canvas.height = rect.height;
      }
      if (localPipCanvas && localPipCanvas.parentElement) {
        const pRect = localPipCanvas.parentElement.getBoundingClientRect();
        localPipCanvas.width  = pRect.width;
        localPipCanvas.height = pRect.height;
      }
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

    await initFaceMesh();
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

  // Receive remote AR stroke from peer -> push to remoteStrokes
  window.renderRemoteStrokePoint = function (data) {
    if (data && data.arStroke) {
      remoteStrokes.push(data.arStroke);
    } else if (data && data.nx !== undefined) {
      const s = {
        color: data.color || '#e74c3c',
        tool:  data.tool  || 'crayon',
        size:  data.size  || 16,
        pts:   [{ lmIdx: -1, dx: data.nx, dy: data.ny, dots: null }]
      };
      remoteStrokes.push(s);
    }
  };

  window.clearCanvasRemote = function () {
    localStrokes  = [];
    remoteStrokes = [];
  };

  window.getLocalARStrokes  = function () { return localStrokes; };
  window.getRemoteARStrokes = function () { return remoteStrokes; };
  window.setLocalARStrokes  = function (s) { if (Array.isArray(s)) localStrokes = s; };
  window.setRemoteARStrokes = function (s) { if (Array.isArray(s)) remoteStrokes = s; };

})();
