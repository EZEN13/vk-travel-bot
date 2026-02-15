import express from 'express';
import { config } from './config/config.js';
import vkService from './services/vkService.js';
import aiService from './services/aiService.js';
import telegramService from './services/telegramService.js';
import postgresDb from './database/db.js';
import memoryDb from './database/memoryDb.js';

// Выбор базы данных: in-memory для тестов, PostgreSQL для продакшена
const database = process.env.USE_MEMORY_DB === 'true' ? memoryDb : postgresDb;

// Передаём database в telegramService для работы кнопок паузы
telegramService.setDatabase(database);

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
      if (!database.isBotMessage(message.id)) {
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
        if (!database.isBotMessage(message.id)) {
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

      // 5. Установка статуса "печатает..."
      await vkService.setTypingStatus(peerId);

      // 6. Получение истории чата из базы данных
      const conversationHistory = await database.getChatHistory(userData.peerId);

      // 7. Получение ответа от AI
      const aiResponse = await aiService.getChatResponse(
        messageText,
        userData,
        conversationHistory
      );

      // 8. Проверяем метку [MANAGER_REQUEST] и убираем из текста для клиента
      const hasManagerRequest = aiResponse.includes('[MANAGER_REQUEST]');
      const cleanResponse = aiResponse.replace(/\s*\[MANAGER_REQUEST\]\s*/g, '').trim();

      // 9. Сохранение сообщений в базу данных
      await database.saveMessage(userData.peerId, 'user', messageText);
      await database.saveMessage(userData.peerId, 'assistant', cleanResponse);

      // 10. Отправка ответа пользователю и отслеживание ID
      const sendResult = await vkService.sendMessage(peerId, cleanResponse);
      if (sendResult?.response) {
        database.trackBotMessage(sendResult.response);
      }

      // 11. Проверка на наличие телефона в сообщении пользователя
      const phoneRegex = /(\+7|8)?[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/;
      if (phoneRegex.test(messageText)) {
        try {
          // Извлечение телефона
          const phone = messageText.match(phoneRegex)[0];

          // Получение структурированной выжимки диалога и способа связи
          const fullHistory = [...conversationHistory, { role: 'user', content: messageText }];
          const conversationSummary = await aiService.summarizeConversation(fullHistory);
          const contactPreference = await aiService.extractContactPreference(fullHistory);

          // Отправка уведомления в Telegram (или обновление существующего)
          await telegramService.sendLeadNotification({
            firstName: userData.firstName,
            lastName: userData.lastName,
            fromId: userData.fromId,
            peerId: userData.peerId,
            phone: phone,
            contactPreference: contactPreference,
            summary: conversationSummary
          });
        } catch (telegramError) {
          // Не падаем если не удалось отправить в Telegram
          console.error('Ошибка отправки уведомления в Telegram:', telegramError.message);
        }
      }

      // 12. Если клиент просит менеджера (без телефона) — уведомляем через Telegram
      if (hasManagerRequest && !phoneRegex.test(messageText)) {
        try {
          const fullHistory = [...conversationHistory, { role: 'user', content: messageText }];
          const conversationSummary = await aiService.summarizeConversation(fullHistory);

          await telegramService.sendManagerRequestNotification({
            firstName: userData.firstName,
            lastName: userData.lastName,
            fromId: userData.fromId,
            peerId: userData.peerId,
            summary: conversationSummary
          });
        } catch (telegramError) {
          console.error('Ошибка отправки запроса менеджера в Telegram:', telegramError.message);
        }
      }
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
