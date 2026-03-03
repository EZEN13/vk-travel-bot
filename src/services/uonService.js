import { config } from '../config/config.js';

class UonService {
  constructor() {
    this.apiKey = config.uon.apiKey;
    this.baseUrl = `https://api.u-on.ru/${this.apiKey}`;
  }

  /**
   * Парсинг дат из текста вида "10-17 июня 2026 (7 дней)" → { dateFrom: "2026-06-10", dateTo: "2026-06-17" }
   */
  parseDateRange(dateStr) {
    const months = {
      'январ': '01', 'феврал': '02', 'март': '03', 'мар': '03',
      'апрел': '04', 'ма': '05', 'июн': '06', 'июл': '07',
      'август': '08', 'авг': '08', 'сентябр': '09', 'октябр': '10',
      'ноябр': '11', 'декабр': '12'
    };

    let month = null;
    const lowerStr = dateStr.toLowerCase();
    for (const [key, val] of Object.entries(months)) {
      if (lowerStr.includes(key)) {
        month = val;
        break;
      }
    }

    if (!month) return {};

    const yearMatch = dateStr.match(/20\d{2}/);
    const year = yearMatch ? yearMatch[0] : new Date().getFullYear().toString();

    // "10-17 июня" или "10 - 17 июня" или "с 10 по 17 июня"
    const rangeMatch = dateStr.match(/(\d{1,2})\s*[-–—]\s*(\d{1,2})/);
    const singleMatch = dateStr.match(/(\d{1,2})\s*(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)/i);

    if (rangeMatch) {
      const dayFrom = rangeMatch[1].padStart(2, '0');
      const dayTo = rangeMatch[2].padStart(2, '0');
      return {
        dateFrom: `${year}-${month}-${dayFrom}`,
        dateTo: `${year}-${month}-${dayTo}`
      };
    } else if (singleMatch) {
      const day = singleMatch[1].padStart(2, '0');
      return { dateFrom: `${year}-${month}-${day}` };
    }

    return {};
  }

  /**
   * Создать обращение (лид) в U-ON CRM
   */
  async createLead(leadData) {
    if (!this.apiKey) {
      console.warn('⚠️ U-ON API ключ не настроен, пропускаем создание лида');
      return null;
    }

    console.log('📤 Создаём лид в U-ON CRM...');

    const body = new URLSearchParams();

    // Клиент
    if (leadData.firstName) body.append('u_name', leadData.firstName);
    if (leadData.lastName) body.append('u_surname', leadData.lastName);

    // Контакты (хотя бы один обязателен)
    if (leadData.phone) body.append('u_phone', leadData.phone);
    if (leadData.vkId) body.append('u_social_vk', `https://vk.com/id${leadData.vkId}`);

    // Источник
    body.append('source', 'VK бот ИИ');

    // Собираем красивое примечание (note) со всей информацией
    const noteParts = [];
    if (leadData.summary && typeof leadData.summary === 'object') {
      if (leadData.summary.destination) noteParts.push(`Направление: ${leadData.summary.destination}`);
      if (leadData.summary.departureCity) noteParts.push(`Вылет из: ${leadData.summary.departureCity}`);
      if (leadData.summary.dates) noteParts.push(`Даты: ${leadData.summary.dates}`);
      if (leadData.summary.people) noteParts.push(`Состав: ${leadData.summary.people}`);
      if (leadData.summary.preferences) noteParts.push(`Пожелания: ${leadData.summary.preferences}`);
      if (leadData.summary.budget) noteParts.push(`Бюджет: ${leadData.summary.budget}`);
      if (leadData.summary.details) noteParts.push(`\nДетали: ${leadData.summary.details}`);
    } else if (leadData.note) {
      noteParts.push(leadData.note);
    }
    if (leadData.contactPreference && leadData.contactPreference !== 'не указан') {
      noteParts.push(`Предпочитает связь: ${leadData.contactPreference}`);
    }
    noteParts.push(`\nИсточник: ВК бот ИИ (автоматически)`);

    if (noteParts.length > 0) {
      body.append('note', noteParts.join('\n'));
    }

    // Пожелания клиента (структурированные поля CRM)
    if (leadData.summary && typeof leadData.summary === 'object') {
      if (leadData.summary.preferences) {
        body.append('requirements_note', leadData.summary.preferences);
      }
      if (leadData.summary.people) {
        const adults = leadData.summary.people.match(/(\d+)\s*взросл/i);
        const children = leadData.summary.people.match(/(\d+)\s*(реб|дет)/i);
        if (adults) body.append('tourist_count', adults[1]);
        if (children) body.append('tourist_child_count', children[1]);
      }
      if (leadData.summary.budget) {
        const budgetNum = leadData.summary.budget.replace(/\s/g, '').match(/(\d+)/);
        if (budgetNum) body.append('budget', budgetNum[1]);
      }
      if (leadData.summary.dates) {
        const parsed = this.parseDateRange(leadData.summary.dates);
        if (parsed.dateFrom) body.append('date_from', parsed.dateFrom);
        if (parsed.dateTo) body.append('date_to', parsed.dateTo);
      }
    }

    // Способ связи — в примечание клиента
    if (leadData.contactPreference && leadData.contactPreference !== 'не указан') {
      body.append('u_note', `Предпочитает связь: ${leadData.contactPreference}`);
    }

    try {
      console.log('📤 U-ON запрос:', Object.fromEntries(body.entries()));

      const response = await fetch(`${this.baseUrl}/lead/create.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      });

      const result = await response.json();

      if (result.id || result.result === 200) {
        console.log('✅ Лид создан в U-ON CRM, ID:', result.id);
        return result;
      } else {
        console.error('❌ Ошибка U-ON API:', JSON.stringify(result));
        return null;
      }
    } catch (error) {
      console.error('❌ Ошибка создания лида в U-ON:', error.message);
      return null;
    }
  }
}

export default new UonService();
