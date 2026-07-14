import { useEffect, useRef } from 'react';

// חגיגת שוט מושלם: פרץ חד-פעמי של פולי קפה + נצנוצי קרמה זהובים
// שמתעופפים כלפי מעלה ונופלים בכוח כבידה. ~1.3 שניות, ואז מנקה את עצמו.
// מכבד "הפחתת תנועה" — במצב כזה לא מצייר כלום וקורא ל-onDone מיד.

export function Celebration({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onDone();
      return;
    }
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const dark = document.documentElement.dataset.theme !== 'light';
    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    // פרץ ממרכז-עליון של המסך, במניפה כלפי מעלה
    const cx = w / 2;
    const cy = h * 0.42;
    const parts = Array.from({ length: 46 }, () => {
      const ang = rand(-Math.PI * 0.85, -Math.PI * 0.15);
      const spd = rand(6, 13);
      const bean = Math.random() < 0.72; // רוב הפולים, מיעוט נצנוצי קרמה
      return {
        x: cx + rand(-30, 30),
        y: cy + rand(-12, 12),
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        size: bean ? rand(7, 13) : rand(2.5, 4.5),
        angle: rand(0, Math.PI * 2),
        spin: rand(-0.3, 0.3),
        bean,
      };
    });

    const DURATION = 1300;
    const start = performance.now();
    let last = start;
    let raf = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      onDone();
    };
    // גיבוי: אם הטאב מוסתר (rAF מושהה) החגיגה תתנקה בכל מקרה
    const fallback = setTimeout(finish, DURATION + 400);

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 16.67, 2);
      last = now;
      const t = now - start;
      ctx.clearRect(0, 0, w, h);
      const fade = t > 900 ? Math.max(0, 1 - (t - 900) / 400) : 1;

      for (const p of parts) {
        p.vy += 0.28 * dt; // כבידה
        p.vx *= 0.995;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.angle += p.spin * dt;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.globalAlpha = fade;
        if (p.bean) {
          ctx.fillStyle = dark ? '#e8a960' : '#8a5a2c';
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size * 0.62, p.size, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = dark ? '#190e06' : '#f2e8d9';
          ctx.lineWidth = Math.max(1, p.size * 0.14);
          ctx.beginPath();
          ctx.moveTo(0, -p.size * 0.8);
          ctx.quadraticCurveTo(p.size * 0.3, 0, 0, p.size * 0.8);
          ctx.stroke();
        } else {
          ctx.fillStyle = '#ffcf95'; // נצנוץ קרמה זהוב
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      if (t < DURATION) {
        raf = requestAnimationFrame(tick);
      } else {
        finish();
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(fallback);
    };
  }, [onDone]);

  return <canvas ref={ref} className="celebration-canvas" aria-hidden="true" />;
}
