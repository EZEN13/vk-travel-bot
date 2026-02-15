import axios from 'axios';
import { config } from '../config/config.js';

class VKService {
  constructor() {
    this.baseUrl = 'https://api.vk.com/method';
    this.accessToken = config.vk.accessToken;
    this.apiVersion = config.vk.apiVersion;
  }

  /**
   * Повторить запрос при ошибке с экспоненциальной задержкой
   */
  async retryRequest(fn, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const isLastAttempt = attempt === maxRetries;
        const isRetryableError =
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT' ||
          error.code === 'ECONNABORTED' ||
          error.code === 'ECONNREFUSED' ||
          (error.response && error.response.status >= 500);

        if (isLastAttempt || !isRetryableError) {
          throw error;
        }

        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, attempt - 1) * 1000;
        console.log(`⚠️  VK API ошибка (попытка ${attempt}/${maxRetries}), повтор через ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Получить информацию о пользователе
   */
  async getUserInfo(userId) {
    return this.retryRequest(async () => {
      try {
        const response = await axios.get(`${this.baseUrl}/users.get`, {
          params: {
            user_ids: userId,
            access_token: this.accessToken,
            v: this.apiVersion
          },
          timeout: 15000
        });

        if (response.data.response && response.data.response.length > 0) {
          return response.data.response[0];
        }

        throw new Error('User not found');
      } catch (error) {
        console.error('Ошибка получения данных пользователя VK:', error.message);
        throw error;
      }
    });
  }

  /**
   * Очистить markdown из текста (VK не поддерживает форматирование)
   */
  cleanMarkdown(text) {
    return text
      .replace(/\*\*(.+?)\*\*/g, '$1')  // **bold** -> bold
      .replace(/\*(.+?)\*/g, '$1')      // *italic* -> italic
      .replace(/__(.+?)__/g, '$1')      // __underline__ -> underline
      .replace(/_(.+?)_/g, '$1')        // _italic_ -> italic
      .replace(/`(.+?)`/g, '$1');       // `code` -> code
  }

  /**
   * Отправить сообщение
   */
  async sendMessage(peerId, message) {
    return this.retryRequest(async () => {
      try {
        // Очищаем markdown перед отправкой
        const cleanedMessage = this.cleanMarkdown(message);

        const response = await axios.post(`${this.baseUrl}/messages.send`, null, {
          params: {
            peer_id: peerId,
            message: cleanedMessage,
            random_id: Math.floor(Math.random() * 1000000000),
            access_token: this.accessToken,
            v: this.apiVersion
          },
          timeout: 15000
        });

        return response.data;
      } catch (error) {
        console.error('Ошибка отправки сообщения VK:', error.message);
        throw error;
      }
    });
  }

  /**
   * Установить статус "печатает..."
   */
  async setTypingStatus(peerId) {
    return this.retryRequest(async () => {
      try {
        await axios.post(`${this.baseUrl}/messages.setActivity`, null, {
          params: {
            peer_id: peerId,
            type: 'typing',
            group_id: config.vk.groupId,
            access_token: this.accessToken,
            v: this.apiVersion
          },
          timeout: 5000
        });
      } catch (error) {
        // Не критично если не удалось установить статус
        console.error('Ошибка установки статуса печатает:', error.message);
      }
    });
  }
}

export default new VKService();
