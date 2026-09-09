import { Room, RoomEvent, Track } from 'livekit-client';

// Тонкая обвязка LiveKit: транспорт голоса, speaking через activeSpeakers,
// энергия волны через AnalyserNode (без вывода в destination — эха нет).
// Проигрывание удалённых треков — track.attach() (управляет autoplay сам).

const TICK_MS = 120;
const REMOTE_GAIN = 1; // анализ only; громкость — системная + усиление собеседника в его ОС

export function createSfu({ onSpeakers, onEnergy, onError }) {
  let room = null;
  let ctx = null;
  let timer = null;
  let destroyed = false;
  const analysers = new Map(); // trackSid -> {an, buf}
  const levels = new Map(); // trackSid -> 0..1

  function ensureCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // Создаём контекст синхронно в жесте «ВОЙТИ», чтобы мобильный Safari не suspend'ил.
  ensureCtx();
  const unlock = () => ensureCtx();
  document.addEventListener('pointerdown', unlock, { once: true });

  function hookTrack(track) {
    if (analysers.has(track.sid)) return;
    try {
      const c = ensureCtx();
      const src = c.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
      const an = c.createAnalyser();
      an.fftSize = 512;
      src.connect(an); // в destination НЕ подключаем
      analysers.set(track.sid, { src, an, buf: new Uint8Array(an.fftSize) });
    } catch (_) {
      /* ignore */
    }
  }

  function unhookTrack(track) {
    const n = analysers.get(track.sid);
    if (n) {
      try {
        n.src.disconnect();
      } catch (_) {}
      analysers.delete(track.sid);
    }
    levels.delete(track.sid);
  }

  function tick() {
    if (destroyed) return;
    let energy = 0;
    for (const [sid, n] of analysers) {
      n.an.getByteTimeDomainData(n.buf);
      let s = 0;
      const count = n.buf.length / 4;
      for (let i = 0; i < n.buf.length; i += 4) {
        const v = (n.buf[i] - 128) / 128;
        s += v * v;
      }
      const lvl = Math.sqrt(s / count);
      const smooth = Math.max(lvl * 3.5, (levels.get(sid) || 0) * 0.72);
      levels.set(sid, smooth);
      if (smooth > energy) energy = smooth;
    }
    onEnergy?.(Math.min(1, energy));
  }

  async function connect(url, token) {
    room = new Room({ adaptiveStream: true, dynacast: true });

    room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      if (track.kind !== Track.Kind.Audio) return;
      hookTrack(track);
      try {
        track.attach(); // LiveKit создаёт и проигрывает <audio> сам
      } catch (_) {}
      void participant;
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => unhookTrack(track));
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      onSpeakers?.(speakers.map((p) => p.identity));
    });
    room.on(RoomEvent.Disconnected, () => onError?.('SFU СОЕДИНЕНИЕ ЗАКРЫТО'));

    await room.connect(url, token);
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch (_) {
      onError?.('МИК НЕДОСТУПЕН · ТОЛЬКО СЛУШАТЬ');
      return { room, mic: false };
    }
    const micPub = [...room.localParticipant.audioTrackPublications.values()][0];
    if (micPub?.audioTrack) hookTrack(micPub.audioTrack);
    timer = setInterval(tick, TICK_MS);
    return { room, mic: true };
  }

  async function setMicrophoneEnabled(on) {
    if (!room) return false;
    try {
      await room.localParticipant.setMicrophoneEnabled(on);
      return true;
    } catch (_) {
      return false;
    }
  }

  function disconnect() {
    destroyed = true;
    if (timer) clearInterval(timer);
    timer = null;
    try {
      room?.disconnect();
    } catch (_) {}
    room = null;
    for (const n of analysers.values()) {
      try {
        n.src.disconnect();
      } catch (_) {}
    }
    analysers.clear();
    levels.clear();
    document.removeEventListener('pointerdown', unlock);
    try {
      ctx?.close();
    } catch (_) {}
    ctx = null;
  }

  return { connect, setMicrophoneEnabled, disconnect, get energy() {
    return 0;
  } };
}

export { REMOTE_GAIN };
