/**
 * In-Memory база данных для тестирования
 * Заменяет PostgreSQL для локальной разработки
 */

class MemoryDatabase {
  constructor() {
    // Map для хранения истории чатов: peer_id -> массив сообщений
    this.chatHistory = new Map();
    // Map для хранения пауз бота: peer_id -> { pausedAt, reason }
    this.pausedChats = new Map();
    // Set для отслеживания ID сообщений бота (чтобы отличить бота от менеджера)
    this.botMessageIds = new Set();
    console.log('💾 Используется In-Memory база данных (данные не сохраняются при перезапуске)');
  }

  /**
   * Инициализация базы данных
   */
  async init() {
    console.log('✅ In-Memory база данных инициализирована');
    return Promise.resolve();
  }

  /**
   * Сохранить сообщение в историю
   */
  async saveMessage(peerId, role, content) {
    try {
      if (!this.chatHistory.has(peerId)) {
        this.chatHistory.set(peerId, []);
      }

      const messages = this.chatHistory.get(peerId);
      messages.push({
        role,
        content,
        timestamp: new Date()
      });

      console.log(`💾 Сохранено сообщение от ${role} для peer_id=${peerId}`);
    } catch (error) {
      console.error('Ошибка сохранения сообщения:', error.message);
      throw error;
    }
  }

  /**
   * Получить историю чата (последние N сообщений)
   */
  async getChatHistory(peerId, limit = 20) {
    try {
      if (!this.chatHistory.has(peerId)) {
        return [];
      }

      const messages = this.chatHistory.get(peerId);

      // Берём последние N сообщений
      const recentMessages = messages.slice(-limit);

      // Возвращаем в формате совместимом с PostgreSQL
      return recentMessages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));
    } catch (error) {
      console.error('Ошибка получения истории чата:', error.message);
      return [];
    }
  }

  /**
   * Поставить бота на паузу для конкретного чата
   */
  async pauseBot(peerId, reason = 'manager') {
    this.pausedChats.set(peerId, { pausedAt: new Date(), reason });
    console.log(`⏸️ Бот на паузе для peer_id=${peerId} (причина: ${reason})`);
  }

  /**
   * Возобновить работу бота для конкретного чата
   */
  async resumeBot(peerId) {
    this.pausedChats.delete(peerId);
    console.log(`▶️ Бот возобновлён для peer_id=${peerId}`);
  }

  /**
   * Проверить, на паузе ли бот для конкретного чата
   * Авто-возобновление через 48 часов
   */
  async isBotPaused(peerId) {
    const pause = this.pausedChats.get(peerId);
    if (!pause) return false;

    // Авто-возобновление через 48 часов
    const hours = (Date.now() - pause.pausedAt.getTime()) / (1000 * 60 * 60);
    if (hours > 48) {
      this.pausedChats.delete(peerId);
      console.log(`⏰ Авто-возобновление бота для peer_id=${peerId} (прошло ${Math.round(hours)}ч)`);
      return false;
    }

    return true;
  }

  /**
   * Запомнить ID сообщения отправленного ботом
   */
  trackBotMessage(messageId) {
    this.botMessageIds.add(messageId);
    // Чистим старые — храним последние 500
    if (this.botMessageIds.size > 1000) {
      const arr = [...this.botMessageIds];
      this.botMessageIds = new Set(arr.slice(-500));
    }
  }

  /**
   * Проверить, является ли сообщение отправленным ботом
   */
  isBotMessage(messageId) {
    return this.botMessageIds.has(messageId);
  }

  /**
   * Очистить старую историю (для in-memory просто логируем)
   */
  async cleanOldHistory(daysToKeep = 30) {
    console.log(`🗑️  In-Memory режим: очистка истории пропущена (данные и так в памяти)`);
  }

  /**
   * Закрыть соединение с БД (для in-memory ничего не делаем)
   */
  async close() {
    console.log('👋 In-Memory база данных закрыта');
    this.chatHistory.clear();
    this.pausedChats.clear();
    this.botMessageIds.clear();
  }

  /**
   * Получить статистику (для отладки)
   */
  getStats() {
    const totalChats = this.chatHistory.size;
    let totalMessages = 0;

    for (const messages of this.chatHistory.values()) {
      totalMessages += messages.length;
    }

    return {
      totalChats,
      totalMessages,
      pausedChats: this.pausedChats.size,
      trackedBotMessages: this.botMessageIds.size
    };
  }
}

export default new MemoryDatabase();
