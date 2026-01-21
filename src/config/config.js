import dotenv from 'dotenv';

dotenv.config();

export const config = {
  vk: {
    accessToken: process.env.VK_ACCESS_TOKEN,
    groupId: process.env.VK_GROUP_ID || '233537605',
    apiVersion: process.env.VK_API_VERSION || '5.199'
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
  },
  postgres: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT) || 5432,
    database: process.env.POSTGRES_DB || 'vk_bot_db',
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID || '-4851482920'
  },
  server: {
    port: parseInt(process.env.PORT) || 3000,
    webhookPath: process.env.WEBHOOK_PATH || '/vk'
  }
};
