/* Paint Ya Blud - Textured Crayon & Brush Engine */

(function () {
  let canvas, ctx;
  let isDrawing = false;
  let lastX = 0, lastY = 0;
  let currentColor = '#2ecc71';
  let currentTool = 'crayon'; // crayon, pen, rubber, pencil
  let brushSize = 14;

  window.initCrayonCanvas = function (canvasId) {
    canvas = document.getElementById(canvasId);
    if (!canvas) return;

    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Event Listeners
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing);

    canvas.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      startDrawing(touch);
    });
    canvas.addEventListener('touchmove', (e) => {
      const touch = e.touches[0];
      draw(touch);
      e.preventDefault();
    });
    canvas.addEventListener('touchend', stopDrawing);
  };

  function resizeCanvas() {
    if (!canvas) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  }

  window.selectColor = function (color, dotElem) {
    currentColor = color;
    if (currentTool === 'rubber') {
      selectTool('crayon');
    }
    if (dotElem) {
      document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
      dotElem.classList.add('active');
    }
  };

  window.selectTool = function (tool) {
    currentTool = tool;
    document.querySelectorAll('.tool-item').forEach(t => t.classList.remove('active'));

    if (tool === 'crayon') {
      brushSize = 16;
      document.getElementById('toolCrayon')?.classList.add('active');
    } else if (tool === 'pen') {
      brushSize = 8;
      document.getElementById('toolPen')?.classList.add('active');
    } else if (tool === 'rubber') {
      brushSize = 30;
      document.getElementById('toolRubber')?.classList.add('active');
    } else if (tool === 'pencil') {
      brushSize = 3;
      document.getElementById('toolPencil')?.classList.add('active');
    }
  };

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  function startDrawing(e) {
    isDrawing = true;
    const pos = getPos(e);
    lastX = pos.x;
    lastY = pos.y;
    drawStrokePoint(pos.x, pos.y);
  }

  function draw(e) {
    if (!isDrawing) return;
    const pos = getPos(e);
    drawSegment(lastX, lastY, pos.x, pos.y);
    lastX = pos.x;
    lastY = pos.y;
  }

  function stopDrawing() {
    isDrawing = false;
  }

  function drawSegment(x1, y1, x2, y2) {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const step = 3;

    for (let i = 0; i < dist; i += step) {
      const currX = x1 + Math.cos(angle) * i;
      const currY = y1 + Math.sin(angle) * i;
      drawStrokePoint(currX, currY);
    }
  }

  function drawStrokePoint(x, y) {
    if (currentTool === 'rubber') {
      ctx.clearRect(x - brushSize / 2, y - brushSize / 2, brushSize, brushSize);
      return;
    }

    if (currentTool === 'crayon') {
      // Chalk / Crayon texture stamp effect
      ctx.fillStyle = currentColor;
      const density = 25;
      for (let i = 0; i < density; i++) {
        const offsetX = (Math.random() - 0.5) * brushSize;
        const offsetY = (Math.random() - 0.5) * brushSize;
        const r = Math.random() * 2 + 1;
        ctx.globalAlpha = Math.random() * 0.7 + 0.3;
        ctx.beginPath();
        ctx.arc(x + offsetX, y + offsetY, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1.0;
    } else {
      // Smooth / Pen / Pencil Stroke
      ctx.fillStyle = currentColor;
      ctx.strokeStyle = currentColor;
      ctx.lineWidth = brushSize;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
})();
