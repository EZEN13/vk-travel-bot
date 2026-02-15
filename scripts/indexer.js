import dotenv from 'dotenv';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

dotenv.config();

// ============================================
// Конфигурация
// ============================================

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'planeta-kb';
const NAMESPACE = 'planeta-kb';
const EMBEDDING_MODEL = 'text-embedding-3-small';

// Страницы для парсинга
const URLS = [
  // Основные страницы
  { url: 'https://planetaperm.ru/', type: 'general' },
  { url: 'https://planetaperm.ru/about/', type: 'about' },
  { url: 'https://planetaperm.ru/contacts/', type: 'contacts' },
  { url: 'https://planetaperm.ru/credit/', type: 'credit' },
  { url: 'https://planetaperm.ru/feedback/', type: 'reviews' },
  { url: 'https://planetaperm.ru/hot/', type: 'general' },

  // Направления из Перми
  { url: 'https://planetaperm.ru/tury_iz_permi/', type: 'destination' },
  { url: 'https://planetaperm.ru/tury_iz_permi/turtsiya/', type: 'destination' },
  { url: 'https://planetaperm.ru/tury_iz_permi/egipet/', type: 'destination' },
  { url: 'https://planetaperm.ru/tury_iz_permi/oae/', type: 'destination' },
  { url: 'https://planetaperm.ru/tury_iz_permi/maldivy/', type: 'destination' },
  { url: 'https://planetaperm.ru/tury_iz_permi/russia/', type: 'destination' },
  { url: 'https://planetaperm.ru/tury_iz_permi/tailand/', type: 'destination' },
  { url: 'https://planetaperm.ru/tury_iz_permi/sri-lanka/', type: 'destination' },
  { url: 'https://planetaperm.ru/tury_iz_permi/kuba/', type: 'destination' },
  { url: 'https://planetaperm.ru/tury_iz_permi/vetnam/', type: 'destination' },
];

// ============================================
// Функции
// ============================================

/**
 * Скачать HTML страницу
 */
async function fetchPage(url) {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PlanetaBot/1.0; indexing knowledge base)'
      }
    });
    return response.data;
  } catch (error) {
    console.warn(`  ⚠️  Не удалось загрузить ${url}: ${error.message}`);
    return null;
  }
}

/**
 * Извлечь текст из HTML
 */
function extractText(html, url) {
  const $ = cheerio.load(html);

  // Убираем ненужные элементы
  $('script, style, nav, footer, header, form, iframe, noscript').remove();
  $('.menu, .navigation, .cookie-banner, .popup, .modal, .sidebar').remove();
  $('[class*="menu"], [class*="nav"], [class*="footer"], [class*="header"]').remove();

  // Получаем заголовок страницы
  const title = $('title').text().trim() || $('h1').first().text().trim() || url;

  // Извлекаем текст из основного контента
  let text = '';

  // Пробуем найти основной контент
  const mainContent = $('main, article, .content, .page-content, [role="main"]').first();

  if (mainContent.length) {
    text = mainContent.text();
  } else {
    text = $('body').text();
  }

  // Чистим текст
  text = text
    .replace(/\s+/g, ' ')          // множественные пробелы → один
    .replace(/\n\s*\n/g, '\n\n')   // множественные переносы → два
    .trim();

  return { title, text };
}

/**
 * Разбить текст на чанки
 */
function chunkText(text, maxChunkSize = 1500, overlap = 200) {
  if (text.length <= maxChunkSize) {
    return [text];
  }

  const chunks = [];
  // Сначала разбиваем по параграфам
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    // Если сам параграф длиннее maxChunkSize — разбиваем по предложениям
    if (paragraph.length > maxChunkSize) {
      if (currentChunk.trim().length > 50) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      const sentences = paragraph.match(/[^.!?]+[.!?]+\s*/g) || [paragraph];
      for (const sentence of sentences) {
        if (currentChunk.length + sentence.length > maxChunkSize && currentChunk.length > 0) {
          chunks.push(currentChunk.trim());
          currentChunk = currentChunk.slice(-overlap) + ' ' + sentence;
        } else {
          currentChunk += sentence;
        }
      }
      // Если после предложений чанк всё ещё слишком большой — режем жёстко по символам
      while (currentChunk.length > maxChunkSize) {
        const cutAt = currentChunk.lastIndexOf(' ', maxChunkSize);
        const splitPos = cutAt > maxChunkSize * 0.5 ? cutAt : maxChunkSize;
        chunks.push(currentChunk.slice(0, splitPos).trim());
        currentChunk = currentChunk.slice(splitPos - overlap).trim();
      }
      continue;
    }

    if (currentChunk.length + paragraph.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      // Overlap: берём конец предыдущего чанка
      currentChunk = currentChunk.slice(-overlap) + ' ' + paragraph;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    }
  }

  if (currentChunk.trim().length > 50) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Генерировать эмбеддинги батчами
 */
async function generateEmbeddings(texts) {
  const BATCH_SIZE = 50;
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch
    });

    allEmbeddings.push(...response.data.map(d => d.embedding));
    console.log(`  📊 Эмбеддинги: ${Math.min(i + BATCH_SIZE, texts.length)}/${texts.length}`);
  }

  return allEmbeddings;
}

/**
 * Создать slug из URL для ID вектора
 */
function urlToSlug(url) {
  return url
    .replace('https://planetaperm.ru/', '')
    .replace(/\//g, '-')
    .replace(/-$/, '') || 'index';
}

// ============================================
// Основная функция
// ============================================

async function main() {
  console.log('🚀 Индексация сайта planetaperm.ru в Pinecone\n');

  // 1. Проверяем ключи
  if (!process.env.PINECONE_API_KEY || process.env.PINECONE_API_KEY === 'ВСТАВЬ_СЮДА_КЛЮЧ') {
    console.error('❌ PINECONE_API_KEY не настроен в .env!');
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY не настроен в .env!');
    process.exit(1);
  }

  // 2. Подключаемся к Pinecone
  console.log('📌 Подключение к Pinecone...');
  const index = pinecone.index(INDEX_NAME);

  // 3. Очищаем старые данные
  console.log('🗑️  Очистка старых данных...');
  try {
    await index.namespace(NAMESPACE).deleteAll();
    console.log('  ✅ Namespace очищен');
  } catch (e) {
    console.log('  ℹ️  Namespace пуст или не существует');
  }

  // 4. Парсим страницы
  console.log('\n📄 Парсинг страниц...\n');

  const allChunks = [];

  for (const page of URLS) {
    console.log(`  🌐 ${page.url}`);

    const html = await fetchPage(page.url);
    if (!html) continue;

    const { title, text } = extractText(html, page.url);

    if (text.length < 50) {
      console.log(`    ⏭️  Мало текста (${text.length} символов), пропускаем`);
      continue;
    }

    const chunks = chunkText(text);
    const slug = urlToSlug(page.url);

    for (let i = 0; i < chunks.length; i++) {
      allChunks.push({
        id: `${slug}-${i}`,
        text: chunks[i],
        metadata: {
          text: chunks[i],
          source_url: page.url,
          page_title: title,
          content_type: page.type
        }
      });
    }

    console.log(`    ✅ ${chunks.length} чанков (${text.length} символов)`);

    // Задержка между запросами
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n📦 Всего чанков: ${allChunks.length}`);

  if (allChunks.length === 0) {
    console.error('❌ Нет данных для индексации!');
    process.exit(1);
  }

  // 5. Генерируем эмбеддинги
  console.log('\n🧠 Генерация эмбеддингов...');
  const texts = allChunks.map(c => c.text);
  const embeddings = await generateEmbeddings(texts);

  // 6. Загружаем в Pinecone
  console.log('\n📤 Загрузка в Pinecone...');

  const UPSERT_BATCH = 100;
  for (let i = 0; i < allChunks.length; i += UPSERT_BATCH) {
    const batch = allChunks.slice(i, i + UPSERT_BATCH).map((chunk, j) => ({
      id: chunk.id,
      values: embeddings[i + j],
      metadata: chunk.metadata
    }));

    await index.namespace(NAMESPACE).upsert({ records: batch });
    console.log(`  ✅ Загружено ${Math.min(i + UPSERT_BATCH, allChunks.length)}/${allChunks.length} векторов`);
  }

  console.log('\n🎉 Индексация завершена!');
  console.log(`   📊 Страниц спарсено: ${URLS.length}`);
  console.log(`   📦 Чанков создано: ${allChunks.length}`);
  console.log(`   💾 Индекс: ${INDEX_NAME} / Namespace: ${NAMESPACE}`);
}

main().catch(error => {
  console.error('\n❌ Ошибка индексации:', error.message);
  process.exit(1);
});
