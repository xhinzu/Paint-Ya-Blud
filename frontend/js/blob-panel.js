/* Paint Ya Blud - Global UI Helpers & Custom Stickman Renderer */

(function () {
  // Inject global SVG sketchy filter if missing
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
        <filter id="chalky" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" result="noise"/>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
      </defs>
    `;

    document.body.appendChild(svg);
  }

  /* ==================================================== */
  /* GLOBAL STICKMAN RENDERER                             */
  /* Reads pyb_character from localStorage or accepts opt */
  /* ==================================================== */

  const HATS   = ['None', 'Top Hat', 'Beanie', 'Halo', 'Crown'];
  const MOODS  = ['Happy','Angry','Confused','Shocked','Flirty','Tired','Cool','Smug','Crying','Nervous','Scared','Laughing'];
  const SKINS  = ['transparent', '#f5cba7', '#e59866', '#6e2d0e', '#8e44ad'];
  const TIES   = ['#e74c3c', '#2980b9', '#27ae60', '#f1c40f', '#9b59b6', '#e67e22', null];

  window.drawStickMascot = function (canvasId, customConfig = null) {
    const canvas = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // Load configuration
    let config = customConfig;
    if (!config) {
      try {
        config = JSON.parse(localStorage.getItem('pyb_character') || '{}');
      } catch (_) {
        config = {};
      }
    }

    // Resolve index/string options
    const hatName  = typeof config.hat  === 'string' ? config.hat  : HATS[config.hatIdx ?? config.hat ?? 0]   || 'None';
    const moodName = typeof config.mood === 'string' ? config.mood : MOODS[config.moodIdx ?? config.face ?? 0] || 'Happy';
    
    let skinColor = 'transparent';
    if (typeof config.skin === 'string') skinColor = config.skin;
    else skinColor = SKINS[config.skinIdx ?? config.skin ?? 0] || 'transparent';

    let tieColor = '#e74c3c';
    if (config.tieColor !== undefined) tieColor = config.tieColor;
    else if (typeof config.tie === 'string') tieColor = config.tie;
    else tieColor = TIES[config.tieIdx ?? config.tie ?? 0];

    ctx.clearRect(0, 0, w, h);

    // Dynamic scaling based on canvas width (normalized to 300px base design)
    const scale = w / 300;
    const cx    = w / 2;
    const headR = 78 * scale;
    const headY = 110 * scale;

    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth   = Math.max(2, 6 * scale);
    ctx.strokeStyle = '#111';

    // --- Hat behind ---
    drawHat(ctx, cx, headY, headR, hatName, true, scale);

    // --- Head ---
    ctx.fillStyle = skinColor === 'transparent' ? 'rgba(0,0,0,0)' : skinColor;
    ctx.beginPath();
    ctx.arc(cx, headY, headR, 0, Math.PI * 2);
    if (skinColor !== 'transparent') ctx.fill();
    ctx.stroke();

    // --- Hat in front ---
    drawHat(ctx, cx, headY, headR, hatName, false, scale);

    // --- Face / Mood ---
    drawFace(ctx, cx, headY, headR, moodName, scale);

    // --- Torso ---
    ctx.lineWidth   = Math.max(2, 6 * scale);
    ctx.strokeStyle = '#111';
    ctx.fillStyle   = skinColor === 'transparent' ? 'rgba(0,0,0,0)' : skinColor;

    ctx.beginPath();
    ctx.moveTo(cx - headR * 0.7, h - 5 * scale);
    ctx.quadraticCurveTo(cx - headR * 0.88, headY + headR + 16 * scale, cx, headY + headR + 10 * scale);
    ctx.quadraticCurveTo(cx + headR * 0.88, headY + headR + 16 * scale, cx + headR * 0.7, h - 5 * scale);

    if (skinColor !== 'transparent') ctx.fill();
    ctx.stroke();

    // --- Tie ---
    if (tieColor) {
      ctx.lineWidth   = Math.max(1.5, 3 * scale);
      ctx.strokeStyle = '#111';
      ctx.fillStyle   = tieColor;
      ctx.beginPath();
      ctx.moveTo(cx - 10 * scale, headY + headR + 10 * scale);
      ctx.lineTo(cx + 10 * scale, headY + headR + 10 * scale);
      ctx.lineTo(cx + 17 * scale, headY + headR + 70 * scale);
      ctx.lineTo(cx,              headY + headR + 100 * scale);
      ctx.lineTo(cx - 17 * scale, headY + headR + 70 * scale);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  };

  /* ---- Face Mood Renderer ---- */
  function drawFace(ctx, cx, headY, headR, mood, scale) {
    const ex    = headR * 0.33;
    const ey    = headR * 0.14;
    const browY = headY - ey - 22 * scale;

    ctx.strokeStyle = '#111';
    ctx.fillStyle   = '#111';

    function dot(x, y, r) {
      ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, r * scale), 0, Math.PI * 2); ctx.fill();
    }
    function line(x1, y1, x2, y2, w) {
      ctx.lineWidth = Math.max(1.5, (w || 4.5) * scale);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    function arc(x, y, r, s, e, ccw) {
      ctx.beginPath(); ctx.arc(x, y, r, s, e, ccw); ctx.stroke();
    }

    ctx.lineWidth = Math.max(1.5, 4.5 * scale);

    switch (mood) {
      case 'Happy':
        dot(cx - ex, headY - ey, 7);
        dot(cx + ex, headY - ey, 7);
        arc(cx - ex, browY, 13 * scale, Math.PI * 1.1, Math.PI * 1.9);
        arc(cx + ex, browY, 13 * scale, Math.PI * 1.1, Math.PI * 1.9);
        dot(cx, headY + headR * 0.16, 4);
        ctx.lineWidth = Math.max(1.5, 5 * scale);
        arc(cx, headY + 14 * scale, headR * 0.42, Math.PI * 0.15, Math.PI * 0.85);
        break;

      case 'Angry':
        dot(cx - ex, headY - ey, 7);
        dot(cx + ex, headY - ey, 7);
        line(cx - ex - 18 * scale, browY - 8 * scale, cx - ex + 10 * scale, browY + 8 * scale, 5);
        line(cx + ex + 18 * scale, browY - 8 * scale, cx + ex - 10 * scale, browY + 8 * scale, 5);
        dot(cx, headY + headR * 0.16, 4);
        ctx.lineWidth = Math.max(1.5, 5 * scale);
        arc(cx, headY + 55 * scale, headR * 0.42, Math.PI * 1.15, Math.PI * 1.85);
        line(cx - 5 * scale, browY + 5 * scale, cx + 5 * scale, browY - 2 * scale, 3.5);
        break;

      case 'Confused':
        dot(cx - ex, headY - ey, 7);
        dot(cx + ex, headY - ey, 7);
        arc(cx - ex, browY - 6 * scale, 13 * scale, Math.PI * 1.1, Math.PI * 1.9);
        line(cx + ex - 14 * scale, browY + 2 * scale, cx + ex + 14 * scale, browY + 2 * scale, 4.5);
        dot(cx, headY + headR * 0.16, 4);
        ctx.lineWidth = Math.max(1.5, 5 * scale);
        ctx.beginPath();
        ctx.moveTo(cx - 22 * scale, headY + 20 * scale);
        ctx.bezierCurveTo(cx - 10 * scale, headY + 10 * scale, cx + 10 * scale, headY + 30 * scale, cx + 22 * scale, headY + 20 * scale);
        ctx.stroke();
        break;

      case 'Shocked':
        ctx.lineWidth = Math.max(1.5, 4 * scale);
        arc(cx - ex, headY - ey, 12 * scale, 0, Math.PI * 2);
        arc(cx + ex, headY - ey, 12 * scale, 0, Math.PI * 2);
        dot(cx - ex, headY - ey, 4);
        dot(cx + ex, headY - ey, 4);
        arc(cx - ex, browY + 2 * scale, 11 * scale, Math.PI * 1.1, Math.PI * 1.9);
        arc(cx + ex, browY + 2 * scale, 11 * scale, Math.PI * 1.1, Math.PI * 1.9);
        dot(cx, headY + headR * 0.16, 4);
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.ellipse(cx, headY + 24 * scale, 11 * scale, 16 * scale, 0, 0, Math.PI * 2); ctx.fill();
        break;

      case 'Flirty':
        ctx.lineWidth = Math.max(1.5, 4 * scale);
        arc(cx - ex, headY - ey + 2 * scale, 12 * scale, Math.PI * 1.0, Math.PI * 2.0);
        arc(cx + ex, headY - ey + 2 * scale, 12 * scale, Math.PI * 1.0, Math.PI * 2.0);
        for (let i = -2; i <= 2; i++) {
          const lx = cx - ex + i * 5 * scale;
          line(lx, headY - ey - 10 * scale, lx + (i < 0 ? -2 : i > 0 ? 2 : 0) * scale, headY - ey - 18 * scale, 2.5);
        }
        for (let i = -2; i <= 2; i++) {
          const lx = cx + ex + i * 5 * scale;
          line(lx, headY - ey - 10 * scale, lx + (i < 0 ? -2 : i > 0 ? 2 : 0) * scale, headY - ey - 18 * scale, 2.5);
        }
        arc(cx - ex, browY, 13 * scale, Math.PI * 1.1, Math.PI * 1.9);
        arc(cx + ex, browY, 13 * scale, Math.PI * 1.1, Math.PI * 1.9);
        dot(cx, headY + headR * 0.16, 4);
        ctx.lineWidth = Math.max(1.5, 5 * scale);
        arc(cx, headY + 10 * scale, headR * 0.42, Math.PI * 0.1, Math.PI * 0.9);
        ctx.fillStyle = '#e74c3c';
        ctx.beginPath(); ctx.ellipse(cx, headY + 30 * scale, 9 * scale, 13 * scale, 0, 0, Math.PI); ctx.fill();
        break;

      case 'Tired':
        ctx.lineWidth = Math.max(1.5, 4 * scale);
        arc(cx - ex, headY - ey, 12 * scale, Math.PI * 1.15, Math.PI * 1.85);
        arc(cx + ex, headY - ey, 12 * scale, Math.PI * 1.15, Math.PI * 1.85);
        arc(cx - ex, headY - ey + 4 * scale, 12 * scale, Math.PI * 0.1, Math.PI * 0.9);
        arc(cx + ex, headY - ey + 4 * scale, 12 * scale, Math.PI * 0.1, Math.PI * 0.9);
        line(cx - ex - 14 * scale, browY + 4 * scale, cx - ex + 14 * scale, browY + 8 * scale, 4.5);
        line(cx + ex - 14 * scale, browY + 4 * scale, cx + ex + 14 * scale, browY + 8 * scale, 4.5);
        dot(cx, headY + headR * 0.16, 4);
        ctx.lineWidth = Math.max(1.5, 5 * scale);
        ctx.beginPath();
        ctx.moveTo(cx - 18 * scale, headY + 25 * scale);
        ctx.quadraticCurveTo(cx, headY + 32 * scale, cx + 18 * scale, headY + 25 * scale);
        ctx.stroke();
        break;

      case 'Cool':
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.roundRect(cx - ex - 16 * scale, headY - ey - 12 * scale, 30 * scale, 20 * scale, 4 * scale);
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(cx + ex - 14 * scale, headY - ey - 12 * scale, 30 * scale, 20 * scale, 4 * scale);
        ctx.fill();
        line(cx - ex + 14 * scale, headY - ey, cx + ex - 14 * scale, headY - ey, 3);
        line(cx - ex - 16 * scale, headY - ey, cx - ex - 30 * scale, headY - ey - 4 * scale, 3);
        line(cx + ex + 16 * scale, headY - ey, cx + ex + 30 * scale, headY - ey - 4 * scale, 3);
        dot(cx, headY + headR * 0.16, 4);
        ctx.lineWidth = Math.max(1.5, 5 * scale);
        arc(cx, headY + 16 * scale, headR * 0.36, Math.PI * 0.15, Math.PI * 0.85);
        break;

      case 'Smug':
        dot(cx - ex, headY - ey, 7);
        dot(cx + ex, headY - ey, 7);
        arc(cx - ex, browY - 8 * scale, 13 * scale, Math.PI * 1.1, Math.PI * 1.9);
        line(cx + ex - 14 * scale, browY + 2 * scale, cx + ex + 14 * scale, browY - 4 * scale, 4.5);
        dot(cx, headY + headR * 0.16, 4);
        ctx.lineWidth = Math.max(1.5, 5 * scale);
        ctx.beginPath();
        ctx.moveTo(cx - 26 * scale, headY + 14 * scale);
        ctx.quadraticCurveTo(cx, headY + 36 * scale, cx + 26 * scale, headY + 14 * scale);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.roundRect(cx - 22 * scale, headY + 14 * scale, 44 * scale, 14 * scale, [0, 0, 4, 4]);
        ctx.fill();
        ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(1, 2 * scale);
        ctx.strokeRect(cx - 22 * scale, headY + 14 * scale, 44 * scale, 14 * scale);
        line(cx - 8 * scale, headY + 14 * scale, cx - 8 * scale, headY + 28 * scale, 2);
        line(cx + 8 * scale, headY + 14 * scale, cx + 8 * scale, headY + 28 * scale, 2);
        break;

      case 'Crying':
        dot(cx - ex, headY - ey, 7);
        dot(cx + ex, headY - ey, 7);
        line(cx - ex - 14 * scale, browY + 5 * scale, cx - ex + 10 * scale, browY - 5 * scale, 4.5);
        line(cx + ex + 14 * scale, browY + 5 * scale, cx + ex - 10 * scale, browY - 5 * scale, 4.5);
        dot(cx, headY + headR * 0.16, 4);
        ctx.lineWidth = Math.max(1.5, 5 * scale);
        arc(cx, headY + 55 * scale, headR * 0.4, Math.PI * 1.15, Math.PI * 1.85);
        ctx.fillStyle = '#5dade2';
        ctx.beginPath();
        ctx.moveTo(cx - ex, headY - ey + 9 * scale);
        ctx.bezierCurveTo(cx - ex - 7 * scale, headY - ey + 20 * scale, cx - ex + 7 * scale, headY - ey + 20 * scale, cx - ex, headY - ey + 9 * scale);
        ctx.arc(cx - ex, headY - ey + 20 * scale, 7 * scale, 0, Math.PI * 2);
        ctx.fill();
        break;

      case 'Nervous':
        ctx.lineWidth = Math.max(1.5, 4 * scale);
        arc(cx - ex, headY - ey, 13 * scale, 0, Math.PI * 2);
        arc(cx + ex, headY - ey, 13 * scale, 0, Math.PI * 2);
        dot(cx - ex, headY - ey, 4);
        dot(cx + ex, headY - ey, 4);
        arc(cx - ex, browY - 4 * scale, 13 * scale, Math.PI * 1.1, Math.PI * 1.9);
        arc(cx + ex, browY - 4 * scale, 13 * scale, Math.PI * 1.1, Math.PI * 1.9);
        dot(cx, headY + headR * 0.16, 4);
        ctx.lineWidth = Math.max(1.5, 5 * scale);
        ctx.beginPath();
        ctx.moveTo(cx - 22 * scale, headY + 20 * scale);
        for (let i = 0; i < 4; i++) {
          ctx.quadraticCurveTo(
            cx - 22 * scale + (i + 0.5) * 11 * scale, headY + (i % 2 === 0 ? 12 : 28) * scale,
            cx - 22 * scale + (i + 1) * 11 * scale, headY + 20 * scale
          );
        }
        ctx.stroke();
        break;

      case 'Scared':
        ctx.lineWidth = Math.max(1.5, 3.5 * scale);
        arc(cx - ex, headY - ey, 13 * scale, 0, Math.PI * 2);
        arc(cx - ex, headY - ey, 7 * scale, 0, Math.PI * 2);
        dot(cx - ex, headY - ey, 3);
        arc(cx + ex, headY - ey, 13 * scale, 0, Math.PI * 2);
        arc(cx + ex, headY - ey, 7 * scale, 0, Math.PI * 2);
        dot(cx + ex, headY - ey, 3);
        arc(cx - ex, browY, 13 * scale, Math.PI * 1.1, Math.PI * 1.9);
        arc(cx + ex, browY, 13 * scale, Math.PI * 1.1, Math.PI * 1.9);
        dot(cx, headY + headR * 0.16, 4);
        ctx.lineWidth = Math.max(1.5, 5 * scale);
        ctx.beginPath();
        ctx.moveTo(cx - 22 * scale, headY + 14 * scale);
        const zigPts = [cx - 11 * scale, headY + 26 * scale, cx, headY + 14 * scale, cx + 11 * scale, headY + 26 * scale, cx + 22 * scale, headY + 14 * scale];
        for (let i = 0; i < zigPts.length; i += 2) ctx.lineTo(zigPts[i], zigPts[i + 1]);
        ctx.stroke();
        ctx.fillStyle = '#5dade2';
        ctx.beginPath();
        ctx.moveTo(cx + ex + 18 * scale, headY - ey - 22 * scale);
        ctx.bezierCurveTo(cx + ex + 10 * scale, headY - ey - 8 * scale, cx + ex + 28 * scale, headY - ey - 8 * scale, cx + ex + 18 * scale, headY - ey - 22 * scale);
        ctx.arc(cx + ex + 18 * scale, headY - ey - 8 * scale, 6 * scale, 0, Math.PI * 2);
        ctx.fill();
        break;

      case 'Laughing':
        ctx.lineWidth = Math.max(1.5, 5 * scale);
        arc(cx - ex, headY - ey + 2 * scale, 13 * scale, Math.PI * 1.05, Math.PI * 1.95);
        arc(cx + ex, headY - ey + 2 * scale, 13 * scale, Math.PI * 1.05, Math.PI * 1.95);
        line(cx - ex - 20 * scale, headY - ey + 10 * scale, cx - ex - 12 * scale, headY - ey + 6 * scale, 3);
        line(cx - ex - 20 * scale, headY - ey + 17 * scale, cx - ex - 12 * scale, headY - ey + 13 * scale, 3);
        line(cx + ex + 20 * scale, headY - ey + 10 * scale, cx + ex + 12 * scale, headY - ey + 6 * scale, 3);
        line(cx + ex + 20 * scale, headY - ey + 17 * scale, cx + ex + 12 * scale, headY - ey + 13 * scale, 3);
        arc(cx - ex, browY, 13 * scale, Math.PI * 1.1, Math.PI * 1.9);
        arc(cx + ex, browY, 13 * scale, Math.PI * 1.1, Math.PI * 1.9);
        dot(cx, headY + headR * 0.16, 4);
        ctx.lineWidth = Math.max(1.5, 5 * scale);
        ctx.beginPath();
        ctx.moveTo(cx - 28 * scale, headY + 10 * scale);
        ctx.quadraticCurveTo(cx, headY + 50 * scale, cx + 28 * scale, headY + 10 * scale);
        ctx.stroke();
        ctx.fillStyle = '#222';
        ctx.beginPath();
        ctx.moveTo(cx - 26 * scale, headY + 12 * scale);
        ctx.quadraticCurveTo(cx, headY + 48 * scale, cx + 26 * scale, headY + 12 * scale);
        ctx.lineTo(cx + 26 * scale, headY + 12 * scale);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.roundRect(cx - 22 * scale, headY + 10 * scale, 44 * scale, 14 * scale, [4, 4, 0, 0]);
        ctx.fill();
        line(cx - 8 * scale, headY + 10 * scale, cx - 8 * scale, headY + 24 * scale, 2);
        line(cx + 8 * scale, headY + 10 * scale, cx + 8 * scale, headY + 24 * scale, 2);
        break;

      default:
        dot(cx - ex, headY - ey, 7);
        dot(cx + ex, headY - ey, 7);
        dot(cx, headY + headR * 0.16, 4);
        ctx.lineWidth = Math.max(1.5, 5 * scale);
        arc(cx, headY + 14 * scale, headR * 0.42, Math.PI * 0.15, Math.PI * 0.85);
    }
  }

  /* ---- Hat Renderer ---- */
  function drawHat(ctx, cx, headY, headR, hat, behind, scale) {
    if (!hat || hat === 'None') return;
    ctx.strokeStyle = '#111';

    if (hat === 'Top Hat') {
      if (!behind) {
        ctx.fillStyle = '#222';
        ctx.lineWidth = Math.max(1.5, 4 * scale);
        ctx.fillRect(cx - headR - 6 * scale, headY - headR - 6 * scale, (headR + 6 * scale) * 2, 14 * scale);
        ctx.strokeRect(cx - headR - 6 * scale, headY - headR - 6 * scale, (headR + 6 * scale) * 2, 14 * scale);
        ctx.fillRect(cx - headR * 0.55, headY - headR - 62 * scale, headR * 1.1, 58 * scale);
        ctx.strokeRect(cx - headR * 0.55, headY - headR - 62 * scale, headR * 1.1, 58 * scale);
      }
    } else if (hat === 'Beanie') {
      if (!behind) {
        ctx.fillStyle = '#e74c3c';
        ctx.lineWidth = Math.max(1.5, 4 * scale);
        ctx.beginPath();
        ctx.ellipse(cx, headY - headR + 10 * scale, headR + 4 * scale, headR * 0.68, 0, Math.PI, 0);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(cx, headY - headR - 22 * scale, 17 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    } else if (hat === 'Halo') {
      if (!behind) {
        ctx.strokeStyle = '#f1c40f';
        ctx.lineWidth = Math.max(2, 7 * scale);
        ctx.beginPath();
        ctx.ellipse(cx, headY - headR - 22 * scale, headR * 0.72, 15 * scale, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (hat === 'Crown') {
      if (!behind) {
        ctx.fillStyle = '#f1c40f';
        ctx.lineWidth = Math.max(1.5, 4 * scale);
        ctx.strokeStyle = '#111';
        ctx.beginPath();
        const cr = headR * 0.85;
        ctx.moveTo(cx - cr, headY - headR + 5 * scale);
        ctx.lineTo(cx - cr, headY - headR - 42 * scale);
        ctx.lineTo(cx - cr * 0.4, headY - headR - 18 * scale);
        ctx.lineTo(cx, headY - headR - 52 * scale);
        ctx.lineTo(cx + cr * 0.4, headY - headR - 18 * scale);
        ctx.lineTo(cx + cr, headY - headR - 42 * scale);
        ctx.lineTo(cx + cr, headY - headR + 5 * scale);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  document.addEventListener('DOMContentLoaded', injectSVGFilter);
})();
