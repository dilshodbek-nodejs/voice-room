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

export { STR };
