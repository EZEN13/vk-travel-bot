import axios from 'axios';
import { config } from '../config/config.js';

class HotellookApi {
  constructor() {
    this.baseUrl = 'https://engine.hotellook.com/api/v2';
    this.token = config.travelpayouts?.token;
    this.marker = config.travelpayouts?.marker || '123456';
  }

  /**
   * Поиск отелей по городу и датам
   * @param {Object} params - параметры поиска
   * @param {string} params.location - название города
   * @param {string} params.checkIn - дата заезда (YYYY-MM-DD)
   * @param {string} params.checkOut - дата выезда (YYYY-MM-DD)
   * @param {number} params.adults - количество гостей
   * @param {number} params.stars - звёздность отеля (опционально)
   * @returns {Promise<Array|null>} Массив отелей с ценами или null
   */
  async searchHotels({ location, checkIn, checkOut, adults = 2, stars = null }) {
    try {
      if (!this.token) {
        console.warn('⚠️  Travelpayouts token не настроен. Пропуск поиска отелей.');
        return null;
      }

      // 1. Получаем ID локации
      const locationId = await this.getLocationId(location);
      if (!locationId) {
        console.warn(`⚠️  Город ${location} не найден в Hotellook API`);
        return null;
      }

      // 2. Ищем отели
      const params = {
        location: locationId,
        checkIn,
        checkOut,
        adults,
        currency: 'rub',
        limit: 5,
        token: this.token
      };

      if (stars) {
        params.stars = stars;  // Фильтр по звёздам (4 или 5)
      }

      console.log(`🔍 Поиск отелей: ${location}, ${checkIn} - ${checkOut}`);

      const response = await axios.get(`${this.baseUrl}/search/hotels`, {
        params,
        timeout: 10000
      });

      // Форматируем результаты для AI
      return this.formatHotelResults(response.data, checkIn, checkOut);
    } catch (error) {
      console.error('❌ Ошибка поиска отелей:', error.message);

      // Возвращаем null вместо выброса ошибки - бот продолжит работать с примерными ценами
      return null;
    }
  }

  /**
   * Получить ID локации по названию города
   * @param {string} cityName - название города
   * @returns {Promise<string|null>} ID локации или null
   */
  async getLocationId(cityName) {
    try {
      const response = await axios.get(`${this.baseUrl}/lookup`, {
        params: {
          query: cityName,
          lang: 'ru',
          limit: 1
        },
        timeout: 5000
      });

      const results = response.data.results?.locations;
      const locationId = results && results.length > 0 ? results[0].id : null;

      if (!locationId) {
        console.warn(`⚠️  Не найден ID локации для города: ${cityName}`);
      }

      return locationId;
    } catch (error) {
      console.error('❌ Ошибка поиска локации:', error.message);
      return null;
    }
  }

  /**
   * Форматировать результаты для AI
   * @param {Array|Object} hotels - массив отелей от API
   * @param {string} checkIn - дата заезда
   * @param {string} checkOut - дата выезда
   * @returns {Array|null} Форматированный массив или null
   */
  formatHotelResults(hotels, checkIn, checkOut) {
    if (!hotels || (Array.isArray(hotels) && hotels.length === 0)) {
      return null;
    }

    const hotelArray = Array.isArray(hotels) ? hotels : [hotels];
    const nights = this.calculateNights(checkIn, checkOut);

    return hotelArray.slice(0, 3).map(hotel => ({
      name: hotel.name || 'Отель',
      stars: hotel.stars || 4,
      price_total: hotel.price || 0,
      price_per_night: hotel.price ? Math.round(hotel.price / nights) : 0,
      rating: hotel.rating || 'н/д',
      address: hotel.address || location,
      link: hotel.link || `https://www.hotellook.ru/?marker=${this.marker}`
    }));
  }

  /**
   * Рассчитать количество ночей
   * @param {string} checkIn - дата заезда (YYYY-MM-DD)
   * @param {string} checkOut - дата выезда (YYYY-MM-DD)
   * @returns {number} Количество ночей
   */
  calculateNights(checkIn, checkOut) {
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    const diff = end - start;
    const nights = Math.ceil(diff / (1000 * 60 * 60 * 24));

    return nights > 0 ? nights : 1;
  }

  /**
   * Получить примерные цены на отели (fallback когда API недоступен)
   * @param {string} location - город
   * @param {number} stars - звёздность
   * @param {number} nights - количество ночей
   * @returns {Array} Примерные варианты
   */
  getApproximatePrices(location, stars = 5, nights = 7) {
    // Примерные цены на популярные направления (за 2 человек за весь период)
    const priceMap = {
      'турция': { 4: 100000, 5: 150000 },
      'анталия': { 4: 100000, 5: 150000 },
      'египет': { 4: 80000, 5: 120000 },
      'хургада': { 4: 80000, 5: 120000 },
      'дубай': { 4: 150000, 5: 200000 },
      'оаэ': { 4: 150000, 5: 200000 },
      'грузия': { 4: 50000, 5: 80000 },
      'батуми': { 4: 50000, 5: 80000 },
      'армения': { 4: 45000, 5: 70000 },
      'ереван': { 4: 45000, 5: 70000 },
      'таиланд': { 4: 70000, 5: 110000 },
      'пхукет': { 4: 70000, 5: 110000 }
    };

    const normalized = location.toLowerCase();
    const basePrice = priceMap[normalized]?.[stars] || 100000;

    // Корректируем на количество ночей
    const adjustedPrice = Math.round((basePrice / 7) * nights);

    return [
      {
        name: `Отель ${stars}⭐`,
        stars,
        price_total: adjustedPrice,
        price_per_night: Math.round(adjustedPrice / nights),
        rating: 'примерно',
        address: location,
        link: `https://www.hotellook.ru/?marker=${this.marker}`
      }
    ];
  }
}

export default new HotellookApi();
