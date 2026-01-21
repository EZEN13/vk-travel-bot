import axios from 'axios';
import { config } from '../config/config.js';

class AviasalesApi {
  constructor() {
    this.baseUrl = 'https://api.travelpayouts.com/aviasales/v3';
    this.token = config.travelpayouts?.token;
    this.marker = config.travelpayouts?.marker || '123456';
  }

  /**
   * Поиск авиабилетов по направлению и датам
   * @param {Object} params - параметры поиска
   * @param {string} params.origin - IATA код города вылета
   * @param {string} params.destination - IATA код города прилёта
   * @param {string} params.departureDate - дата вылета (YYYY-MM-DD)
   * @param {string} params.returnDate - дата возврата (YYYY-MM-DD, опционально)
   * @param {number} params.adults - количество взрослых пассажиров
   * @returns {Promise<Array|null>} Массив рейсов с ценами или null
   */
  async searchFlights({ origin, destination, departureDate, returnDate, adults = 1 }) {
    try {
      if (!this.token) {
        console.warn('⚠️  Travelpayouts token не настроен. Пропуск поиска авиабилетов.');
        return null;
      }

      // API endpoint: /prices_for_dates
      const params = {
        origin,
        destination,
        departure_at: departureDate,
        currency: 'rub',
        token: this.token,
        limit: 3  // Топ 3 варианта
      };

      if (returnDate) {
        params.return_at = returnDate;
      }

      console.log(`🔍 Поиск авиабилетов: ${origin} → ${destination}, ${departureDate}`);

      const response = await axios.get(`${this.baseUrl}/prices_for_dates`, {
        params,
        timeout: 10000  // 10 секунд таймаут
      });

      // Форматируем результаты для AI
      return this.formatFlightResults(response.data.data, adults);
    } catch (error) {
      console.error('❌ Ошибка поиска авиабилетов:', error.message);

      // Возвращаем null вместо выброса ошибки - бот продолжит работать с примерными ценами
      return null;
    }
  }

  /**
   * Форматировать результаты для AI
   * @param {Array} flights - массив рейсов от API
   * @param {number} adults - количество взрослых
   * @returns {Array|null} Форматированный массив или null
   */
  formatFlightResults(flights, adults) {
    if (!flights || flights.length === 0) {
      return null;
    }

    return flights.slice(0, 3).map(flight => ({
      price: flight.value * adults,
      airline: flight.airline,
      departure_at: flight.departure_at,
      return_at: flight.return_at,
      flight_number: flight.flight_number,
      link: flight.link || `https://www.aviasales.ru/?marker=${this.marker}`
    }));
  }

  /**
   * Преобразовать название города в IATA код
   * @param {string} cityName - название города
   * @returns {string|null} IATA код или null
   */
  getCityCode(cityName) {
    // Простой словарь популярных городов
    const cityMap = {
      'москва': 'MOW',
      'санкт-петербург': 'LED',
      'питер': 'LED',
      'спб': 'LED',
      'пермь': 'PEE',
      'екатеринбург': 'SVX',
      'казань': 'KZN',
      'сочи': 'AER',
      'краснодар': 'KRR',
      'анталия': 'AYT',
      'стамбул': 'IST',
      'дубай': 'DXB',
      'абу-даби': 'AUH',
      'хургада': 'HRG',
      'шарм-эль-шейх': 'SSH',
      'шарм': 'SSH',
      'каир': 'CAI',
      'батуми': 'BUS',
      'тбилиси': 'TBS',
      'ереван': 'EVN',
      'пхукет': 'HKT',
      'бангкок': 'BKK',
      'париж': 'PAR',
      'рим': 'ROM',
      'барселона': 'BCN',
      'милан': 'MIL',
      'прага': 'PRG',
      'вена': 'VIE',
      'берлин': 'BER',
      'лондон': 'LON',
      'амстердам': 'AMS',
      'нью-йорк': 'NYC',
      'лос-анджелес': 'LAX',
      'майами': 'MIA',
      'мальдивы': 'MLE',
      'бали': 'DPS',
      'токио': 'TYO',
      'сингапур': 'SIN',
      'дели': 'DEL',
      'мумбаи': 'BOM'
    };

    const normalized = cityName.toLowerCase().trim();
    const code = cityMap[normalized];

    if (!code) {
      console.warn(`⚠️  Не найден IATA код для города: ${cityName}`);
    }

    return code || null;
  }

  /**
   * Получить название города по IATA коду (для отладки)
   * @param {string} iataCode - IATA код
   * @returns {string} Название города
   */
  getCityName(iataCode) {
    const codeMap = {
      'MOW': 'Москва',
      'LED': 'Санкт-Петербург',
      'PEE': 'Пермь',
      'SVX': 'Екатеринбург',
      'AYT': 'Анталия',
      'IST': 'Стамбул',
      'DXB': 'Дубай',
      'HRG': 'Хургада',
      'SSH': 'Шарм-эль-Шейх',
      'BUS': 'Батуми',
      'EVN': 'Ереван',
      'HKT': 'Пхукет',
      'BKK': 'Бангкок'
    };

    return codeMap[iataCode] || iataCode;
  }
}

export default new AviasalesApi();
