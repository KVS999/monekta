// Shared by the bot (Node) and the mini app (browser): categories and the
// "кофе 350"-style phrase parser.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MonetkaParser = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const CATS = {
    food: { n: 'Продукты', e: '🛒', c: '#2E8B6E' },
    cafe: { n: 'Кафе', e: '☕', c: '#D07A2E' },
    transport: { n: 'Транспорт', e: '🚇', c: '#3D74B8' },
    home: { n: 'Жильё', e: '🏠', c: '#7A5BB0' },
    fun: { n: 'Развлечения', e: '🎬', c: '#C2477A' },
    health: { n: 'Здоровье', e: '💊', c: '#3FA3A8' },
    shop: { n: 'Покупки', e: '🛍️', c: '#A6873A' },
    other: { n: 'Другое', e: '•', c: '#7D8A84' },
  };
  const INCATS = {
    salary: { n: 'Зарплата', e: '💼', c: '#1F7A5C' },
    side: { n: 'Подработка', e: '🧩', c: '#4C9F6E' },
    gift: { n: 'Подарок', e: '🎁', c: '#8FA83A' },
    other_in: { n: 'Другое', e: '•', c: '#7D8A84' },
  };
  const ALLC = Object.assign({}, CATS, INCATS);

  const KEYS = {
    food: ['продукт', 'магазин', 'пятерочк', 'перекрест', 'вкусвилл', 'ашан', 'лента', 'магнит', 'рынок', 'еда ', 'молок', 'хлеб', 'овощ', 'фрукт', 'мясо', 'дикси', 'спар', 'азбука'],
    cafe: ['кофе', 'кафе', 'обед', 'ужин', 'завтрак', 'ресторан', 'пицц', 'шаурм', 'бургер', 'бар ', 'чай', 'суши', 'роллы', 'столов', 'макдак', 'вкусно и точка', 'kfc', 'кфс'],
    transport: ['такси', 'метро', 'автобус', 'бензин', 'заправк', 'каршер', 'парковк', 'электричк', 'проезд', 'трамва', 'самокат', 'поезд', 'тройка'],
    home: ['аренд', 'квартир', 'коммунал', 'жкх', 'интернет', 'свет ', 'газ ', 'связь', 'телефон', 'ипотек'],
    fun: ['кино', 'концерт', 'театр', 'игр', 'подписк', 'музей', 'бильярд', 'боулинг', 'кальян', 'стим', 'steam'],
    health: ['аптек', 'врач', 'лекарств', 'стоматолог', 'анализ', 'таблетк', 'клиник', 'массаж'],
    shop: ['одежд', 'озон', 'ozon', 'вайлдберриз', 'wildberries', 'вб ', 'маркетплейс', 'техник', 'обув', 'подарок', 'икеа', 'кроссовк'],
  };
  const INKEYS = {
    salary: ['зарплат', 'зп ', 'аванс', 'оклад', 'премия', 'премию'],
    side: ['фриланс', 'подработ', 'заказ'],
    gift: ['подарили', 'подарок от'],
    other_in: ['получил', 'вернули', 'кэшбэк', 'кешбэк', 'возврат', 'проценты', 'перевели', 'доход'],
  };
  const STOP = ['на', 'за', 'в', 'во', 'с', 'потратил', 'потратила', 'купил', 'купила', 'заплатил', 'заплатила', 'оплатил', 'оплатила', 'руб', 'р'];
  const MSTEMS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
  const MONTHS_G = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  const norm = (s) => String(s).toLowerCase().replace(/ё/g, 'е');
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  function dateText(ds, todayYmd) {
    const t = fromYmd(todayYmd);
    if (ds === todayYmd) return 'сегодня';
    if (ds === ymd(addDays(t, -1))) return 'вчера';
    const d = fromYmd(ds);
    return `${d.getDate()} ${MONTHS_G[d.getMonth()]}`;
  }

  // accounts: [{id, name, cur, kind}] — kind is 'card' | 'cash' | 'save'
  function pickAccount(accounts, pred) { return (accounts.find(pred) || {}).id; }

  function parseOne(raw, ctx) {
    const today = fromYmd(ctx.today);
    const learned = ctx.learned || {};
    const accounts = ctx.accounts || [];
    let s = ' ' + norm(raw).replace(/\s+/g, ' ') + ' ';
    let date = today, m;
    if (/\sпозавчера\s/.test(s)) { date = addDays(today, -2); s = s.replace(/\sпозавчера\s/, ' '); }
    else if (/\sвчера\s/.test(s)) { date = addDays(today, -1); s = s.replace(/\sвчера\s/, ' '); }
    s = s.replace(/\sсегодня\s/, ' ');
    if ((m = s.match(/\s(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\s/))) {
      const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : today.getFullYear();
      date = new Date(y, +m[2] - 1, +m[1]); s = s.replace(m[0], ' ');
    } else if ((m = s.match(/\s(\d{1,2})\s+(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)[а-я]*\s/))) {
      date = new Date(today.getFullYear(), MSTEMS.findIndex((st) => m[2].startsWith(st)), +m[1]); s = s.replace(m[0], ' ');
    }
    if (date > today) date = new Date(date.getFullYear() - 1, date.getMonth(), date.getDate());
    if (isNaN(date)) date = today;

    let acc = null;
    if ((m = s.match(/\s(нал|налом|наличн\w*|наличк\w*|кэш|кеш)\s/))) { acc = pickAccount(accounts, (a) => a.kind === 'cash'); s = s.replace(m[0], ' '); }
    else if ((m = s.match(/\s(с\s)?карт\w*\s/))) { acc = pickAccount(accounts, (a) => a.kind === 'card'); s = s.replace(m[0], ' '); }

    m = s.match(/(\+\s?)?(\d+(?:[.,]\d+)?)\s?(к|тыс\.?|т\.р\.)?\s?(₽|руб\w*|р\.?|€|евро|eur|\$|usd|долл\w*)?(?=\s)/);
    if (!m) return null;
    let amt = parseFloat(m[2].replace(',', '.'));
    if (m[3]) amt *= 1000;
    if (!(amt > 0) || amt > 1e9) return null;
    if (m[4]) {
      const want = /€|евро|eur/.test(m[4]) ? 'EUR' : /\$|usd|долл/.test(m[4]) ? 'USD' : 'RUB';
      const cur = accounts.find((a) => a.id === acc);
      if (!cur || cur.cur !== want) acc = pickAccount(accounts, (a) => a.cur === want) || acc;
    }
    s = s.replace(m[0], ' ');

    let words = s.replace(/[^a-zа-я0-9\s-]/g, ' ').split(/\s+/).filter((w) => w && !STOP.includes(w));
    // a word matching an account name ("сбер 500") picks that account
    if (!acc) {
      for (const w of words) {
        if (w.length < 3) continue;
        const a = accounts.find((x) => norm(x.name).split(/\s+/).some((p) => p.length >= 3 && p.startsWith(w)));
        if (a) { acc = a.id; words = words.filter((x) => x !== w); break; }
      }
    }
    if (!acc) acc = pickAccount(accounts, (a) => a.kind === 'card') || (accounts[0] || {}).id || null;

    const text = ' ' + words.join(' ') + ' ';
    let type = m[1] ? 'in' : 'out', cat = null, sure = true;
    for (const w of words) if (learned[w]) { cat = learned[w]; type = INCATS[cat] ? 'in' : 'out'; break; }
    if (!cat) for (const k in INKEYS) if (INKEYS[k].some((x) => text.includes(' ' + x))) { cat = k; type = 'in'; break; }
    if (!cat && type === 'out') for (const k in KEYS) if (KEYS[k].some((x) => text.includes(' ' + x))) { cat = k; break; }
    if (!cat) { cat = type === 'in' ? 'other_in' : 'other'; sure = false; }
    let note = words.join(' ');
    note = note ? note[0].toUpperCase() + note.slice(1) : ALLC[cat].n;
    return { type, cat, amt: Math.round(amt * 100) / 100, acc, date: ymd(date), note: note.slice(0, 120), sure, key: (words[0] || '').slice(0, 40) };
  }

  const parseMany = (text, ctx) =>
    String(text).split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean).slice(0, 20)
      .map((p) => ({ src: p, res: parseOne(p, ctx) }));

  function catFromText(n) {
    n = norm(n);
    for (const k in CATS) if (n.includes(norm(CATS[k].n).slice(0, 5))) return k;
    for (const k in KEYS) if (KEYS[k].some((x) => (' ' + n + ' ').includes(' ' + x))) return k;
    return null;
  }

  return { CATS, INCATS, ALLC, MONTHS_G, norm, ymd, fromYmd, addDays, dateText, parseOne, parseMany, catFromText };
});
