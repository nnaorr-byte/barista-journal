import { useEffect, useRef } from 'react';

// רקע אווירה: פולי קפה נופלים לאט מלמעלה, בשקיפות עדינה.
// Canvas קל (14 פולים), נעצר אוטומטית בטאב לא פעיל,
// ומכבד "הפחתת תנועה" — אז לא מצויר כלל.

const BEAN_COUNT = 14;

interface Bean {
  x: number; // 0..1 יחסי לרוחב
  y: number; // 0..1 יחסי לגובה
  size: number;
  speed: number; // פיקסלים לשנייה
  angle: number;
  spin: number;
  sway: number; // תנודה אופקית
  swayPhase: number;
  depth: number; // 0.5..1 — "עומק" שמשפיע על גודל, מהירות ושקיפות
}

export function BeansBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const beans: Bean[] = Array.from({ length: BEAN_COUNT }, () => ({
      x: Math.random(),
      y: rand(-1, 1), // מפוזרים לאורך המסך כבר בהתחלה
      size: rand(9, 17),
      speed: rand(12, 26),
      angle: rand(0, Math.PI * 2),
      spin: rand(-0.45, 0.45),
      sway: rand(6, 22),
      swayPhase: rand(0, Math.PI * 2),
      depth: rand(0.5, 1),
    }));

    let last = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      ctx.clearRect(0, 0, w, h);
      const dark = document.documentElement.dataset.theme !== 'light';

      for (const b of beans) {
        b.y += (b.speed * b.depth * dt) / h;
        b.angle += b.spin * dt;
        b.swayPhase += dt * 0.7;
        if (b.y > 1.06) {
          b.y = -0.08;
          b.x = Math.random();
        }

        const px = b.x * w + Math.sin(b.swayPhase) * b.sway;
        const py = b.y * h;
        const s = b.size * b.depth;

        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(b.angle);
        ctx.globalAlpha = (dark ? 0.15 : 0.13) * b.depth;
        // גוף הפול
        ctx.fillStyle = dark ? '#e8a960' : '#8a5a2c';
        ctx.beginPath();
        ctx.ellipse(0, 0, s * 0.62, s, 0, 0, Math.PI * 2);
        ctx.fill();
        // החריץ האופייני
        ctx.strokeStyle = dark ? '#190e06' : '#f2e8d9';
        ctx.lineWidth = Math.max(1, s * 0.14);
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.8);
        ctx.quadraticCurveTo(s * 0.3, 0, 0, s * 0.8);
        ctx.stroke();
        ctx.restore();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={ref} className="beans-bg" aria-hidden="true" />;
}
