// WebRTC mesh + VAD (AudioContext/AnalyserNode) — по AGENTS.md §2 и BACKEND_INTEGRATION.md §4.
// Детерминированные offers: старые пиры офферят новичку (peer-joined), новичок только отвечает.
// Мут = track.enabled без renegotiation. VAD локальный по каждому стриму — без трафика.

const ENTER_TH = 0.05; // порог входа в speaking
const EXIT_TH = 0.03;  // порог выхода (гистерезис)
const TICK_MS = 120;
const REMOTE_GAIN = 1.8; // усиление тихих удалённых микрофонов без ручного клиппинга

export function createVoice({ onStreams, onSpeaking, onEnergy, onError, onConnection }) {
  let audioCtx = null;
  let localStream = null;
  let meId = 'me';
  let sendFn = null;
  let timer = null;
  let destroyed = false;
  let localMuted = false;

  let ice = [{ urls: 'stun:stun.l.google.com:19302' }];
  const pcs = new Map();      // peerId -> RTCPeerConnection
  const remotes = new Map();  // peerId -> MediaStream
  const nodes = new Map();    // 'local'|peerId -> {src, an, buf}
  const remoteAudio = new Map(); // peerId -> {gain, compressor}
  const levels = new Map();   // id -> smoothed 0..1
  const speakingSet = new Set();
  const mutedPeers = new Set();
  const pendingIce = new Map(); // peerId -> [candidates]

  const emitStreams = () => onStreams?.(new Map(remotes));

  function ensureCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function hookAnalyser(key, stream) {
    if (nodes.has(key)) return nodes.get(key);
    const ctx = ensureCtx();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an); // в destination НЕ подключаем — иначе эхо
    const node = { src, an, buf: new Uint8Array(an.fftSize) };
    nodes.set(key, node);
    return node;
  }

  async function init() {
    // iOS/Android: AudioContext живёт только после жеста — страховка от suspend
    const unlock = () => ensureCtx();
    document.addEventListener('pointerdown', unlock, { once: true });
    // Создаём контекст до await getUserMedia, пока join-клик ещё является user gesture.
    ensureCtx();
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      hookAnalyser('local', localStream);
      startLoop();
      return true;
    } catch (_) {
      onError?.('МИК НЕДОСТУПЕН · ТОЛЬКО СЛУШАТЬ');
      startLoop();
      return false;
    }
  }

  function replaceLocalTracks(pc) {
    if (!localStream || !pc.senders) return;
    const tracks = localStream.getAudioTracks();
    tracks.forEach((t, i) => {
      const transceiver = pc.getTransceivers().find(
        (item) => item.receiver?.track?.kind === 'audio' && !item.sender.track
      );
      if (transceiver) {
        transceiver.sender.replaceTrack(t).catch(() => {});
        transceiver.direction = 'sendrecv';
      } else if (!pc.getSenders().some((sender) => sender.track === t)) {
        pc.addTrack(t, localStream);
      }
    });
  }

  function ensurePc(peerId) {
    let pc = pcs.get(peerId);
    if (pc) return pc;
    pc = new RTCPeerConnection({ iceServers: ice });
    pcs.set(peerId, pc);
    if (localStream) {
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
    } else {
      // A listener without microphone must still negotiate a receive-only audio section.
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      console.info('[voice-room] remote track', {
        peerId,
        kind: e.track.kind,
        streamId: stream.id,
        enabled: e.track.enabled,
        muted: e.track.muted,
      });
      remotes.set(peerId, stream);
      const analyserNode = hookAnalyser(peerId, stream);
      const previous = remoteAudio.get(peerId);
      if (previous) {
        try { analyserNode.src.disconnect(previous.gain); } catch (_) {}
        try { previous.gain.disconnect(); } catch (_) {}
        try { previous.compressor.disconnect(); } catch (_) {}
      }
      const gain = ensureCtx().createGain();
      gain.gain.value = REMOTE_GAIN;
      const compressor = ensureCtx().createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 18;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;
      analyserNode.src.connect(gain).connect(compressor).connect(ensureCtx().destination);
      remoteAudio.set(peerId, { gain, compressor });
      emitStreams();
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) sendFn?.({ t: 'ice', to: peerId, candidate: e.candidate.toJSON() });
    };
    const reportState = () => {
      console.info('[voice-room] peer state', {
        peerId,
        connection: pc.connectionState,
        ice: pc.iceConnectionState,
        gathering: pc.iceGatheringState,
        signaling: pc.signalingState,
      });
      onConnection?.(peerId, pc.connectionState);
      if (pc.connectionState === 'failed') {
        onError?.('СВЯЗЬ НЕ УСТАНОВЛЕНА · НУЖЕН TURN');
      }
    };
    pc.onconnectionstatechange = reportState;
    pc.oniceconnectionstatechange = reportState;
    pc.onicegatheringstatechange = reportState;
    pc.onicecandidateerror = (e) => {
      console.warn('[voice-room] ICE candidate error', {
        peerId,
        code: e.errorCode,
        text: e.errorText,
        url: e.url,
      });
    };
    return pc;
  }

  async function offerTo(peerId) {
    try {
      const pc = ensurePc(peerId);
      await pc.setLocalDescription(await pc.createOffer());
      sendFn?.({ t: 'offer', to: peerId, sdp: pc.localDescription });
    } catch (_) { /* peer ушёл */ }
  }

  async function handleOffer(msg) {
    try {
      const pc = ensurePc(msg.from);
      await pc.setRemoteDescription(msg.sdp);
      await flushIce(msg.from, pc);
      await pc.setLocalDescription(await pc.createAnswer());
      sendFn?.({ t: 'answer', to: msg.from, sdp: pc.localDescription });
    } catch (_) { /* ignore */ }
  }

  async function handleAnswer(msg) {
    try {
      const pc = pcs.get(msg.from);
      if (!pc) return;
      await pc.setRemoteDescription(msg.sdp);
      await flushIce(msg.from, pc);
    } catch (_) { /* ignore */ }
  }

  function handleIce(msg) {
    if (!msg.candidate) return;
    const pc = pcs.get(msg.from);
    // ICE может прийти раньше offer из-за async setLocalDescription.
    if (!pc) {
      if (!pendingIce.has(msg.from)) pendingIce.set(msg.from, []);
      pendingIce.get(msg.from).push(msg.candidate);
      return;
    }
    if (!pc.remoteDescription) {
      if (!pendingIce.has(msg.from)) pendingIce.set(msg.from, []);
      pendingIce.get(msg.from).push(msg.candidate);
      return;
    }
    pc.addIceCandidate(msg.candidate).catch(() => {});
  }

  async function flushIce(peerId, pc) {
    const q = pendingIce.get(peerId);
    if (!q) return;
    pendingIce.delete(peerId);
    for (const c of q) await pc.addIceCandidate(c).catch(() => {});
  }

  // после init() доклеить локальные треки в уже созданные PC
  function attachLocal() {
    for (const pc of pcs.values()) replaceLocalTracks(pc);
  }

  function rms(key) {
    const n = nodes.get(key);
    n.an.getByteTimeDomainData(n.buf);
    let s = 0;
    const count = n.buf.length / 4;
    for (let i = 0; i < n.buf.length; i += 4) {
      const v = (n.buf[i] - 128) / 128;
      s += v * v;
    }
    return Math.sqrt(s / count);
  }

  function tick() {
    if (destroyed) return;
    let energy = 0;
    for (const key of nodes.keys()) {
      if (key === 'local' && localMuted) {
        levels.set('local', 0);
        speakingSet.delete(meId);
        continue;
      }
      if (key !== 'local' && mutedPeers.has(key)) {
        levels.set(key, 0);
        speakingSet.delete(key);
        continue;
      }
      if (!nodes.get(key).an) continue;
      const lvl = rms(key);
      const smooth = Math.max(lvl * 3.5, (levels.get(key) || 0) * 0.72); // decay для волны
      levels.set(key, smooth);
      if (smooth > energy) energy = smooth;

      const id = key === 'local' ? meId : key;
      const was = speakingSet.has(id);
      const th = was ? EXIT_TH : ENTER_TH;
      if (smooth > th) speakingSet.add(id);
      else if (was) speakingSet.delete(id);
    }
    for (const id of [...speakingSet]) {
      const key = id === meId ? 'local' : id;
      if (!nodes.has(key)) speakingSet.delete(id);
    }
    onSpeaking?.([...speakingSet]);
    onEnergy?.(Math.min(1, energy));
  }

  function startLoop() {
    if (timer) return;
    timer = setInterval(tick, TICK_MS);
  }

  function setSend(fn) { sendFn = fn; }
  function setMeId(id) {
    // перекладываем 'local' уровни на реальный peer id
    if (meId !== id && levels.has('local')) { levels.set(id, levels.get('local')); levels.delete('local'); }
    meId = id;
  }
  function setIce(servers) { if (Array.isArray(servers) && servers.length) ice = servers; }

  function toggleMute(muted) {
    localMuted = muted;
    if (!localStream) return false;
    localStream.getAudioTracks().forEach((t) => (t.enabled = !muted));
    if (muted) {
      levels.set('local', 0);
      speakingSet.delete(meId);
      onSpeaking?.([...speakingSet]);
    }
    return true;
  }

  function setPeerMuted(peerId, muted) {
    if (muted) mutedPeers.add(peerId);
    else mutedPeers.delete(peerId);
    if (muted) {
      levels.set(peerId, 0);
      speakingSet.delete(peerId);
      onSpeaking?.([...speakingSet]);
    }
  }

  function closePeer(peerId) {
    pcs.get(peerId)?.close();
    pcs.delete(peerId);
    remotes.delete(peerId);
    const n = nodes.get(peerId);
    if (n) { try { n.src.disconnect(); } catch (_) {} nodes.delete(peerId); }
    const audio = remoteAudio.get(peerId);
    if (audio) {
      try { audio.gain.disconnect(); } catch (_) {}
      try { audio.compressor.disconnect(); } catch (_) {}
      remoteAudio.delete(peerId);
    }
    levels.delete(peerId);
    speakingSet.delete(peerId);
    mutedPeers.delete(peerId);
    emitStreams();
  }

  function destroy() {
    destroyed = true;
    clearInterval(timer);
    timer = null;
    for (const pc of pcs.values()) { try { pc.close(); } catch (_) {} }
    pcs.clear();
    localStream?.getTracks().forEach((t) => t.stop());
    localStream = null;
    localMuted = false;
    for (const n of nodes.values()) { try { n.src.disconnect(); } catch (_) {} }
    nodes.clear();
    for (const audio of remoteAudio.values()) {
      try { audio.gain.disconnect(); } catch (_) {}
      try { audio.compressor.disconnect(); } catch (_) {}
    }
    remoteAudio.clear();
    remotes.clear();
    speakingSet.clear();
    mutedPeers.clear();
    try { audioCtx?.close(); } catch (_) {}
    audioCtx = null;
  }

  return {
    init, attachLocal, offerTo, handleOffer, handleAnswer, handleIce, closePeer, destroy,
    setSend, setMeId, setIce, toggleMute, setPeerMuted,
    get speaking() { return [...speakingSet]; },
    get energy() { return Math.min(1, Math.max(...[0, ...levels.values()])); },
  };
}
