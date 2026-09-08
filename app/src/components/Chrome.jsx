import { STR } from '../content.js';

export function Toast({ text }) {
  return (
    <div id="toast" className={text ? 'show' : ''}>
      {text || ' '}
    </div>
  );
}

import { ShareIcon } from './icons.jsx';

export function TopBar({ roomLower, onShare }) {
  return (
    <div className="topbar">
      <div className="brand">
        VOICE<span>_ROOM</span>
      </div>
      <button className="cbtn-small" id="shareBtn" onClick={onShare} aria-label="Поделиться комнатой">
        <ShareIcon />
      </button>
    </div>
  );
}

export function ViewSwitch({ view, onJoin, onRoom }) {
  return (
    <div className="view-switch">
      <button id="swJoin" className={view === 'join' ? 'on' : ''} onClick={onJoin}>
        01 ВХОД
      </button>
      <button id="swRoom" className={view === 'room' ? 'on' : ''} onClick={onRoom}>
        02 КОМНАТА
      </button>
    </div>
  );
}

export { STR };
