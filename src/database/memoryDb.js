/**
 * In-Memory база данных для тестирования
 * Заменяет PostgreSQL для локальной разработки
 */

class MemoryDatabase {
  constructor() {
    // Map для хранения истории чатов: peer_id -> массив сообщений
    this.chatHistory = new Map();
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
      totalMessages
    };
  }
}

export default new MemoryDatabase();
