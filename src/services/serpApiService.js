import axios from 'axios';
import { config } from '../config/config.js';

class SerpApiService {
  constructor() {
    this.apiKey = config.serpapi.apiKey;
    this.baseUrl = 'https://serpapi.com/search';
  }

  /**
   * Поиск отелей через Google Hotels (SerpAPI)
   * @param {Object} params - Параметры поиска
   * @param {string} params.location - Курорт/город (например, "Анталия, Турция")
   * @param {string} params.checkInDate - Дата заезда (YYYY-MM-DD)
   * @param {string} params.checkOutDate - Дата выезда (YYYY-MM-DD)
   * @param {number} params.adults - Количество взрослых
   * @param {number} params.children - Количество детей
   * @param {number} params.maxPrice - Максимальная цена за ночь (в рублях, опционально)
   * @returns {Promise<Array>} Список отелей
   */
  async searchHotels({ location, checkInDate, checkOutDate, adults = 2, children = 0, childrenAges = [], maxPrice = null }) {
    console.log(`🔍 SerpAPI: Поиск отелей в "${location}" с ${checkInDate} по ${checkOutDate}`);

    try {
      const params = {
        engine: 'google_hotels',
        q: location,
        check_in_date: checkInDate,
        check_out_date: checkOutDate,
        adults: adults,
        currency: 'RUB',
        gl: 'ru',
        hl: 'ru',
        api_key: this.apiKey
      };

      // Добавляем детей ТОЛЬКО если их больше 0
      if (children > 0) {
        params.children = children;
        // SerpAPI требует children_ages для каждого ребёнка
        // Если возраст не указан, ставим дефолтный 10 лет
        const ages = childrenAges.length === children
          ? childrenAges
          : Array(children).fill(10);
        params.children_ages = ages.join(',');
      }

      const response = await axios.get(this.baseUrl, {
        params,
        timeout: 15000 // 15 секунд таймаут
      });

      if (!response.data || !response.data.properties) {
        console.warn('⚠️ SerpAPI: Нет данных об отелях');
        return null;
      }

      const hotels = response.data.properties;
      console.log(`✅ SerpAPI: Найдено ${hotels.length} отелей`);

      // Фильтруем по максимальной цене если указана
      let filteredHotels = hotels;
      if (maxPrice) {
        filteredHotels = hotels.filter(hotel => {
          const price = hotel.rate_per_night?.extracted_lowest;
          return price && price <= maxPrice;
        });
        console.log(`💰 Отфильтровано по цене ≤${maxPrice}₽: ${filteredHotels.length} отелей`);
      }

      // Берём топ-5 отелей
      return this.formatHotelResults(filteredHotels.slice(0, 5));

    } catch (error) {
      console.error('❌ SerpAPI Error:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
      return null;
    }
  }

  /**
   * Форматирование результатов для передачи в GPT
   */
  formatHotelResults(hotels) {
    return hotels.map(hotel => {
      const pricePerNight = hotel.rate_per_night?.extracted_lowest || 0;
      const totalPrice = hotel.total_rate?.extracted_lowest || (pricePerNight * 7);

      return {
        name: hotel.name || 'Отель без названия',
        stars: hotel.extracted_hotel_class || 0,
        rating: hotel.overall_rating || 'н/д',
        reviewsCount: hotel.reviews || 0,
        pricePerNight: Math.round(pricePerNight),
        totalPrice: Math.round(totalPrice),
        currency: 'RUB',
        amenities: (hotel.amenities || []).slice(0, 5).join(', '),
        description: hotel.description || '',
        link: hotel.link || ''
      };
    }).filter(hotel => hotel.pricePerNight > 0);
  }
}

export default new SerpApiService();
