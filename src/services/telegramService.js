import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config/config.js';

class TelegramService {
  constructor() {
    if (config.telegram.botToken) {
      this.bot = new TelegramBot(config.telegram.botToken, { polling: false });
    }
    this.chatId = config.telegram.chatId;
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
          error.code === 'ECONNREFUSED' ||
          error.message?.includes('ECONNRESET') ||
          error.message?.includes('ETIMEDOUT');

        if (isLastAttempt || !isRetryableError) {
          throw error;
        }

        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, attempt - 1) * 1000;
        console.log(`⚠️  Telegram API ошибка (попытка ${attempt}/${maxRetries}), повтор через ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Отправить уведомление о новом лиде менеджерам
   */
  async sendLeadNotification(leadData) {
    if (!this.bot) {
      console.warn('Telegram bot не настроен. Пропуск отправки уведомления.');
      return;
    }

    return this.retryRequest(async () => {
      try {
        const message = this.formatLeadMessage(leadData);

        await this.bot.sendMessage(this.chatId, message, {
          parse_mode: 'HTML',
          disable_web_page_preview: true
        });

        console.log('✅ Уведомление в Telegram отправлено');
      } catch (error) {
        console.error('Ошибка отправки в Telegram:', error.message);
        throw error;
      }
    });
  }

  /**
   * Форматировать сообщение о лиде
   */
  formatLeadMessage(leadData) {
    const { firstName, lastName, fromId, phone, request } = leadData;

    return `🆕 <b>НОВЫЙ ЛИД</b>

👤 Клиент: ${firstName} ${lastName}
📱 Телефон: ${phone}
🔗 VK: https://vk.com/id${fromId}

📋 Запрос:
${request}

⚡ Менеджер, пожалуйста подключитесь!`;
  }

  /**
   * Отправить произвольное сообщение
   */
  async sendMessage(text) {
    if (!this.bot) {
      console.warn('Telegram bot не настроен. Пропуск отправки сообщения.');
      return;
    }

    return this.retryRequest(async () => {
      try {
        await this.bot.sendMessage(this.chatId, text, {
          parse_mode: 'HTML'
        });
      } catch (error) {
        console.error('Ошибка отправки сообщения в Telegram:', error.message);
        throw error;
      }
    });
  }
}

export default new TelegramService();
