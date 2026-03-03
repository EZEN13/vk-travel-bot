/**
 * Дебаунс входящих сообщений — склеивает несколько сообщений от одного пользователя
 * в одно, если они приходят с интервалом меньше DEBOUNCE_MS.
 *
 * КАК ОТКАТИТЬ:
 * 1. В index.js убрать импорт: import messageDebouncer from './utils/debounce.js';
 * 2. В index.js убрать вызов: messageDebouncer.add(...) и вернуть прямую обработку
 * 3. Или просто поставить DEBOUNCE_MS = 0
 */

// Задержка в миллисекундах (0 = дебаунс выключен)
const DEBOUNCE_MS = 2000;

class MessageDebouncer {
  constructor() {
    // Map<peerId, { messages: string[], timer: NodeJS.Timeout, userData: object }>
    this.pending = new Map();
  }

  /**
   * Добавить сообщение в очередь дебаунса.
   * callback вызовется через DEBOUNCE_MS с объединённым текстом.
   */
  add(peerId, messageText, userData, callback) {
    // Если дебаунс выключен — сразу вызываем callback
    if (DEBOUNCE_MS === 0) {
      callback(messageText, userData);
      return;
    }

    const existing = this.pending.get(peerId);

    if (existing) {
      // Уже есть ожидающие сообщения — добавляем и сбрасываем таймер
      existing.messages.push(messageText);
      clearTimeout(existing.timer);
      existing.timer = setTimeout(() => {
        this.flush(peerId, callback);
      }, DEBOUNCE_MS);
    } else {
      // Первое сообщение — создаём запись с таймером
      this.pending.set(peerId, {
        messages: [messageText],
        userData: userData,
        timer: setTimeout(() => {
          this.flush(peerId, callback);
        }, DEBOUNCE_MS)
      });
    }
  }

  /**
   * Отправить накопленные сообщения
   */
  flush(peerId, callback) {
    const entry = this.pending.get(peerId);
    if (!entry) return;

    this.pending.delete(peerId);

    // Склеиваем все сообщения в одно
    const combinedText = entry.messages.join('\n');
    callback(combinedText, entry.userData);
  }
}

export default new MessageDebouncer();
