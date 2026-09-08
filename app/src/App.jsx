import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { config } from './config.js';
import { useRoomCode, useToast, vibrate } from './hooks.js';
import { createRealtime } from './realtime.js';
import { createVoice } from './webrtc.js';
import { Toast, TopBar } from './components/Chrome.jsx';
import { JoinView } from './components/JoinView.jsx';
import { RoomView } from './components/RoomView.jsx';
import { ChatSheet, ConfirmLeave, Controls, EmojiPop, FxLayer } from './components/Overlays.jsx';

let seq = 1;
const nid = () => 'm' + seq++;

export default function App() {
  const { upper: roomUpper, lower: roomLower } = useRoomCode(config.roomDefault);
  const { toastText, showToast } = useToast();

  const [view, setView] = useState('join');
  const [nameInput, setNameInput] = useState(() => localStorage.getItem(config.storageKey) || '');
  const [myName, setMyName] = useState('');
  const [micOn, setMicOn] = useState(true);
  const [connected, setConnected] = useState(false);
  const [members, setMembers] = useState([]);
  const [speaking, setSpeaking] = useState([]);
  const [msgs, setMsgs] = useState([]);
  const [unread, setUnread] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [popOpen, setPopOpen] = useState(false);
  const [latency, setLatency] = useState(0);
  const [remoteStreams, setRemoteStreams] = useState(() => new Map());

  const rtRef = useRef(null);
  const voiceRef = useRef(null);
  const meIdRef = useRef(null);
  const voiceReadyRef = useRef(null);
  const energyRef = useRef(0);
  const chatOpenRef = useRef(false);
  chatOpenRef.current = chatOpen;

  const nameById = useMemo(() => {
    const map = {};
    members.forEach((m) => (map[m.id] = m.name));
    return map;
  }, [members]);

  // Кулдаун-тик 250мс (UX; сервер — источник истины).
  const [coolLeft, setCoolLeft] = useState(0);
  const [lastReactAt, setLastReactAt] = useState(0);
  useEffect(() => {
    if (!lastReactAt) return;
    const iv = setInterval(() => {
      const left = Math.max(0, config.emojiCooldownMs - (Date.now() - lastReactAt));
      setCoolLeft(left);
      if (left <= 0) clearInterval(iv);
    }, 250);
    return () => clearInterval(iv);
  }, [lastReactAt]);

  // --- визуал реакции (свои и чужие) ---
  const [counts, setCounts] = useState({});
  const [shakeN, setShakeN] = useState(0);
  const comboRef = useRef({ lastCh: '', combo: 0, lastT: 0 });
  const [floats, setFloats] = useState([]);
  const [big, setBig] = useState(null);
  const [feed, setFeed] = useState([]);
  const floatSeq = useRef(1);

  const renderReaction = useCallback((ch, whoLabel) => {
    const c = comboRef.current;
    const now = Date.now();
    c.combo = ch === c.lastCh && now - c.lastT < config.comboWindowMs ? c.combo + 1 : 0;
    c.lastCh = ch;
    c.lastT = now;

    const n = 4 + Math.min(c.combo, 5);
    const batch = [];
    for (let k = 0; k < n; k++) {
      batch.push({
        id: floatSeq.current++,
        ch,
        size: 34 + Math.random() * 40 + Math.min(c.combo, 6) * 4,
        left: 12 + Math.random() * 72 + 'vw',
        dx: Math.random() * 120 - 60 + 'px',
        rot: Math.random() * 60 - 30 + 'deg',
        dur: 1.8 + Math.random() * 0.9 + 's',
        delay: k * 0.12 + 's',
      });
    }
    setFloats((prev) => [...prev, ...batch]);
    const dead = new Set(batch.map((f) => f.id));
    setTimeout(() => setFloats((prev) => prev.filter((f) => !dead.has(f.id))), 3400);

    const key = now;
    setBig({ ch, power: c.combo, key });
    setTimeout(() => setBig((prev) => (prev && prev.key === key ? null : prev)), 950);

    const fid = nid();
    setFeed((prev) => [{ id: fid, ch, who: whoLabel.slice(0, 8), out: false }, ...prev].slice(0, 5));
    setTimeout(() => setFeed((prev) => prev.map((it) => (it.id === fid ? { ...it, out: true } : it))), 2600);
    setTimeout(() => setFeed((prev) => prev.filter((it) => it.id !== fid)), 3100);
  }, []);

  // --- teardown ---
  const teardown = useCallback(() => {
    voiceRef.current?.destroy();
    voiceRef.current = null;
    if (rtRef.current?.pingLoop) clearInterval(rtRef.current.pingLoop);
    rtRef.current?.close();
    rtRef.current = null;
    setConnected(false);
    setMembers([]);
    setSpeaking([]);
    setRemoteStreams(new Map());
    setLatency(0);
  }, []);

  useEffect(
    () => () => {
      voiceRef.current?.destroy();
      if (rtRef.current?.pingLoop) clearInterval(rtRef.current.pingLoop);
      rtRef.current?.close();
    },
    []
  );

  // --- realtime + voice: старт после «ВОЙТИ» (жест пользователя → можно getUserMedia) ---
  const startSession = useCallback(
    (name) => {
      teardown();

      const voice = createVoice({
        onStreams: (map) => setRemoteStreams(map),
        onSpeaking: (ids) => setSpeaking(ids),
        onEnergy: (e) => (energyRef.current = e),
        onError: (m) => showToast(m),
      });
      voiceRef.current = voice;
      voice.setSend((obj) => rtRef.current?.send(obj));
      micOnRef.current = true;
      setMicOn(true);
      voiceReadyRef.current = voice.init().then((ok) => {
        if (!ok) setMicOn(false); // микродоступ запрещён → честный бейдж МУТ
        return ok;
      });

      rtRef.current = createRealtime({
        name,
        room: roomLower,
        onOpen: (rt) => {
          setConnected(true);
          showToast('ПОДКЛЮЧЁН · ' + roomUpper);
          rt.pingLoop = setInterval(() => rt.send({ t: 'ping', ts: Date.now() }), 3000);
        },
        onClose: () => {
          if (viewRef.current === 'room') showToast('СОЕДИНЕНИЕ ПОТЕРЯНО · ПЕРЕЗАХОДИ');
          setConnected(false);
        },
        onMessage: (msg) => {
          switch (msg.t) {
            case 'roster': {
              meIdRef.current = msg.you.id;
              voice.setMeId(msg.you.id);
              voice.setIce(msg.iceServers);
              setMembers([{ ...msg.you, you: true }, ...msg.peers]);
              setSpeaking([]);
              // новичок: PC ко всем существующим (отвечает на их offers)
              voiceReadyRef.current?.then(() => voice.attachLocal());
              for (const p of msg.peers) {
                voiceReadyRef.current?.then(() => {
                  // PC создаётся лениво при ответе на offer — здесь не офферим
                });
              }
              break;
            }
            case 'peer-joined': {
              setMembers((prev) => [...prev, msg.peer]);
              showToast('ПРИСОЕДИНИЛСЯ · ' + (msg.peer.name || '').toUpperCase());
              // старый пир → офферим новичку (deterministic)
              voiceReadyRef.current?.then(() => voice.offerTo(msg.peer.id));
              break;
            }
            // WebRTC сигналинг (relay с сервера) — БЕЗ ЭТОГО МЕШ НЕ СОБИРАЕТСЯ
            case 'offer':
              voiceReadyRef.current?.then(() => voice.handleOffer(msg));
              break;
            case 'answer':
              voiceReadyRef.current?.then(() => voice.handleAnswer(msg));
              break;
            case 'ice':
              voice.handleIce(msg); // ранние кандидаты буферизуются внутри (pendingIce)
              break;
            case 'peer-left': {
              setMembers((prev) => prev.filter((m) => m.id !== msg.peerId));
              voice.closePeer(msg.peerId);
              break;
            }
            case 'peer-state':
              setMembers((prev) =>
                prev.map((m) => (m.id === msg.peerId ? { ...m, muted: msg.muted } : m))
              );
              break;
            case 'chat': {
              const label = (msg.fromName || 'ГОСТЬ').toUpperCase() + ' · СЕЙЧАС';
              setMsgs((prev) => [
                ...prev.slice(-19),
                { id: nid(), who: label, text: msg.text, me: !!msg.me },
              ]);
              if (!msg.me && !chatOpenRef.current) setUnread((u) => u + 1);
              break;
            }
            case 'react':
              renderReaction(msg.emoji, (msg.fromName || 'Гость').toUpperCase());
              setCounts((prev) => ({ ...prev, [msg.emoji]: (prev[msg.emoji] || 0) + 1 }));
              break;
            case 'pong':
              if (msg.ts) setLatency(Math.max(1, Date.now() - msg.ts));
              break;
            case 'error':
              if (msg.code === 'RATE_LIMIT' && typeof msg.waitMs === 'number') {
                setLastReactAt(Date.now() - (config.emojiCooldownMs - msg.waitMs));
                setCoolLeft(msg.waitMs);
                setShakeN((n) => n + 1);
                vibrate(40);
              }
              showToast((msg.message || 'ОШИБКА').toUpperCase());
              break;
            default:
              break;
          }
        },
      });
    },
    [roomLower, roomUpper, showToast, renderReaction, teardown]
  );

  const viewRef = useRef(view);
  viewRef.current = view;

  // --- вход (идемпотентно: двойной клик/Enter не должны открывать второй WS) ---
  const joiningRef = useRef(false);
  const doJoin = useCallback(() => {
    if (joiningRef.current || viewRef.current === 'room') return;
    joiningRef.current = true;
    const raw = nameInput.trim();
    let finalName = raw;
    if (!raw) {
      finalName = 'Гость-' + Math.floor(1000 + Math.random() * 9000);
    } else {
      localStorage.setItem(config.storageKey, raw);
    }
    setMyName(finalName);
    setMsgs([]);
    setUnread(0);
    setCounts({});
    setView('room');
    showToast('ВОШЁЛ КАК ' + finalName.toUpperCase());
    startSession(finalName);
  }, [nameInput, showToast, startSession]);

  // --- мик ---
  const micOnRef = useRef(true);
  const toggleMic = useCallback(() => {
    if (!voiceRef.current) return;
    const next = !micOnRef.current;
    const ok = voiceRef.current.toggleMute(next);
    if (!ok) {
      showToast('НЕТ МИКРОФОНА');
      return;
    }
    micOnRef.current = next;
    setMicOn(next);
    showToast(next ? 'МИК ВКЛ' : 'МИК ВЫКЛ');
    rtRef.current?.state(!next); // бейдж у остальных через peer-state
    setMembers((prev) => prev.map((m) => (m.id === meIdRef.current ? { ...m, muted: !next } : m)));
  }, [showToast]);

  // --- выход ---
  const leave = useCallback(() => {
    setConfirmOpen(false);
    joiningRef.current = false;
    rtRef.current?.leave();
    teardown();
    setView('join');
    setPopOpen(false);
    setChatOpen(false);
    showToast('ВЫШЕЛ ИЗ КОМНАТЫ');
  }, [showToast, teardown]);

  const sendChat = useCallback((text) => {
    rtRef.current?.chat(text);
  }, []);

  const openChat = useCallback(() => {
    setChatOpen(true);
    setUnread(0);
  }, []);

  const shareRoom = useCallback(async () => {
    const url = window.location.origin + window.location.pathname + '#' + roomLower;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'VOICE ROOM', text: 'Заходи в голосовую комнату', url });
        return;
      }
      throw new Error('no-share');
    } catch (e) {
      if (e && e.name === 'AbortError') return; // юзер закрыл системную шторку
      try {
        await navigator.clipboard.writeText(url);
        showToast('ССЫЛКА СКОПИРОВАНА · ' + roomUpper);
      } catch (_) {
        showToast(url); // крайний случай — хоть что-то показать
      }
    }
  }, [roomLower, roomUpper, showToast]);

  // --- эмодзи: отправка ---
  const sendReact = useCallback(
    (ch) => {
      const left = Math.max(0, config.emojiCooldownMs - (Date.now() - lastReactAt));
      if (left > 0) {
        setShakeN((n) => n + 1);
        showToast('ЛИМИТ · ЖДИ ' + Math.ceil(left / 1000) + 'С');
        vibrate(40);
        return;
      }
      setLastReactAt(Date.now());
      setCoolLeft(config.emojiCooldownMs);
      setCounts((prev) => ({ ...prev, [ch]: (prev[ch] || 0) + 1 }));
      renderReaction(ch, (myName || 'Гость').toUpperCase());
      vibrate(20);
      rtRef.current?.react(ch);
    },
    [lastReactAt, myName, showToast, renderReaction]
  );

  const removeFloat = useCallback((id) => {
    setFloats((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const tileDouble = useCallback(
    (id) => {
      sendReact('❤️');
      setSpeaking((s) => (s.includes(id) ? s : [...s, id]));
      setTimeout(() => setSpeaking((s) => s.filter((x) => x !== id)), 800);
    },
    [sendReact]
  );

  const speakerLabel = useMemo(() => {
    const other = speaking.find((id) => id !== meIdRef.current && nameById[id]);
    if (other) return nameById[other].toUpperCase();
    if (meIdRef.current && speaking.includes(meIdRef.current)) return (myName || 'Гость').toUpperCase();
    return '—';
  }, [speaking, nameById, myName]);

  return (
    <>
      <Toast text={toastText} />
      <div className="wrap">
        <TopBar roomLower={roomLower} onShare={shareRoom} />
        {view === 'join' ? (
          <JoinView
            roomLower={roomLower}
            roomUpper={roomUpper}
            online={Math.max(1, members.length)}
            name={nameInput}
            setName={setNameInput}
            onJoin={doJoin}
          />
        ) : (
          <RoomView
            roomUpper={roomUpper}
            members={members}
            speaking={speaking}
            speakerLabel={speakerLabel}
            latency={latency}
            onTileDouble={tileDouble}
            getEnergy={() => energyRef.current}
            connected={connected}
          />
        )}
      </div>

      {view === 'room' && (
        <Controls
          micOn={micOn}
          unread={unread}
          onMic={toggleMic}
          onChat={openChat}
          onEmoji={() => setPopOpen((o) => !o)}
          onLeave={() => setConfirmOpen(true)}
        />
      )}

      <EmojiPop
        open={popOpen && view === 'room'}
        counts={counts}
        cooling={coolLeft > 0}
        coolLeft={coolLeft}
        shakeN={shakeN}
        onPick={sendReact}
        onClose={() => setPopOpen(false)}
      />
      <ChatSheet
        open={chatOpen && view === 'room'}
        roomUpper={roomUpper}
        msgs={msgs}
        onClose={() => setChatOpen(false)}
        onSend={sendChat}
      />
      <FxLayer floats={floats} onRemoveFloat={removeFloat} big={big} feed={feed} />
      <ConfirmLeave open={confirmOpen} onStay={() => setConfirmOpen(false)} onLeave={leave} />
      <RemoteAudios streams={remoteStreams} />
    </>
  );
}

// Скрытые <audio> для голоса остальных пиров.
function RemoteAudios({ streams }) {
  const refs = useRef(new Map());
  useEffect(() => {
    for (const [id, stream] of streams) {
      const el = refs.current.get(id);
      if (el && el.srcObject !== stream) {
        el.srcObject = stream;
        el.play().catch(() => {
          const resume = () => {
            el.play().catch(() => {});
            document.removeEventListener('pointerdown', resume);
          };
          document.addEventListener('pointerdown', resume, { once: true });
        });
      }
    }
  }, [streams]);
  return (
    <div hidden aria-hidden="true">
      {[...streams.keys()].map((id) => (
        <audio key={id} ref={(el) => refs.current.set(id, el)} autoPlay playsInline />
      ))}
    </div>
  );
}
