import { useEffect, useRef, useState } from 'react';

// Код комнаты из hash (#fri-09 по умолчанию), синхронизация при hashchange.
export function useRoomCode(def) {
  const read = () =>
    (window.location.hash.replace('#', '') || def).toUpperCase().slice(0, 12);
  const [code, setCode] = useState(read);
  useEffect(() => {
    if (!window.location.hash) {
      history.replaceState(null, '', '#' + def.toLowerCase());
    }
    const onHash = () => setCode(read());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def]);
  return { upper: code, lower: code.toLowerCase() };
}

// Одиночный тост (автоскрытие 1800мс, как в preview.html).
export function useToast() {
  const [text, setText] = useState('');
  const timer = useRef(null);
  const show = (t) => {
    setText(t);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setText(''), 1800);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return { toastText: text, showToast: show };
}

export function vibrate(ms) {
  try {
    navigator.vibrate && navigator.vibrate(ms);
  } catch (_) {
    /* ignore */
  }
}
