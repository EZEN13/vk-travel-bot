import pg from 'pg';
import { config } from '../config/config.js';

const { Pool } = pg;

class Database {
  constructor() {
    this.pool = new Pool({
      host: config.postgres.host,
      port: config.postgres.port,
      database: config.postgres.database,
      user: config.postgres.user,
      password: config.postgres.password
    });
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
      await this.pool.query(
        'DELETE FROM chat_history WHERE created_at < NOW() - INTERVAL $1 DAY',
        [daysToKeep]
      );
      console.log(`Очищена история старше ${daysToKeep} дней`);
    } catch (error) {
      console.error('Ошибка очистки истории:', error.message);
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
