import { useEffect, useRef } from 'react';

// NOTE(realtime): волна рисуется из реального RMS-уровня микрофонов (VAD из webrtc.js).
// Вертикальные бары: высота = базовая осцилляция × живая энергия 0..1.
function WaveCanvas({ active, getEnergy }) {
  const ref = useRef(null);
  const stateRef = useRef({ active, getEnergy });
  stateRef.current = { active, getEnergy };

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv.getContext('2d');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;

    const size = () => {
      cv.width = Math.max(1, cv.offsetWidth * devicePixelRatio);
      cv.height = Math.max(1, cv.offsetHeight * devicePixelRatio);
    };
    size();
    const onResize = () => size();
    addEventListener('resize', onResize);

    const draw = (t) => {
      raf = requestAnimationFrame(draw);
      if (reduced) return;
      const { active: a, getEnergy: ge } = stateRef.current;
      if (!a) return;
      const w = cv.width;
      const h = cv.height;
      ctx.clearRect(0, 0, w, h);
      const en = Math.min(1, Math.max(0.05, ge ? ge() : 0.05));
      const N = Math.floor(w / (8 * devicePixelRatio));
      for (let i = 0; i < N; i++) {
        const osc = Math.sin(t * 0.003 + i * 0.35) * 0.5 + 0.5;
        const bh = Math.max(2, osc * h * 0.85 * en + 2);
        ctx.fillStyle = i % 7 === 0 ? '#8CFF00' : 'rgba(242,242,242,.75)';
        const x = i * 8 * devicePixelRatio;
        const y = (h - bh) / 2;
        ctx.fillRect(x, y, 3 * devicePixelRatio, bh);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas id="wave" ref={ref} />;
}

function Tile({ member, speaking, onDouble }) {
  const letter = (member.name.trim()[0] || 'Г').toUpperCase();
  return (
    <div
      className={'tile' + (speaking ? ' speaking' : '')}
      onDoubleClick={() => onDouble(member.id)}
      title={member.name}
    >
      <div className="avatar">
        {letter}
        <span className="ring"></span>
      </div>
      <div className="pname">{member.name}</div>
      <div className="ptags">
        {member.you && <span className="you">{member.guest ? 'ГОСТЬ' : 'ВЫ'}</span>}
        <span className={'muted' + (member.muted ? ' mic-off' : '')}>
          {member.muted ? 'МУТ' : 'МИК ВКЛ'}
        </span>
      </div>
      <div className="level">
        <i></i>
        <i></i>
        <i></i>
        <i></i>
        <i></i>
      </div>
    </div>
  );
}

export function RoomView({ roomUpper, members, speaking, speakerLabel, latency, onTileDouble, getEnergy, connected }) {
  const isSpeaking = (id) => speaking.includes(id);
  // Ростер ещё не приехал — экран подключения вместо краша на members[0].
  const self = members.find((m) => m.you) || members[0];

  if (!self) {
    return (
      <section id="view-room" className="view active">
        <div className="room-status">
          <span className="dot" title="Подключение"></span>
          <span className="mono" style={{ color: 'var(--text)' }}>
            КОМНАТА: <b style={{ color: 'var(--lime)' }}>{roomUpper}</b>
          </span>
          <span className="count">ПОДКЛЮЧЕНИЕ…</span>
        </div>
      </section>
    );
  }

  const others = members.filter((m) => m.id !== self.id);
  const ordered = [
    self,
    ...others.filter((m) => isSpeaking(m.id)),
    ...others.filter((m) => !isSpeaking(m.id)),
  ];
  const top = ordered.slice(0, 4);
  const rest = ordered.slice(4);

  return (
    <section id="view-room" className="view active">
      <div className="room-status">
        <span className={'dot' + (connected ? '' : ' off')} title={connected ? 'Подключён' : 'Нет соединения'}></span>
        <span className="mono" style={{ color: 'var(--text)' }}>
          КОМНАТА: <b style={{ color: 'var(--lime)' }}>{roomUpper}</b>
        </span>
        <span className="count">{members.length} В СЕТИ</span>
      </div>

      <div className="top4" id="tiles">
        {top.map((m) => (
          <Tile
            key={m.id}
            member={m}
            speaking={isSpeaking(m.id)}
            onDouble={onTileDouble}
          />
        ))}
      </div>

      {rest.length > 0 && (
        <div className="overflow-label mono">
          <span>ЕЩЁ В КОМНАТЕ · {rest.length}</span>
        </div>
      )}
      {rest.length > 0 && (
        <div className="overflow">
          {rest.map((m) => (
            <div
              key={m.id}
              className={'orow' + (isSpeaking(m.id) ? ' speaking' : '')}
              onDoubleClick={() => onTileDouble(m.id)}
              title={m.name}
            >
              {isSpeaking(m.id) && <span className="odot"></span>}
              <span className="oav">{(m.name.trim()[0] || 'Г').toUpperCase()}</span>
              <span className="oname">{m.name}</span>
              <span className={'muted' + (m.muted ? ' mic-off' : '')}>
                {m.muted ? 'МУТ' : 'МИК ВКЛ'}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="wave-panel ticks">
        <div className="wave-head mono">
          <span>ЖИВАЯ ВОЛНА · РЕАГИРУЕТ НА ЗВУК</span>
          <span style={{ color: 'var(--lime)' }}>● ЭФИР</span>
        </div>
        <WaveCanvas active={true} getEnergy={getEnergy} />
      </div>
      <div className="mono" style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between' }}>
        <span>ГОВОРИТ: {speakerLabel}</span>
        <span>ЗАДЕРЖКА {latency > 0 ? latency : '—'}МС · OPUS</span>
      </div>
    </section>
  );
}
