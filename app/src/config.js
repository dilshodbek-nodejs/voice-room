// Конфиг без хардкода (AGENTS.md §2): значения можно переопределить через .env (VITE_*).
// NOTE(preview): сейчас всё мок. В реале сюда добавятся PORT, cert-пути, ICE-серверы.
export const config = {
  roomDefault: import.meta.env.VITE_ROOM_DEFAULT || 'fri-09',
  emojiCooldownMs: Number(import.meta.env.VITE_EMOJI_COOLDOWN_MS) || 10000,
  comboWindowMs: 1500,
  maxNameLen: 20,
  storageKey: 'vr_name',
};
