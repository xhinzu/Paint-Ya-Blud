/* Paint Ya Blud - SVG Sketchy Filter & Blob Helper */

(function () {
  // Inject global SVG sketchy displacement filter into DOM
  function injectSVGFilter() {
    if (document.getElementById('sketchy-filter-svg')) return;

    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.id = 'sketchy-filter-svg';
    svg.style.position = 'absolute';
    svg.style.width = '0';
    svg.style.height = '0';
    svg.style.overflow = 'hidden';

    svg.innerHTML = `
      <defs>
        <filter id="sketchy-filter" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="3" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="crayon-rough" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="4" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="7" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    `;

    document.body.appendChild(svg);
  }

  // Draw Mascot Stick Figure on Canvas
  window.drawStickMascot = function (canvasId, options = {}) {
    const canvas = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = options.lineWidth || 7;
    ctx.strokeStyle = options.strokeColor || '#111111';

    const cx = w / 2;
    const cy = options.headY || h * 0.35;
    const headRadius = options.headRadius || 75;

    // Head circle (rough sketchy stroke)
    ctx.beginPath();
    ctx.arc(cx, cy, headRadius, 0, Math.PI * 2);
    ctx.stroke();

    // Eyes (two dots)
    const eyeOffsetX = headRadius * 0.35;
    const eyeOffsetY = headRadius * 0.15;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(cx - eyeOffsetX, cy - eyeOffsetY, 7, 0, Math.PI * 2);
    ctx.arc(cx + eyeOffsetX, cy - eyeOffsetY, 7, 0, Math.PI * 2);
    ctx.fill();

    // Eyebrows (curved lines)
    ctx.beginPath();
    ctx.arc(cx - eyeOffsetX, cy - eyeOffsetY - 18, 14, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx + eyeOffsetX, cy - eyeOffsetY - 18, 14, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();

    // Smile
    ctx.beginPath();
    ctx.arc(cx, cy + 10, headRadius * 0.45, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();

    // Body Outline / Torso
    ctx.beginPath();
    ctx.moveTo(cx - headRadius * 0.8, h);
    ctx.quadraticCurveTo(cx - headRadius * 0.9, cy + headRadius + 20, cx, cy + headRadius + 15);
    ctx.quadraticCurveTo(cx + headRadius * 0.9, cy + headRadius + 20, cx + headRadius * 0.8, h);
    ctx.stroke();

    // Customization Accents (e.g. Scarf/Tie)
    if (options.hasTie) {
      ctx.fillStyle = options.tieColor || '#e74c3c';
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy + headRadius + 15);
      ctx.lineTo(cx + 10, cy + headRadius + 15);
      ctx.lineTo(cx + 18, cy + headRadius + 90);
      ctx.lineTo(cx, cy + headRadius + 120);
      ctx.lineTo(cx - 18, cy + headRadius + 90);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  };

  document.addEventListener('DOMContentLoaded', injectSVGFilter);
})();
