# VK Travel Bot для турагентства "Планета"

AI-консультант для VK группы турагентства "Планета" (Пермь). Бот обрабатывает входящие сообщения, подбирает туры с помощью OpenAI и отправляет уведомления менеджерам в Telegram.

## Возможности

- Обработка сообщений от клиентов в VK
- AI-консультант на базе OpenAI GPT-4o-mini
- Хранение истории диалогов в PostgreSQL
- Автоматические уведомления менеджерам в Telegram при получении телефона клиента
- Статус "печатает..." во время генерации ответа
- Персонализированные обращения к клиентам по имени

## Структура проекта

```
vk-travel-bot/
├── src/
│   ├── config/
│   │   └── config.js          # Конфигурация приложения
│   ├── database/
│   │   └── db.js              # Работа с PostgreSQL
│   ├── services/
│   │   ├── vkService.js       # VK API
│   │   ├── aiService.js       # OpenAI GPT
│   │   └── telegramService.js # Telegram уведомления
│   └── index.js               # Главный файл с webhook сервером
├── .env.example               # Пример конфигурации
├── .gitignore
├── package.json
└── README.md
```

## Установка

1. Клонируйте репозиторий или создайте новый проект
2. Установите зависимости:

```bash
npm install
```

3. Создайте файл `.env` на основе `.env.example`:

```bash
cp .env.example .env
```

4. Заполните переменные окружения в `.env`:

```env
# VK API
VK_ACCESS_TOKEN=ваш_токен_vk
VK_GROUP_ID=233537605
VK_API_VERSION=5.199
VK_CONFIRMATION_CODE=код_подтверждения_callback_api

# OpenAI
OPENAI_API_KEY=ваш_ключ_openai

# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=vk_bot_db
POSTGRES_USER=ваш_юзер
POSTGRES_PASSWORD=ваш_пароль

# Telegram
TELEGRAM_BOT_TOKEN=ваш_токен_telegram_бота
TELEGRAM_CHAT_ID=-4851482920

# Server
PORT=3000
```

5. Создайте базу данных PostgreSQL:

```sql
CREATE DATABASE vk_bot_db;
```

## Запуск

Для разработки с автоперезагрузкой:
```bash
npm run dev
```

Для продакшена:
```bash
npm start
```

## Настройка VK Callback API

1. Перейдите в настройки вашей VK группы
2. Управление → Работа с API → Callback API
3. Укажите адрес сервера: `https://ваш_домен/vk`
4. Скопируйте код подтверждения и добавьте в `.env` как `VK_CONFIRMATION_CODE`
5. Включите событие "Входящие сообщения"

## API Endpoints

- `POST /vk` - Webhook для VK Callback API
- `GET /health` - Проверка работоспособности
- `GET /` - Информация о боте

## Как работает бот

1. Получает сообщение от VK через Callback API
2. Проверяет наличие текста в сообщении
3. Получает данные пользователя (имя, фамилия)
4. Устанавливает статус "печатает..."
5. Загружает историю диалога из PostgreSQL
6. Отправляет запрос в OpenAI с системным промптом
7. Сохраняет сообщения в базу данных
8. Отправляет ответ пользователю
9. При обнаружении телефона - отправляет уведомление в Telegram

## Зависимости

- `express` - веб-сервер
- `axios` - HTTP клиент для VK API
- `openai` - клиент для OpenAI
- `pg` - PostgreSQL клиент
- `node-telegram-bot-api` - Telegram Bot API
- `dotenv` - управление переменными окружения

## Лицензия

ISC
