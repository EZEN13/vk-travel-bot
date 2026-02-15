import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import { config } from '../config/config.js';

class PineconeService {
  constructor() {
    this.embeddingModel = 'text-embedding-3-small';
    this.namespace = 'planeta-kb';
    this.minScore = 0.3;

    // Инициализация клиентов (ленивая — при первом запросе)
    this._pinecone = null;
    this._index = null;
    this._openai = null;
  }

  /**
   * Ленивая инициализация Pinecone (чтобы бот запускался даже без ключа)
   */
  _getIndex() {
    if (!this._index) {
      if (!config.pinecone.apiKey || config.pinecone.apiKey === 'ВСТАВЬ_СЮДА_КЛЮЧ') {
        return null;
      }
      this._pinecone = new Pinecone({ apiKey: config.pinecone.apiKey });
      this._index = this._pinecone.index(config.pinecone.indexName);
    }
    return this._index;
  }

  _getOpenAI() {
    if (!this._openai) {
      this._openai = new OpenAI({ apiKey: config.openai.apiKey });
    }
    return this._openai;
  }

  /**
   * Поиск в базе знаний компании
   * @param {string} query - Вопрос пользователя
   * @param {number} topK - Количество результатов
   * @returns {Promise<string|null>} Форматированный текст из базы знаний
   */
  async searchKnowledgeBase(query, topK = 5) {
    console.log(`📚 Pinecone: "${query}"`);

    const index = this._getIndex();
    if (!index) {
      console.warn('⚠️  Pinecone не настроен (нет API ключа)');
      return null;
    }

    try {
      // 1. Генерируем эмбеддинг запроса
      const openai = this._getOpenAI();
      const embeddingResponse = await openai.embeddings.create({
        model: this.embeddingModel,
        input: query
      });
      const queryVector = embeddingResponse.data[0].embedding;

      // 2. Ищем в Pinecone
      const results = await index.namespace(this.namespace).query({
        vector: queryVector,
        topK,
        includeMetadata: true
      });

      if (!results.matches || results.matches.length === 0) {
        console.warn('⚠️  Pinecone: ничего не найдено');
        return null;
      }

      // 3. Фильтруем по минимальному скору
      const relevant = results.matches.filter(m => m.score >= this.minScore);
      console.log(`✅ Pinecone: ${relevant.length} релевантных результатов (из ${results.matches.length})`);

      if (relevant.length === 0) {
        return null;
      }

      // 4. Форматируем
      return this.formatResults(relevant);

    } catch (error) {
      console.error('❌ Pinecone Error:', error.message);
      return null;
    }
  }

  /**
   * Форматирование результатов для GPT
   */
  formatResults(matches) {
    return matches.map(match => {
      const meta = match.metadata;
      const score = (match.score * 100).toFixed(0);
      return `[${meta.content_type} | ${meta.page_title} | релевантность ${score}%]\n${meta.text}`;
    }).join('\n\n---\n\n');
  }
}

export default new PineconeService();
