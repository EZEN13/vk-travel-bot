import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config/config.js';

class TelegramService {
  constructor() {
    this.database = null;
    // Хранение message_id уведомлений по peerId для возможности редактирования
    this.notificationMessages = new Map();

    if (config.telegram.botToken) {
      this.bot = new TelegramBot(config.telegram.botToken, { polling: true });
      this.setupCallbackHandlers();
    }
    this.chatId = config.telegram.chatId;
  }

  /**
   * Установить ссылку на базу данных (вызывается из index.js)
   */
  setDatabase(db) {
    this.database = db;
  }

  /**
   * Настроить обработчики inline-кнопок
   */
  setupCallbackHandlers() {
    this.bot.on('callback_query', async (query) => {
      try {
        const data = query.data;

        if (data.startsWith('pause_')) {
          const peerId = data.replace('pause_', '');

          if (this.database) {
            await this.database.pauseBot(peerId, 'telegram_button');

            await this.bot.answerCallbackQuery(query.id, {
              text: '⏸️ Бот отключён для этого клиента'
            });

            // Обновляем кнопки — показываем только "Вернуть бота"
            await this.bot.editMessageReplyMarkup({
              inline_keyboard: [
                [{ text: '▶️ Вернуть бота', callback_data: `resume_${peerId}` }]
              ]
            }, {
              chat_id: query.message.chat.id,
              message_id: query.message.message_id
            });
          } else {
            await this.bot.answerCallbackQuery(query.id, {
              text: '❌ Ошибка: база данных не подключена'
            });
          }
        }

        if (data.startsWith('resume_')) {
          const peerId = data.replace('resume_', '');

          if (this.database) {
            await this.database.resumeBot(peerId);

            await this.bot.answerCallbackQuery(query.id, {
              text: '▶️ Бот включён обратно'
            });

            // Обновляем кнопки — показываем только "Подключиться"
            await this.bot.editMessageReplyMarkup({
              inline_keyboard: [
                [{ text: '⏸️ Подключиться', callback_data: `pause_${peerId}` }]
              ]
            }, {
              chat_id: query.message.chat.id,
              message_id: query.message.message_id
            });
          } else {
            await this.bot.answerCallbackQuery(query.id, {
              text: '❌ Ошибка: база данных не подключена'
            });
          }
        }
      } catch (error) {
        console.error('Ошибка обработки callback_query:', error.message);
        try {
          await this.bot.answerCallbackQuery(query.id, {
            text: '❌ Произошла ошибка'
          });
        } catch (e) {
          // ignore
        }
      }
    });

    console.log('📱 Telegram: обработчики кнопок настроены');
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
        const keyboard = this.getLeadKeyboard(leadData.peerId);
        const existingMessageId = this.notificationMessages.get(leadData.peerId);

        if (existingMessageId) {
          // Редактируем существующее уведомление
          try {
            await this.bot.editMessageText(message, {
              chat_id: this.chatId,
              message_id: existingMessageId,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
              reply_markup: keyboard
            });
            console.log('✏️ Уведомление в Telegram обновлено');
            return;
          } catch (editError) {
            // Если не удалось отредактировать — отправим новое
            console.log('⚠️ Не удалось обновить, отправляю новое уведомление');
          }
        }

        // Отправляем новое уведомление
        const sent = await this.bot.sendMessage(this.chatId, message, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: keyboard
        });

        // Сохраняем message_id для будущего редактирования
        this.notificationMessages.set(leadData.peerId, sent.message_id);

        console.log('✅ Уведомление в Telegram отправлено (с кнопками)');
      } catch (error) {
        console.error('Ошибка отправки в Telegram:', error.message);
        throw error;
      }
    });
  }

  /**
   * Отправить уведомление о запросе менеджера (без телефона)
   */
  async sendManagerRequestNotification(leadData) {
    if (!this.bot) {
      console.warn('Telegram bot не настроен. Пропуск отправки уведомления.');
      return;
    }

    return this.retryRequest(async () => {
      try {
        const { firstName, lastName, fromId, peerId, summary } = leadData;

        // Структурированные поля из summary
        let requestBlock = '📋 <b>Запрос:</b>\n';

        if (summary && typeof summary === 'object') {
          if (summary.destination) {
            requestBlock += `🌍 Направление: ${summary.destination}\n`;
          }
          if (summary.dates) {
            requestBlock += `📅 Даты: ${summary.dates}\n`;
          }
          if (summary.preferences) {
            requestBlock += `🏖️ Предпочтения: ${summary.preferences}\n`;
          }
          if (summary.people) {
            requestBlock += `👨‍👩‍👧 Состав: ${summary.people}\n`;
          }
          if (summary.budget) {
            requestBlock += `💰 Бюджет: ${summary.budget}\n`;
          }
          if (summary.departureCity) {
            requestBlock += `✈️ Вылет из: ${summary.departureCity}\n`;
          }
          requestBlock += `\n📝 Детали: ${summary.details || 'Нет данных'}`;
        } else {
          requestBlock += (summary || 'Клиент просит подключить менеджера');
        }

        const message = `🔔 <b>ЗАПРОС НА МЕНЕДЖЕРА</b>

👤 Клиент: ${firstName} ${lastName}
🔗 VK: https://vk.com/id${fromId}
📱 Телефон: не оставлен

${requestBlock}

⚡️ Клиент просит подключиться менеджера в ВК!`;

        const keyboard = this.getLeadKeyboard(peerId);

        const sent = await this.bot.sendMessage(this.chatId, message, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: keyboard
        });

        // Сохраняем message_id — если потом клиент оставит телефон, обновим
        this.notificationMessages.set(peerId, sent.message_id);

        console.log('🔔 Уведомление о запросе менеджера отправлено в Telegram');
      } catch (error) {
        console.error('Ошибка отправки запроса менеджера в Telegram:', error.message);
        throw error;
      }
    });
  }

  /**
   * Форматировать сообщение о лиде (структурированный формат)
   */
  formatLeadMessage(leadData) {
    const { firstName, lastName, fromId, phone, contactPreference, summary } = leadData;

    const contactLine = contactPreference && contactPreference !== 'не указан'
      ? `💬 Продолжить общение: ${contactPreference}\n`
      : '';

    // Структурированные поля из summary
    let requestBlock = '📋 <b>Запрос:</b>\n';

    if (summary && typeof summary === 'object') {
      if (summary.destination) {
        requestBlock += `🌍 Направление: ${summary.destination}\n`;
      }
      if (summary.dates) {
        requestBlock += `📅 Даты: ${summary.dates}\n`;
      }
      if (summary.preferences) {
        requestBlock += `🏖️ Предпочтения: ${summary.preferences}\n`;
      }
      if (summary.people) {
        requestBlock += `👨‍👩‍👧 Состав: ${summary.people}\n`;
      }
      if (summary.budget) {
        requestBlock += `💰 Бюджет: ${summary.budget}\n`;
      }
      if (summary.departureCity) {
        requestBlock += `✈️ Вылет из: ${summary.departureCity}\n`;
      }
      requestBlock += `\n📝 Детали: ${summary.details || 'Нет данных'}`;
    } else {
      // Fallback — если summary пришёл как строка
      requestBlock += (summary || 'Клиент оставил телефон');
    }

    return `🆕 <b>НОВЫЙ ЛИД ВК ИИ</b>

👤 Клиент: ${firstName} ${lastName}
📱 Телефон: ${phone}
🔗 VK: https://vk.com/id${fromId}
${contactLine}
${requestBlock}

⚡️ Менеджер, пожалуйста подключитесь!`;
  }

  /**
   * Получить inline-клавиатуру для уведомления о лиде
   */
  getLeadKeyboard(peerId) {
    const groupId = config.vk.groupId;
    const vkDialogUrl = `https://vk.com/gim${groupId}?sel=${peerId}`;

    return {
      inline_keyboard: [
        [
          { text: '💬 Открыть диалог в ВК', url: vkDialogUrl }
        ],
        [
          { text: '⏸️ Отключить бота', callback_data: `pause_${peerId}` }
        ]
      ]
    };
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
