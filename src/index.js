import express from 'express';
import { config } from './config/config.js';
import vkService from './services/vkService.js';
import aiService from './services/aiService.js';
import telegramService from './services/telegramService.js';
import postgresDb from './database/db.js';
import memoryDb from './database/memoryDb.js';
import uonService from './services/uonService.js';
import messageDebouncer from './utils/debounce.js'; // Убери эту строку чтобы откатить дебаунс

// Выбор базы данных: in-memory для тестов, PostgreSQL для продакшена
const database = process.env.USE_MEMORY_DB === 'true' ? memoryDb : postgresDb;

// Передаём database в telegramService для работы кнопок паузы
telegramService.setDatabase(database);

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * Основная обработка сообщения (вызывается после дебаунса)
 */
async function processMessage(messageText, userData) {
  const peerId = parseInt(userData.peerId);

  try {
    // Статус "печатает..." с автопродлением каждые 5 секунд
    await vkService.setTypingStatus(peerId);
    const typingInterval = setInterval(async () => {
      try { await vkService.setTypingStatus(peerId); } catch {}
    }, 5000);

    try {
      // Получение истории чата
      const conversationHistory = await database.getChatHistory(userData.peerId);

      // Получение ответа от AI
      const aiResponse = await aiService.getChatResponse(
        messageText,
        userData,
        conversationHistory
      );

      // Проверяем запрос менеджера: по метке от GPT ИЛИ по тексту пользователя
      const hasManagerRequestTag = aiResponse.includes('[MANAGER_REQUEST]');
      const managerKeywords = /менеджер|оператор|человек|живой|подключ|переведи|позови|позвать|давай менеджера|можно менеджера|хочу менеджера|сюда менеджера/i;
      const hasManagerRequestText = managerKeywords.test(messageText);
      const hasManagerRequest = hasManagerRequestTag || hasManagerRequestText;
      const cleanResponse = aiResponse.replace(/\s*\[MANAGER_REQUEST\]\s*/g, '').trim();

      if (hasManagerRequest) {
        console.log(`🔔 Обнаружен запрос менеджера (метка: ${hasManagerRequestTag}, текст: ${hasManagerRequestText})`);
      }

      // Сохранение сообщений в базу данных
      await database.saveMessage(userData.peerId, 'user', messageText);
      await database.saveMessage(userData.peerId, 'assistant', cleanResponse);

      // Отправка ответа пользователю и отслеживание ID
      const sendResult = await vkService.sendMessage(peerId, cleanResponse);
      if (sendResult?.response) {
        database.trackBotMessage(sendResult.response);
      }

      // Проверка на наличие телефона в сообщении пользователя
      const phoneRegex = /(\+7|8)?[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/;
      if (phoneRegex.test(messageText)) {
        const phone = messageText.match(phoneRegex)[0];
        const fullHistory = [...conversationHistory, { role: 'user', content: messageText }];
        const conversationSummary = await aiService.summarizeConversation(fullHistory);
        const contactPreference = await aiService.extractContactPreference(fullHistory);

        // Telegram уведомление
        try {
          await telegramService.sendLeadNotification({
            firstName: userData.firstName,
            lastName: userData.lastName,
            fromId: userData.fromId,
            peerId: userData.peerId,
            phone: phone,
            contactPreference: contactPreference,
            summary: conversationSummary
          });
        } catch (tgError) {
          console.error('Ошибка Telegram уведомления:', tgError.message);
        }

        // U-ON CRM лид
        try {
          await uonService.createLead({
            firstName: userData.firstName,
            lastName: userData.lastName,
            phone: phone,
            vkId: userData.fromId,
            summary: conversationSummary,
            contactPreference: contactPreference
          });
        } catch (uonError) {
          console.error('Ошибка U-ON CRM:', uonError.message);
        }
      }

      // Проверяем: если уведомление уже отправлено и клиент указывает способ связи — обновляем
      if (!phoneRegex.test(messageText) && telegramService.notificationMessages.has(userData.peerId)) {
        const contactPreference = await aiService.extractContactPreference(
          [...conversationHistory, { role: 'user', content: messageText }]
        );
        if (contactPreference !== 'не указан') {
          console.log(`📱 Клиент указал способ связи: ${contactPreference}, обновляем уведомление`);
          try {
            // Получаем полную историю для обновлённой сводки
            const fullHistory = [...conversationHistory, { role: 'user', content: messageText }];
            const conversationSummary = await aiService.summarizeConversation(fullHistory);

            // Ищем телефон в истории
            let phone = '';
            for (const msg of conversationHistory) {
              if (msg.role === 'user') {
                const phoneMatch = msg.content.match(/(\+7|8)?[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/);
                if (phoneMatch) phone = phoneMatch[0];
              }
            }

            await telegramService.sendLeadNotification({
              firstName: userData.firstName,
              lastName: userData.lastName,
              fromId: userData.fromId,
              peerId: userData.peerId,
              phone: phone,
              contactPreference: contactPreference,
              summary: conversationSummary
            });
          } catch (tgError) {
            console.error('Ошибка обновления уведомления:', tgError.message);
          }
        }
      }

      // Если клиент просит менеджера (без телефона) — уведомляем
      if (hasManagerRequest && !phoneRegex.test(messageText)) {
        const fullHistory = [...conversationHistory, { role: 'user', content: messageText }];
        const conversationSummary = await aiService.summarizeConversation(fullHistory);

        // Telegram уведомление
        try {
          await telegramService.sendManagerRequestNotification({
            firstName: userData.firstName,
            lastName: userData.lastName,
            fromId: userData.fromId,
            peerId: userData.peerId,
            summary: conversationSummary
          });
        } catch (tgError) {
          console.error('Ошибка Telegram уведомления:', tgError.message);
        }

        // U-ON CRM лид (без телефона, с VK)
        try {
          await uonService.createLead({
            firstName: userData.firstName,
            lastName: userData.lastName,
            vkId: userData.fromId,
            summary: conversationSummary
          });
        } catch (uonError) {
          console.error('Ошибка U-ON CRM:', uonError.message);
        }
      }
    } finally {
      // Всегда останавливаем "печатает" когда закончили
      clearInterval(typingInterval);
    }
  } catch (error) {
    console.error('Ошибка обработки сообщения:', error);
  }
}

/**
 * Обработчик входящих сообщений от VK
 */
app.post(config.server.webhookPath, async (req, res) => {
  try {
    const body = req.body;

    // Подтверждение сервера VK Callback API
    if (body.type === 'confirmation') {
      return res.send(process.env.VK_CONFIRMATION_CODE || '');
    }

    // Быстрый ответ VK, чтобы не было таймаута
    res.send('ok');

    // Обработка исходящего сообщения от сообщества (менеджер пишет)
    if (body.type === 'message_reply') {
      const message = body.object;
      const peerId = message.peer_id;

      // Проверяем: это сообщение от бота или от менеджера?
      const isBotMsg = await database.isBotMessage(message.id);
      if (!isBotMsg) {
        // Это менеджер — ставим паузу
        await database.pauseBot(peerId.toString(), 'manager_reply');
        console.log(`⏸️ Менеджер ответил (message_reply), бот на паузе для peer_id=${peerId}`);
      }
      return;
    }

    // Обработка нового сообщения
    if (body.type === 'message_new') {
      const message = body.object.message;
      const messageText = message.text;
      const peerId = message.peer_id;
      const fromId = message.from_id;

      // 1. Определяем: это менеджер (от имени сообщества)?
      const groupId = parseInt(config.vk.groupId);
      if (fromId === -groupId || fromId < 0) {
        // Сообщение от сообщества — проверяем, бот ли это
        const isBotMsg = await database.isBotMessage(message.id);
        if (!isBotMsg) {
          // Это менеджер — ставим паузу
          await database.pauseBot(peerId.toString(), 'manager');
          console.log(`⏸️ Менеджер подключился (message_new), бот на паузе для peer_id=${peerId}`);
        }
        return;
      }

      // 2. Проверяем не на паузе ли бот для этого чата
      const isPaused = await database.isBotPaused(peerId.toString());
      if (isPaused) {
        console.log(`⏸️ Бот на паузе для peer_id=${peerId}, пропускаем сообщение`);
        return;
      }

      // 3. Проверка наличия текста
      if (!messageText || messageText.trim() === '') {
        await vkService.sendMessage(peerId, 'Отправьте пожалуйста ваше сообщение текстом 😊');
        return;
      }

      // 4. Получение информации о пользователе
      const userInfo = await vkService.getUserInfo(fromId);
      const userData = {
        peerId: peerId.toString(),
        firstName: userInfo.first_name,
        lastName: userInfo.last_name,
        fromId: fromId.toString()
      };

      // 5. Дебаунс — ждём 2 сек, склеиваем сообщения если их несколько
      messageDebouncer.add(peerId, messageText, userData, processMessage);
    }
  } catch (error) {
    console.error('Ошибка обработки webhook:', error);
  }
});

/**
 * Проверка работоспособности сервера
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Корневой маршрут
 */
app.get('/', (req, res) => {
  res.json({
    message: 'VK Travel Bot для турагентства "Планета"',
    version: '2.0.0'
  });
});

/**
 * Запуск сервера
 */
async function start() {
  try {
    // Инициализация базы данных
    await database.init();
    console.log('База данных подключена');

    // Запуск сервера
    app.listen(config.server.port, () => {
      console.log(`\n🚀 Сервер запущен на порту ${config.server.port}`);
      console.log(`📡 Webhook endpoint: http://localhost:${config.server.port}${config.server.webhookPath}`);
      console.log(`💚 Health check: http://localhost:${config.server.port}/health\n`);
    });

    // Очистка старой истории при запуске
    await database.cleanOldHistory(30);
  } catch (error) {
    console.error('Ошибка запуска сервера:', error);
    process.exit(1);
  }
}

// Обработка graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Получен сигнал SIGTERM, завершение работы...');
  await database.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\nПолучен сигнал SIGINT, завершение работы...');
  await database.close();
  process.exit(0);
});

start();
