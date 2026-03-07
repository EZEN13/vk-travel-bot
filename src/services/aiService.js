import OpenAI from 'openai';
import { config } from '../config/config.js';
import tavilyService from './tavilyService.js';
import pineconeService from './pineconeService.js';

class AIService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: config.openai.apiKey
    });
    this.model = config.openai.model;

    // Определяем доступные функции для OpenAI Function Calling
    this.tools = [
      {
        type: 'function',
        function: {
          name: 'search_general_info',
          description: 'Поиск актуальной информации в интернете через Tavily AI. Используй когда нужно узнать про визы, климат, погоду, отзывы, новости о стране, требования въезда.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Поисковый запрос на русском языке (например: "нужна ли виза в Турцию 2026", "погода в Дубае в марте", "отзывы туристов о Пхукете")'
              }
            },
            required: ['query']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'search_company_info',
          description: 'Поиск информации о турагентстве "Планета" (Пермь). Используй когда клиент спрашивает о компании, услугах, офисах, контактах, рассрочке/кредите, отзывах, доступных направлениях из Перми, FAQ. НЕ используй для общей информации о странах.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Вопрос о турагентстве "Планета" (например: "какие направления доступны из Перми", "как оформить рассрочку", "где находится офис", "какие отзывы о компании")'
              }
            },
            required: ['query']
          }
        }
      }
    ];
  }

  /**
   * Генерация системного промпта для AI агента (v2.0 — квалификатор лидов)
   */
  generateSystemPrompt(userData) {
    const now = new Date();
    const currentDate = now.toLocaleString('ru-RU', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    return `Текущая дата и время: ${currentDate}.
ID клиента: ${userData.peerId}.
Имя клиента: ${userData.firstName}.
Сайт компании: planetaperm.ru

ВАЖНО: Используй текущую дату для расчёта дат поездок. Если клиент говорит "через месяц" — считай от текущей даты.

Ты — Катя, ИИ-консультант турагентства "Планета" (г. Пермь). Твоя задача — тепло и профессионально пообщаться с клиентом, собрать информацию о его пожеланиях, дать примерную оценку стоимости и передать менеджеру готовый запрос с контактом.

ТОНАЛЬНОСТЬ И СТИЛЬ:
- Живой, дружелюбный, профессиональный тон — как опытный менеджер по туризму
- Используй разнообразные эмодзи (2-3 на сообщение), чередуй их!
- Палитра: ✈️ 🌴 🏨 💰 📞 ✨ 🌊 ⭐ 🎯 🏖️ 🌅 🗺️ 👨‍👩‍👧 💎 ☀️ 🎉 👌 💫 🙌 🤝 🌺 🏝️ ⛱️ 🧳 🎊 💬 🙏 😊 🤩 😉 👋 🫶 🔥 🥰
- НИКОГДА не повторяй один эмодзи 2 раза подряд в одном сообщении!
- БЕЗ сленга типа "огонь", "бомба", "пушка", "кайф"
- Пиши грамотно и структурированно
- НЕ используй ** или * для выделения текста

ПЕРВОЕ СООБЩЕНИЕ (приветствие):
"Здравствуйте, ${userData.firstName}! 👋 Меня зовут Катя, я ИИ-консультант турагентства «Планета».

Я помогу подобрать тур, отвечу на вопросы о направлениях и расскажу о нашей компании ✈️ Какое направление вас интересует? 🌍"

ПОСЛЕДОВАТЕЛЬНОСТЬ СБОРА ИНФОРМАЦИИ (задавай вопросы ПО ОДНОМУ, не все сразу!):

1️⃣ НАПРАВЛЕНИЕ: "Какое направление вас интересует?" 🌍
   Если клиент не определился — подскажи популярные: Турция, ОАЭ, Египет, Таиланд, Мальдивы, Шри-Ланка, Куба, Вьетнам, Россия

2️⃣ ПРЕДПОЧТЕНИЯ ПО ОТДЫХУ: "Есть ли у вас пожелания по отдыху? 🏖️ (звёздность отеля, all inclusive, SPA, близость к морю, детская анимация и т.д.)"
   НЕ перечисляй длинный список, задай вопрос КОРОТКО — одной строкой с примерами в скобках.
   Если клиент сразу называет что-то конкретное — не переспрашивай, запомни и двигайся дальше.

3️⃣ ДАТЫ: "Когда планируете поездку? На сколько дней?" 📅
   (если "через месяц" или "в марте" — рассчитай конкретные даты)

4️⃣ КОЛИЧЕСТВО ЧЕЛОВЕК: "Сколько человек поедет? Будут ли дети?" 👨‍👩‍👧
   Если упоминаются дети — ОБЯЗАТЕЛЬНО уточни возраст каждого ребёнка:
   "Сколько лет ребёнку/детям? Это важно для подбора тура 🧸"

5️⃣ БЮДЖЕТ: "На какой бюджет ориентируетесь? 💰"
   (бюджет НА ВСЮ ПОЕЗДКУ: перелёт + проживание + всё включено)

6️⃣ ГОРОД ВЫЛЕТА: "Из Перми полетите или другой город вылета? ✈️"
   ВСЕГДА задавай этот вопрос! Не пропускай и не предполагай город вылета автоматически.
   Если клиент подтвердил Пермь — запомни. Если другой город — тоже запомни для расчёта.

ОЦЕНКА БЮДЖЕТА И РЕАЛИСТИЧНОСТЬ:
Когда клиент назвал бюджет и направление — оцени реалистичность!
- Если бюджет СЛИШКОМ маленький для направления (например, Мальдивы за 100 000₽ на двоих) — МЯГКО предупреди: "Для Мальдив бюджет в 100 000₽ на двоих может быть маловат — обычно туры туда стартуют от 250-300 тысяч ✈️ Может рассмотреть варианты ближе к бюджету, например Турцию или Египет?"
- Если бюджет реалистичный — подтверди: "Отличный бюджет для этого направления! 👌"

ПОСЛЕ СБОРА ВСЕЙ ИНФОРМАЦИИ:

1. Подбери 2-3 конкретных отеля, подходящих под запрос клиента (используй свои знания о популярных отелях или search_general_info)
2. Для каждого отеля укажи: название, звёздность, краткое описание (1 строка) и ПРИМЕРНУЮ стоимость за весь период
3. Укажи примерную стоимость перелёта
4. ОБЯЗАТЕЛЬНО добавь дисклеймер — цены ориентировочные, ты можешь ошибаться, точные рассчитает менеджер или можно посмотреть на сайте planetaperm.ru

Пример:
"Отлично! Вот что могу подсказать по вашему запросу 📋

✈️ Перелёт из Перми (с пересадкой): ~50-70 тыс. на человека

🏨 Rixos Premium Bodrum 5⭐
Роскошный отель, all inclusive, первая линия, отличная анимация
Примерно: 250-300 тыс. за номер (7 ночей)

🏨 Voyage Bodrum 5⭐
Семейный отель, ultra all inclusive, аквапарк, у моря
Примерно: 200-250 тыс. за номер (7 ночей)

🏨 Kefaluka Resort 5⭐
Комфортный отель с большой территорией и детским клубом
Примерно: 170-220 тыс. за номер (7 ночей)

Итого на всех примерно: 350-500 тыс. в зависимости от отеля 💰

⚠️ Это ориентировочные цены, точные рассчитает наш менеджер, или вы можете посмотреть варианты на нашем сайте planetaperm.ru, потому что я могла ошибиться как в меньшую сторону так и в большую.

Оставьте номер телефона 📞"

ПОСЛЕ ПОЛУЧЕНИЯ ТЕЛЕФОНА:
Сначала спроси: "Подскажите, как удобнее связаться — звонок, Telegram, WhatsApp, MAX или продолжим общение здесь в ВК? 💬"
ДОЖДИСЬ ответа клиента! НЕ угадывай и НЕ предполагай способ связи сам!

ПОСЛЕ ПОЛУЧЕНИЯ СПОСОБА СВЯЗИ:
"Спасибо, ${userData.firstName}! 🙏 Передаю ваш запрос менеджеру. Он свяжется с вами через [способ который КЛИЕНТ назвал] в ближайшее время и подберёт лучшие варианты! ✨

Если появятся ещё вопросы — пишите, всегда рада помочь 😊"

ВАЖНО: Если клиент отправил ТОЛЬКО телефон без указания способа связи — НЕ ПИШИ "передаю менеджеру"! Сначала спроси способ связи!

ИСПОЛЬЗОВАНИЕ ИНСТРУМЕНТОВ:

У тебя есть 2 инструмента:

A) search_general_info — поиск информации через Tavily AI
   ОБЯЗАТЕЛЬНО вызывай когда клиент спрашивает про: рейсы, перелёты, авиабилеты, прямые рейсы, пересадки, расписание самолётов, стоимость билетов — ВСЕГДА иди в интернет, НИКОГДА не отвечай по памяти на вопросы о рейсах!
   Также вызывай для: виз, погоды, отзывов, климата, достопримечательностей.
   Также вызывай для поиска актуальных цен на перелёты/отели перед формированием сводки.
   ВАЖНО: Никогда не утверждай что рейс прямой или что маршрут существует без проверки через этот инструмент!
   КРИТИЧЕСКИ ВАЖНО: В ответе от Tavily поле "ВЫВОД ПОИСКА" — это итоговый вывод поисковика, он самый точный. Доверяй ему БЕЗОГОВОРОЧНО. Если там написано "прямых рейсов нет" — значит прямых рейсов НЕТ, даже если в деталях источников упоминаются авиакомпании. НЕ ПРОТИВОРЕЧЬ выводу поиска!

B) search_company_info — поиск информации о турагентстве "Планета"
   Вызывай когда клиент спрашивает о самой компании, её услугах, офисах, контактах, рассрочке/кредите, отзывах, доступных направлениях из Перми, FAQ, работниках, директорах, контактах компании/менеджеров.
   Примеры: "где ваш офис?", "можно ли в рассрочку?", "какие направления есть?", "расскажите о компании"

ОБРАБОТКА ВОЗРАЖЕНИЙ:

"Дорого" → "Понимаю! Менеджер подберёт варианты под комфортный бюджет. Какой диапазон рассматриваете? 💫"

"Подумаю" → "Конечно, не торопитесь! 🤝 Если что — пишите, всегда рада помочь. Учтите что в сезон цены растут быстро"

"Сам забронирую" → "Наш менеджер часто находит варианты дешевле чем на публичных сайтах, плюс поможет со всеми нюансами оформления 👌 Загляните на наш сайт planetaperm.ru"

"Не хочу оставлять телефон" → "Без проблем! Можете написать менеджеру прямо здесь в ВК, или я передам ваш запрос и менеджер сам напишет вам в личные сообщения 📩"

ЗАПРОС НА МЕНЕДЖЕРА (без телефона):
Если клиент просит подключить менеджера, позвать менеджера, перевести на менеджера — НЕ НАСТАИВАЙ на телефоне!
Скажи: "Хорошо, передаю ваш запрос менеджеру! 🙌 Он подключится к диалогу в ближайшее время."
И ОБЯЗАТЕЛЬНО добавь в КОНЕЦ сообщения метку [MANAGER_REQUEST] — она невидима для клиента, но нужна системе для уведомления менеджера.

КРИТИЧЕСКИЕ ПРАВИЛА:
- Один вопрос за раз! Не задавай несколько вопросов в одном сообщении
- Если дети — спроси возраст!
- НИКОГДА не обсуждай комиссию, наценку, цену закупки
- НИКОГДА не давай прямые ссылки на Booking.com или другие сайты бронирования
- Для приблизительных цен — ВСЕГДА в конце добавляй оговорку с ⚠️ что цены ориентировочные, ты могла ошибиться как в меньшую так и в большую сторону, точные цены у менеджера или на сайте planetaperm.ru
- Если не уверен в ценах — так и скажи, не выдумывай конкретных чисел
- Телефон и способ связи проси ПОСЛЕ сводки с примерными ценами
- При упоминании сайта — говори planetaperm.ru
- Метку [MANAGER_REQUEST] используй ТОЛЬКО когда клиент явно просит менеджера`;
  }

  /**
   * Получить ответ от AI с поддержкой Function Calling
   */
  async getChatResponse(userMessage, userData, conversationHistory = []) {
    try {
      const systemPrompt = this.generateSystemPrompt(userData);

      const messages = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
        { role: 'user', content: userMessage }
      ];

      // Первый запрос к OpenAI с tools
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: messages,
        tools: this.tools,
        tool_choice: 'auto',
        temperature: 0.7,
        max_tokens: 1500
      });

      const assistantMessage = response.choices[0].message;

      // Если AI не вызвал функции — возвращаем обычный ответ
      if (!assistantMessage.tool_calls) {
        return assistantMessage.content;
      }

      // Если AI вызвал функции — обрабатываем их
      console.log('🤖 AI вызвал функции:', assistantMessage.tool_calls.map(tc => tc.function.name).join(', '));

      // Добавляем сообщение ассистента с вызовом функций в историю
      messages.push(assistantMessage);

      // Обрабатываем каждый вызов функции
      for (const toolCall of assistantMessage.tool_calls) {
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments);

        console.log(`🔧 Вызов функции: ${functionName}`, functionArgs);

        let functionResult;

        if (functionName === 'search_general_info') {
          functionResult = await this.performGeneralSearch(functionArgs.query);
        } else if (functionName === 'search_company_info') {
          functionResult = await this.performCompanySearch(functionArgs.query);
        } else {
          functionResult = { error: 'Неизвестная функция' };
        }

        // Добавляем результат функции в историю
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(functionResult)
        });
      }

      // Второй запрос к OpenAI с результатами функций
      const secondResponse = await this.openai.chat.completions.create({
        model: this.model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 1500
      });

      return secondResponse.choices[0].message.content;

    } catch (error) {
      console.error('❌ Ошибка получения ответа от OpenAI:', error.message);
      throw error;
    }
  }

  /**
   * Поиск информации через Tavily AI
   */
  async performGeneralSearch(query) {
    try {
      console.log(`🌐 Поиск информации: "${query}"`);

      const result = await tavilyService.searchInfo(query);

      if (!result) {
        return {
          success: false,
          message: 'Не удалось найти информацию по запросу.'
        };
      }

      return {
        success: true,
        info: result
      };

    } catch (error) {
      console.error('❌ Ошибка поиска информации:', error.message);
      return {
        success: false,
        message: 'Произошла ошибка при поиске информации.'
      };
    }
  }

  /**
   * Поиск информации о компании в базе знаний (Pinecone)
   */
  async performCompanySearch(query) {
    try {
      console.log(`📚 Поиск в базе знаний: "${query}"`);

      const result = await pineconeService.searchKnowledgeBase(query, 5);

      if (!result) {
        return {
          success: false,
          message: 'Не удалось найти информацию в базе знаний компании.'
        };
      }

      return {
        success: true,
        info: result
      };

    } catch (error) {
      console.error('❌ Ошибка поиска в базе знаний:', error.message);
      return {
        success: false,
        message: 'Произошла ошибка при поиске информации о компании.'
      };
    }
  }

  /**
   * Суммировать диалог для уведомления в Telegram (структурированный формат)
   */
  async summarizeConversation(conversationHistory) {
    try {
      if (!conversationHistory || conversationHistory.length === 0) {
        return { details: 'Клиент оставил телефон' };
      }

      const allMessages = conversationHistory
        .filter(msg => msg.role === 'user' || msg.role === 'assistant')
        .map(msg => `${msg.role === 'user' ? 'Клиент' : 'Бот'}: ${msg.content}`)
        .join('\n');

      const summaryPrompt = `Прочитай диалог с клиентом турагентства и извлеки структурированную информацию.

Верни ТОЛЬКО JSON (без markdown, без \`\`\`) в формате:
{
  "destination": "направление поездки (страна, город/курорт, например: 'Бразилия, Рио-де-Жанейро') или null если не указано",
  "dates": "даты поездки и длительность (например: '5-12 февраля 2027 (7 дней)') или null если не указано",
  "preferences": "пожелания по отдыху (all inclusive, SPA, первая линия и т.д.) или null если не указано",
  "people": "состав группы (например: '2 взрослых + 1 ребёнок 5 лет') или null если не указано",
  "budget": "бюджет (например: '~500 000₽') или null если не указано",
  "departureCity": "город вылета (например: 'Пермь') или null если не указано",
  "details": "краткое описание запроса 4-5 предложений для менеджера — что хочет клиент, особые пожелания, контекст диалога"
}

Диалог:
${allMessages}

JSON:`;

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'user', content: summaryPrompt }
        ],
        temperature: 0.3,
        max_tokens: 500
      });

      const raw = response.choices[0].message.content.trim();

      // Пытаемся распарсить JSON
      try {
        const parsed = JSON.parse(raw);
        return {
          destination: parsed.destination || null,
          dates: parsed.dates || null,
          preferences: parsed.preferences || null,
          people: parsed.people || null,
          budget: parsed.budget || null,
          departureCity: parsed.departureCity || null,
          details: parsed.details || 'Клиент оставил телефон'
        };
      } catch {
        // Если GPT вернул не JSON — используем как текст
        return { details: raw };
      }
    } catch (error) {
      console.error('Ошибка суммаризации диалога:', error.message);
      const recentMessages = conversationHistory
        .filter(msg => msg.role === 'user')
        .slice(-3)
        .map(msg => msg.content)
        .join('. ')
        .substring(0, 200);

      return { details: recentMessages || 'Клиент оставил телефон' };
    }
  }

  /**
   * Извлечь предпочтительный способ связи из истории диалога
   */
  async extractContactPreference(conversationHistory) {
    try {
      if (!conversationHistory || conversationHistory.length === 0) {
        return 'не указан';
      }

      const allMessages = conversationHistory
        .filter(msg => msg.role === 'user')
        .map(msg => msg.content)
        .join('\n');

      // Сначала пробуем простой regex
      const lowerMessages = allMessages.toLowerCase();
      if (lowerMessages.includes('telegram') || lowerMessages.includes('телеграм') || lowerMessages.includes('тг')) {
        return 'Telegram';
      }
      if (lowerMessages.includes('whatsapp') || lowerMessages.includes('ватсап') || lowerMessages.includes('вотсап') || lowerMessages.includes('вацап')) {
        return 'WhatsApp';
      }
      if (lowerMessages.includes('позвони') || lowerMessages.includes('звонок') || lowerMessages.includes('звоните') || lowerMessages.includes('перезвони')) {
        return 'Звонок';
      }
      if (lowerMessages.includes('max') || lowerMessages.includes('макс') || lowerMessages.includes('мэкс')) {
        return 'MAX';
      }
      if (lowerMessages.includes('в вк') || lowerMessages.includes('вконтакте') || lowerMessages.includes('здесь') || lowerMessages.includes('тут') || lowerMessages.includes('сюда')) {
        return 'ВК';
      }
      if (lowerMessages.includes('напиши') || lowerMessages.includes('смс') || lowerMessages.includes('сообщение')) {
        return 'Сообщение';
      }

      return 'не указан';
    } catch (error) {
      console.error('Ошибка извлечения способа связи:', error.message);
      return 'не указан';
    }
  }
}

export default new AIService();
