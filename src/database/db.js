import pg from 'pg';
import { config } from '../config/config.js';

const { Pool } = pg;

class Database {
  constructor() {
    // Если есть DATABASE_URL - используем его (Railway/Heroku)
    // Иначе используем отдельные параметры (локальная разработка)
    if (config.postgres.connectionString) {
      this.pool = new Pool({
        connectionString: config.postgres.connectionString,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
      });
    } else {
      this.pool = new Pool({
        host: config.postgres.host,
        port: config.postgres.port,
        database: config.postgres.database,
        user: config.postgres.user,
        password: config.postgres.password
      });
    }
  }

  /**
   * Инициализация базы данных
   */
  async init() {
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS chat_history (
          id SERIAL PRIMARY KEY,
          peer_id VARCHAR(255) NOT NULL,
          role VARCHAR(50) NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_peer_id ON chat_history(peer_id);
        CREATE INDEX IF NOT EXISTS idx_created_at ON chat_history(created_at);

        CREATE TABLE IF NOT EXISTS paused_chats (
          peer_id VARCHAR(255) PRIMARY KEY,
          paused_by VARCHAR(50) NOT NULL,
          paused_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS bot_messages (
          message_id VARCHAR(255) PRIMARY KEY,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      console.log('База данных инициализирована');
    } catch (error) {
      console.error('Ошибка инициализации базы данных:', error.message);
      throw error;
    }
  }

  /**
   * Сохранить сообщение в историю
   */
  async saveMessage(peerId, role, content) {
    try {
      await this.pool.query(
        'INSERT INTO chat_history (peer_id, role, content) VALUES ($1, $2, $3)',
        [peerId, role, content]
      );
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
      const result = await this.pool.query(
        `SELECT role, content
         FROM chat_history
         WHERE peer_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [peerId, limit]
      );

      // Переворачиваем массив, чтобы сообщения шли в хронологическом порядке
      return result.rows.reverse().map(row => ({
        role: row.role,
        content: row.content
      }));
    } catch (error) {
      console.error('Ошибка получения истории чата:', error.message);
      return [];
    }
  }

  /**
   * Очистить старую историю (старше N дней)
   */
  async cleanOldHistory(daysToKeep = 30) {
    try {
      const intervalString = `${daysToKeep} days`;
      await this.pool.query(
        `DELETE FROM chat_history WHERE created_at < NOW() - INTERVAL '${intervalString}'`
      );
      console.log(`Очищена история старше ${daysToKeep} дней`);
    } catch (error) {
      console.error('Ошибка очистки истории:', error.message);
    }
  }

  /**
   * Поставить бота на паузу для чата
   */
  async pauseBot(peerId, pausedBy = 'manager') {
    try {
      await this.pool.query(
        'INSERT INTO paused_chats (peer_id, paused_by) VALUES ($1, $2) ON CONFLICT (peer_id) DO UPDATE SET paused_by = $2, paused_at = CURRENT_TIMESTAMP',
        [peerId, pausedBy]
      );
      console.log(`⏸️ Бот на паузе для peer_id=${peerId} (причина: ${pausedBy})`);
    } catch (error) {
      console.error('Ошибка паузы бота:', error.message);
    }
  }

  /**
   * Снять бота с паузы
   */
  async resumeBot(peerId) {
    try {
      await this.pool.query(
        'DELETE FROM paused_chats WHERE peer_id = $1',
        [peerId]
      );
      console.log(`▶️ Бот возобновлён для peer_id=${peerId}`);
    } catch (error) {
      console.error('Ошибка возобновления бота:', error.message);
    }
  }

  /**
   * Проверить, на паузе ли бот для чата
   */
  async isBotPaused(peerId) {
    try {
      const result = await this.pool.query(
        'SELECT * FROM paused_chats WHERE peer_id = $1',
        [peerId]
      );

      if (result.rows.length === 0) {
        return false;
      }

      const pausedAt = new Date(result.rows[0].paused_at);
      const now = new Date();
      const hoursPassed = (now - pausedAt) / (1000 * 60 * 60);

      // Автоматически снимаем паузу через 48 часов
      if (hoursPassed >= 48) {
        await this.resumeBot(peerId);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Ошибка проверки паузы бота:', error.message);
      return false;
    }
  }

  /**
   * Отметить сообщение как отправленное ботом
   */
  async trackBotMessage(messageId) {
    try {
      await this.pool.query(
        'INSERT INTO bot_messages (message_id) VALUES ($1) ON CONFLICT (message_id) DO NOTHING',
        [messageId.toString()]
      );
    } catch (error) {
      console.error('Ошибка трекинга сообщения бота:', error.message);
    }
  }

  /**
   * Проверить, является ли сообщение сообщением бота
   */
  async isBotMessage(messageId) {
    try {
      const result = await this.pool.query(
        'SELECT * FROM bot_messages WHERE message_id = $1',
        [messageId.toString()]
      );
      return result.rows.length > 0;
    } catch (error) {
      console.error('Ошибка проверки сообщения бота:', error.message);
      return false;
    }
  }

  /**
   * Закрыть соединение с БД
   */
  async close() {
    await this.pool.end();
  }
}

export default new Database();
