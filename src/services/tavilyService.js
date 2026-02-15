import axios from 'axios';
import { config } from '../config/config.js';

class TavilyService {
  constructor() {
    this.apiKey = config.tavily.apiKey;
    this.baseUrl = 'https://api.tavily.com/search';
  }

  /**
   * Универсальный поиск информации через Tavily AI
   * @param {string} query - Поисковый запрос (например, "нужна ли виза в Турцию для россиян 2026")
   * @param {string} searchDepth - Глубина поиска: 'basic' или 'advanced' (по умолчанию 'basic')
   * @returns {Promise<string>} Краткий ответ на запрос
   */
  async searchInfo(query, searchDepth = 'basic') {
    console.log(`🌐 Tavily: "${query}"`);

    try {
      const response = await axios.post(
        this.baseUrl,
        {
          api_key: this.apiKey,
          query: query,
          search_depth: searchDepth,
          include_answer: true,
          include_domains: [], // Можно ограничить домены если нужно
          max_results: 3 // Берём топ-3 результата
        },
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 10000 // 10 секунд таймаут
        }
      );

      if (!response.data) {
        console.warn('⚠️ Tavily: Нет данных');
        return null;
      }

      // Tavily возвращает краткий ответ в поле 'answer'
      const answer = response.data.answer;

      // Также можно использовать результаты поиска
      const results = response.data.results || [];

      console.log(`✅ Tavily: Получен ответ (${answer ? answer.length : 0} символов)`);

      // Формируем структурированный ответ
      return this.formatSearchResult(answer, results);

    } catch (error) {
      console.error('❌ Tavily Error:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
      return null;
    }
  }

  /**
   * Форматирование результатов поиска для GPT
   */
  formatSearchResult(answer, results) {
    let formatted = '';

    // Добавляем краткий ответ если есть
    if (answer) {
      formatted += `${answer}\n\n`;
    }

    // Добавляем топ-3 источника
    if (results.length > 0) {
      formatted += 'Источники:\n';
      results.slice(0, 3).forEach((result, index) => {
        formatted += `${index + 1}. ${result.title}\n`;
        if (result.content) {
          // Берём первые 200 символов контента
          formatted += `   ${result.content.substring(0, 200)}...\n`;
        }
      });
    }

    return formatted.trim() || 'Информация не найдена';
  }

  /**
   * Специализированный метод для проверки визовых требований
   */
  async checkVisaRequirements(country, year = 2026) {
    const query = `Нужна ли виза в ${country} для россиян в ${year} году? Какие требования для въезда?`;
    return await this.searchInfo(query);
  }

  /**
   * Специализированный метод для получения информации о климате
   */
  async getClimateInfo(location, month) {
    const query = `Погода и климат в ${location} в ${month}. Температура воды и воздуха. Стоит ли ехать?`;
    return await this.searchInfo(query);
  }

  /**
   * Специализированный метод для поиска отзывов и рекомендаций
   */
  async getDestinationReviews(destination) {
    const query = `Отзывы туристов о ${destination} 2026. Плюсы и минусы отдыха. Что посмотреть?`;
    return await this.searchInfo(query, 'advanced');
  }
}

export default new TavilyService();
