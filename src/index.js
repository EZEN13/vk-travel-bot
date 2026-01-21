import express from 'express';
import { config } from './config/config.js';
import vkService from './services/vkService.js';
import aiService from './services/aiService.js';
import telegramService from './services/telegramService.js';
import faqService from './services/faqService.js';
import postgresDb from './database/db.js';
import memoryDb from './database/memoryDb.js';

// Выбор базы данных: in-memory для тестов, PostgreSQL для продакшена
const database = process.env.USE_MEMORY_DB === 'true' ? memoryDb : postgresDb;

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
      // Нужно будет указать ваш confirmation code из настроек группы VK
      return res.send(process.env.VK_CONFIRMATION_CODE || '');
    }

    // Быстрый ответ VK, чтобы не было таймаута
    res.send('ok');

    // Обработка нового сообщения
    if (body.type === 'message_new') {
      const message = body.object.message;
      const messageText = message.text;
      const peerId = message.peer_id;
      const fromId = message.from_id;

      // Проверка наличия текста
      if (!messageText || messageText.trim() === '') {
        await vkService.sendMessage(peerId, 'Отправьте пожалуйста ваше сообщение текстом 😊');
        return;
      }

      // Получение информации о пользователе
      const userInfo = await vkService.getUserInfo(fromId);
      const userData = {
        peerId: peerId.toString(),
        firstName: userInfo.first_name,
        lastName: userInfo.last_name,
        fromId: fromId.toString()
      };

      // Установка статуса "печатает..."
      await vkService.setTypingStatus(peerId);

      // НОВОЕ: Проверка FAQ перед вызовом AI
      const faqAnswer = faqService.findAnswer(messageText);
      if (faqAnswer) {
        // Нашли ответ в FAQ - отправляем сразу
        await vkService.sendMessage(peerId, faqAnswer);

        // Сохраняем в историю
        await database.saveMessage(userData.peerId, 'user', messageText);
        await database.saveMessage(userData.peerId, 'assistant', faqAnswer);

        return;  // Не вызываем AI
      }

      // Получение истории чата из базы данных
      const conversationHistory = await database.getChatHistory(userData.peerId);

      // Получение ответа от AI
      const aiResponse = await aiService.getChatResponse(
        messageText,
        userData,
        conversationHistory
      );

      // Сохранение сообщений в базу данных
      await database.saveMessage(userData.peerId, 'user', messageText);
      await database.saveMessage(userData.peerId, 'assistant', aiResponse);

      // Отправка ответа пользователю
      await vkService.sendMessage(peerId, aiResponse);

      // Проверка на наличие телефона в сообщении пользователя для отправки уведомления
      const phoneRegex = /(\+7|8)?[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/;
      if (phoneRegex.test(messageText)) {
        try {
          // Извлечение телефона
          const phone = messageText.match(phoneRegex)[0];

          // Получение выжимки всего диалога для уведомления
          const conversationSummary = await aiService.summarizeConversation(conversationHistory);

          // Отправка уведомления в Telegram
          await telegramService.sendLeadNotification({
            firstName: userData.firstName,
            lastName: userData.lastName,
            fromId: userData.fromId,
            phone: phone,
            request: conversationSummary
          });
        } catch (telegramError) {
          // Не падаем если не удалось отправить в Telegram
          console.error('Ошибка отправки уведомления в Telegram:', telegramError.message);
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
    version: '1.0.0'
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
