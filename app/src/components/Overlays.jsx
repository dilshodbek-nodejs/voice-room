import { useEffect, useRef, useState } from 'react';
import { EMOJIS, STR } from '../content.js';
import { ChatIcon, MicIcon, MicOffIcon, SendIcon, SmileIcon, XIcon } from './icons.jsx';

// ---------- нижняя панель кнопок (только в комнате) ----------
export function Controls({ micOn, unread, onMic, onChat, onEmoji, onLeave }) {
  return (
    <div className="controls" id="controls">
      <div className="controls-inner">
        <button className={'cbtn' + (micOn ? ' mic-on' : '')} id="micBtn" onClick={onMic}>
          {micOn ? <MicIcon /> : <MicOffIcon />}
          <small id="micLabel">{micOn ? 'МИК ВКЛ' : 'МУТ'}</small>
        </button>
        <button className="cbtn" id="chatBtn" onClick={onChat}>
          <ChatIcon />
          <small>ЧАТ</small>
          {unread > 0 && (
            <span className="cbadge" id="unread">
              {unread}
            </span>
          )}
        </button>
        <button className="cbtn" id="emojiBtn" onClick={onEmoji}>
          <SmileIcon />
          <small>ЭМОДЗИ</small>
        </button>
        <button className="cbtn leave" id="leaveBtn" onClick={onLeave}>
          <XIcon />
          <small style={{ color: 'var(--red)' }}>ВЫЙТИ</small>
        </button>
      </div>
    </div>
  );
}

// ---------- чат: снизу-шторка (мобайл) / боковая панель (десктоп ≥900px) ----------
// NOTE(preview): отправка локальная + мок-ответ. В реале: chat{text} по WS,
// сервер ретранслирует комнате, истории нет (макс. последние 20 в памяти).
export function ChatSheet({ open, roomUpper, msgs, onClose, onSend }) {
  const [draft, setDraft] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, open]);

  const send = () => {
    const v = draft.trim();
    if (!v) return;
    onSend(v);
    setDraft('');
  };

  return (
    <div id="chatSheet" className={open ? 'open' : ''}>
      <div className="chat-head">
        <span className="mono" style={{ color: 'var(--text)' }}>
          ЧАТ · <span style={{ color: 'var(--lime)' }}>{roomUpper}</span>
        </span>
        <button
          id="chatClose"
          style={{
            background: 'none',
            border: '1px solid var(--line)',
            color: 'var(--text)',
            padding: '6px 12px',
            minHeight: 44,
          }}
          onClick={onClose}
          aria-label="Закрыть чат"
        >
          <XIcon />
        </button>
      </div>
      <div id="msgs" ref={listRef}>
        {msgs.map((m) => (
          <div key={m.id} className={'msg' + (m.me ? ' me' : '')}>
            <span className="who">{m.who}</span>
            {m.text}
          </div>
        ))}
      </div>
      <div className="chat-input">
        <input
          id="chatIn"
          placeholder={STR.chatPlaceholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
        />
        <button id="sendBtn" onClick={send} aria-label="Отправить">
          <SendIcon />
        </button>
      </div>
    </div>
  );
}

// ---------- эмодзи-панель (не закрывается сама — можно тапать серией) ----------
// NOTE(preview): локальный рендер. В реале: ws.send({t:'react',emoji}) → сервер
// шлёт всем → у всех floatEmoji. Сервер enforced тот же лимит 10с (AGENTS.md §9).
export function EmojiPop({ open, counts, cooling, coolLeft, shakeN, onPick, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !e.target.closest('#emojiBtn')) {
        onClose();
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!shakeN || !ref.current) return;
    const el = ref.current;
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }, [shakeN]);

  if (!open) return null;
  return (
    <div id="emojiPop" ref={ref} className={'open' + (cooling ? ' cool' : '')}>
      <div className="mono pop-head">
        <span>БЫСТРАЯ РЕАКЦИЯ · ВИДНО ВСЕМ</span>
        <span id="coolLabel">{cooling ? 'ЖДИ ' + Math.ceil(coolLeft / 1000) + 'С' : ''}</span>
      </div>
      <div className="grid8" id="emojiGrid">
        {EMOJIS.map((ch) => (
          <EmojiButton key={ch} ch={ch} count={counts[ch] || 0} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

function EmojiButton({ ch, count, onPick }) {
  const [hit, setHit] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      className={hit ? 'hit' : ''}
      onClick={(e) => {
        e.stopPropagation();
        onPick(ch);
        setHit(false);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            setHit(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setHit(false), 320);
          })
        );
      }}
    >
      {ch}
      {count > 0 && <span className="cnt">×{count}</span>}
    </button>
  );
}

// ---------- подтверждение выхода ----------
export function ConfirmLeave({ open, onStay, onLeave }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onStay();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onStay]);

  if (!open) return null;
  return (
    <div className="confirm-overlay" onClick={onStay}>
      <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
        <div className="mono" style={{ color: 'var(--lime)' }}>
          ВЫЙТИ ИЗ КОМНАТЫ?
        </div>
        <p>Точно выйти? Микрофон выключится, остальные останутся в эфире.</p>
        <div className="confirm-btns">
          <button className="confirm-stay" onClick={onStay} autoFocus>
            ОСТАТЬСЯ
          </button>
          <button className="confirm-leave" onClick={onLeave}>
            ВЫЙТИ
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- слой эффектов: летящие эмодзи + взрыв по тапу + вспышка + лента ----------
export function FxLayer({ floats, onRemoveFloat, big, feed }) {
  const [minis, setMinis] = useState([]);
  const miniSeq = useRef(1);

  const explode = (id, ch, x, y) => {
    const parts = [];
    for (let i = 0; i < 7; i++) {
      const a = (Math.PI * 2 * i) / 7 + Math.random() * 0.5;
      const dist = 50 + Math.random() * 70;
      parts.push({
        id: miniSeq.current++,
        ch,
        x,
        y,
        size: 14 + Math.random() * 22,
        mx: Math.cos(a) * dist + 'px',
        my: Math.sin(a) * dist + 'px',
      });
    }
    setMinis((prev) => [...prev, ...parts]);
    const dead = new Set(parts.map((p) => p.id));
    setTimeout(() => setMinis((prev) => prev.filter((p) => !dead.has(p.id))), 750);
    onRemoveFloat(id);
  };

  return (
    <>
      <div id="floatLayer">
        {floats.map((f) => (
          <span
            key={f.id}
            className="float-e"
            style={{
              fontSize: f.size + 'px',
              left: f.left,
              '--dx': f.dx,
              '--rot': f.rot,
              '--dur': f.dur,
              animationDelay: f.delay,
            }}
            onPointerDown={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              explode(f.id, f.ch, r.left + r.width / 2, r.top + r.height / 2);
            }}
          >
            {f.ch}
          </span>
        ))}
        {minis.map((m) => (
          <span
            key={m.id}
            className="mini"
            style={{
              left: m.x + 'px',
              top: m.y + 'px',
              fontSize: m.size + 'px',
              '--mx': m.mx,
              '--my': m.my,
            }}
          >
            {m.ch}
          </span>
        ))}
      </div>
      {big && (
        <div
          id="bigReact"
          key={big.key}
          className="show"
          style={{ fontSize: 110 + Math.min(big.power, 6) * 14 + 'px' }}
        >
          {big.ch}
        </div>
      )}
      <div id="reactFeed">
        {feed.map((it) => (
          <div key={it.id} className={'feed-item' + (it.out ? ' out' : '')}>
            <span>{it.ch}</span>
            <b>{it.who}</b>
          </div>
        ))}
      </div>
    </>
  );
}
