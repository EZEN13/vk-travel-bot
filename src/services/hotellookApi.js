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
      const nights = this.calculateNights(checkIn, checkOut);

      if (!this.token) {
        console.warn('⚠️  Travelpayouts token не настроен. Используем примерные цены.');
        return this.getApproximatePrices(location, stars || 5, nights);
      }

      // 1. Пытаемся получить ID из словаря
      let locationId = this.getLocationId(location);

      if (locationId) {
        console.log(`✅ ID локации из словаря: ${location} → ${locationId}`);
      }

      // 2. Если нет в словаре - пытаемся через API
      if (!locationId) {
        locationId = await this.getLocationIdFromAPI(location);
      }

      // 3. Если всё равно не нашли - используем fallback
      if (!locationId) {
        console.warn(`⚠️  Город ${location} не найден. Используем примерные цены.`);
        return this.getApproximatePrices(location, stars || 5, nights);
      }

      // 4. Ищем отели через API
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

      console.log(`🔍 Поиск отелей через API: ${location}, ${checkIn} - ${checkOut}`);

      const response = await axios.get(`${this.baseUrl}/search/hotels`, {
        params,
        timeout: 10000
      });

      // Форматируем результаты для AI
      const hotels = this.formatHotelResults(response.data, checkIn, checkOut);

      // Если API не вернул отели - fallback
      if (!hotels || hotels.length === 0) {
        console.warn(`⚠️  API не вернул отели для ${location}. Используем примерные цены.`);
        return this.getApproximatePrices(location, stars || 5, nights);
      }

      return hotels;
    } catch (error) {
      console.error('❌ Ошибка поиска отелей:', error.message);

      // Fallback на примерные цены при ошибке
      const nights = this.calculateNights(checkIn, checkOut);
      return this.getApproximatePrices(location, stars || 5, nights);
    }
  }

  /**
   * Получить ID локации из словаря популярных направлений
   * @param {string} cityName - название города
   * @returns {string|null} ID локации или null
   */
  getLocationId(cityName) {
    // Словарь популярных location_id (получены из Hotellook API заранее)
    const locationMap = {
      'анталия': '12881',
      'стамбул': '12865',
      'дубай': '4163',
      'батуми': '73569',
      'ереван': '60551',
      'хургада': '4821',
      'шарм-эль-шейх': '4829',
      'шарм': '4829',
      'пхукет': '134689',
      'бангкок': '12884',
      'мальдивы': '127213',  // Male, столица Мальдив
      'тбилиси': '62824',
      'турция': '12881',     // Fallback на Анталию
      'египет': '4821',      // Fallback на Хургаду
      'грузия': '73569',     // Fallback на Батуми
      'оаэ': '4163'          // Fallback на Дубай
    };

    const normalized = cityName.toLowerCase().trim();
    return locationMap[normalized] || null;
  }

  /**
   * Получить ID локации через Hotellook API
   * @param {string} cityName - название города
   * @returns {Promise<string|null>} ID локации или null
   */
  async getLocationIdFromAPI(cityName) {
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

      if (locationId) {
        console.log(`✅ ID локации через API: ${cityName} → ${locationId}`);
      } else {
        console.warn(`⚠️  API не вернул ID для города: ${cityName}`);
      }

      return locationId;
    } catch (error) {
      console.error('❌ Ошибка поиска локации через API:', error.message);
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
      'пхукет': { 4: 70000, 5: 110000 },
      'мальдивы': { 4: 250000, 5: 400000 }  // Премиум направление
    };

    const normalized = location.toLowerCase();
    const basePrice = priceMap[normalized]?.[stars] || 100000;

    // Корректируем на количество ночей
    const adjustedPrice = Math.round((basePrice / 7) * nights);

    console.log(`📊 Примерные цены для ${location}: ${adjustedPrice}₽ за ${nights} ночей`);

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
