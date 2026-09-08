import { useEffect, useRef } from 'react';
import { STR } from '../content.js';
import { config } from '../config.js';

// Ambient-волна на входе — чисто декоративная (не уровень микрофона, не онлайн).
// Реальный звук: VAD из webrtc.js уже внутри комнаты (RoomView).
function AmbientCanvas({ active }) {
  const ref = useRef(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv.getContext('2d');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let parX = 0;
    let parY = 0;
    let raf = 0;

    const size = () => {
      cv.width = Math.max(1, cv.offsetWidth * devicePixelRatio);
      cv.height = Math.max(1, cv.offsetHeight * devicePixelRatio);
    };
    size();
    const onResize = () => size();
    const onMove = (e) => {
      parX = e.clientX / innerWidth - 0.5;
      parY = e.clientY / innerHeight - 0.5;
    };
    addEventListener('resize', onResize);
    addEventListener('pointermove', onMove, { passive: true });

    const waveY = (x, t, ph) =>
      Math.sin(x * 0.008 + t * 0.0009 + ph) * Math.sin(x * 0.0022 - t * 0.00045 + parX * 1.4);

    const strokeLayer = (t, mid, amp, alpha, lw, ph) => {
      ctx.strokeStyle = 'rgba(140,255,0,' + alpha + ')';
      ctx.lineWidth = lw * devicePixelRatio;
      ctx.beginPath();
      const w = cv.width;
      const h = cv.height;
      const step = 5 * devicePixelRatio;
      for (let x = 0; x <= w; x += step) {
        const y = mid + waveY(x, t, ph) * amp * h * Math.sin(t * 0.0011 + x * 0.012 + parY);
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    const draw = (t) => {
      raf = requestAnimationFrame(draw);
      if (reduced || !activeRef.current) return;
      const w = cv.width;
      const h = cv.height;
      ctx.clearRect(0, 0, w, h);
      const mid = h * 0.56 + parY * 14 * devicePixelRatio;
      strokeLayer(t, mid - h * 0.1, 0.1, 0.1, 1, 2.1);
      strokeLayer(t, mid + h * 0.09, 0.13, 0.18, 1, 4.4);
      ctx.shadowColor = 'rgba(140,255,0,.55)';
      ctx.shadowBlur = 8 * devicePixelRatio;
      strokeLayer(t, mid, 0.17, 0.5, 1.6, 0);
      ctx.shadowBlur = 0;
      const px = ((t * 0.12) % (w + 80)) - 40;
      const py = mid + waveY(px, t, 0) * 0.17 * h * Math.sin(t * 0.0011 + px * 0.012 + parY);
      const pr = 2.6 * devicePixelRatio;
      const g = ctx.createRadialGradient(px, py, 0, px, py, pr * 4);
      g.addColorStop(0, 'rgba(140,255,0,.9)');
      g.addColorStop(1, 'rgba(140,255,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, pr * 4, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#8CFF00';
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, 7);
      ctx.fill();
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('resize', onResize);
      removeEventListener('pointermove', onMove);
    };
  }, []);

  return <canvas id="ambient" ref={ref} />;
}

export function JoinView({ roomLower, roomUpper, name, setName, onJoin }) {
  return (
    <section id="view-join" className="view active">
      <div id="orb"></div>
      <AmbientCanvas active={true} />
      <div className="hero-label mono anim" style={{ '--d': '.05s' }}>
        <span>+001 / ВХОД</span>
        <span className="rule"></span>
        <span>КОМНАТА: {roomUpper}</span>
      </div>
      <h1>
        <span className="line">
          <span className="line-in">ГОЛОС</span>
        </span>
        <span className="line">
          <span className="line-in">
            <span className="lime shine">РУМ</span>
            <span className="outline">.</span>
          </span>
        </span>
      </h1>
      <p className="sub anim" style={{ '--d': '.32s' }}>
        {STR.sub}
      </p>
      <div className="join-card ticks">
        <div className="mono" style={{ marginBottom: 10 }}>
          {STR.statusReady}
        </div>
        <div className="join-row">
          <input
            id="name"
            maxLength={config.maxNameLen}
            required
            aria-required="true"
            placeholder={STR.namePlaceholder}
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onJoin();
            }}
          />
          <button id="joinBtn" onClick={onJoin}>
            {STR.enter}
          </button>
        </div>
        <div className="meta-row">
          <div className="room-pill">
            КОМНАТА <b>#{roomLower}</b> · ИЗ ССЫЛКИ
          </div>
        </div>
      </div>
      <footer className="mono">
        <span>{STR.footLeft}</span>
        <span>{STR.footRight}</span>
      </footer>
    </section>
  );
}
