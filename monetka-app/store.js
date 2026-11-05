// Монетка без сервера: данные каждого пользователя хранятся в облаке Telegram (CloudStorage).
// Модуль отвечает приложению так же, как отвечал бы сервер (/api/...), поэтому интерфейс не меняется.
// Вне Telegram (просто в браузере) данные хранятся в localStorage этого браузера.
(function () {
  const P = window.MonetkaParser;
  const tgw = window.Telegram && window.Telegram.WebApp;
  const CURS = ['RUB', 'USD', 'EUR'];
  const KINDS = ['card', 'cash', 'save'];
  const CHUNK = 3900; // CloudStorage: до 4096 символов на значение
  const DEFAULT_RATES = { RUB: 1, USD: 82, EUR: 93 };

  // ---------- низкоуровневое хранилище ----------
  const useCloud = !!(tgw && tgw.initData && tgw.CloudStorage && tgw.isVersionAtLeast && tgw.isVersionAtLeast('6.9'));
  const mem = {};
  const ls = {
    get(k) { try { const v = localStorage.getItem('monetka:' + k); return v === null ? (k in mem ? mem[k] : null) : v; } catch { return k in mem ? mem[k] : null; } },
    set(k, v) { mem[k] = v; try { localStorage.setItem('monetka:' + k, v); } catch {} },
    del(k) { delete mem[k]; try { localStorage.removeItem('monetka:' + k); } catch {} },
    keys() {
      const out = new Set(Object.keys(mem));
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('monetka:')) out.add(k.slice(8)); } } catch {}
      return [...out];
    },
  };
  const cs = tgw && tgw.CloudStorage;
  const cb = (fn) => new Promise((res, rej) => fn((err, val) => (err ? rej(new Error('Облако Telegram не ответило: ' + err)) : res(val))));
  const raw = useCloud ? {
    keys: () => cb((done) => cs.getKeys(done)),
    getMany: async (keys) => {
      const out = {};
      for (let i = 0; i < keys.length; i += 20) Object.assign(out, await cb((done) => cs.getItems(keys.slice(i, i + 20), done)));
      return out;
    },
    set: (k, v) => cb((done) => cs.setItem(k, v, done)),
    del: (keys) => (keys.length ? cb((done) => cs.removeItems(keys, done)) : Promise.resolve()),
  } : {
    keys: async () => ls.keys(),
    getMany: async (keys) => Object.fromEntries(keys.map((k) => [k, ls.get(k) || ''])),
    set: async (k, v) => ls.set(k, v),
    del: async (keys) => keys.forEach((k) => ls.del(k)),
  };

  // ---------- модель данных ----------
  // cfg:   {accounts:[{id,name,cur,kind,start,archived}], budgets:{cat:lim}, nextAcc, nextId}
  // learn: {слово: категория}
  // m<YYYY-MM>-<n>: операции месяца, по строке на операцию: id;день;i|o;cat;amt;acc;note
  let D = null; // {cfg, learn, months: {'2026-11': [tx...]}, chunks: {'2026-11': n}, rates, ratesDate}
  let queue = Promise.resolve(); // записи в облако идут строго по очереди

  const clean = (s) => String(s || '').replace(/[;\n\r]/g, ' ').slice(0, 120);
  function encodeMonth(list) {
    return list.map((t) => [t.id, t.date.slice(8), t.type === 'in' ? 'i' : 'o', t.cat, t.amt, t.acc, clean(t.note), clean(t.key).slice(0, 40)].join(';'));
  }
  function decodeMonth(month, text) {
    const out = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      const [id, day, ty, cat, amt, acc, note, key] = line.split(';');
      out.push({ id: +id, date: `${month}-${day}`, type: ty === 'i' ? 'in' : 'out', cat, amt: +amt, acc: +acc, note: note || '', key: key || '' });
    }
    return out;
  }
  function chunkLines(lines) {
    const chunks = []; let cur = '';
    for (const l of lines) {
      if (cur && cur.length + 1 + l.length > CHUNK) { chunks.push(cur); cur = l; } else cur = cur ? cur + '\n' + l : l;
    }
    if (cur) chunks.push(cur);
    return chunks;
  }

  async function load() {
    const keys = await raw.keys();
    const vals = await raw.getMany(keys);
    let cfg = null, learn = {}, rates = null;
    try { cfg = vals.cfg ? JSON.parse(vals.cfg) : null; } catch {}
    try { learn = vals.learn ? JSON.parse(vals.learn) : {}; } catch {}
    try { rates = vals.rates ? JSON.parse(vals.rates) : null; } catch {}
    const months = {}, chunks = {};
    const mk = keys.filter((k) => /^m\d{4}-\d{2}-\d+$/.test(k)).sort((a, b) => {
      const [, ma, na] = a.match(/^m(\d{4}-\d{2})-(\d+)$/), [, mb, nb] = b.match(/^m(\d{4}-\d{2})-(\d+)$/);
      return ma < mb ? -1 : ma > mb ? 1 : na - nb;
    });
    for (const k of mk) {
      const [, m] = k.match(/^m(\d{4}-\d{2})-\d+$/);
      (months[m] = months[m] || []).push(...decodeMonth(m, vals[k] || ''));
      chunks[m] = (chunks[m] || 0) + 1;
    }
    if (!cfg) {
      cfg = { accounts: [{ id: 1, name: 'Карта', cur: 'RUB', kind: 'card', start: 0 }, { id: 2, name: 'Наличные', cur: 'RUB', kind: 'cash', start: 0 }], budgets: {}, nextAcc: 3, nextId: 1 };
      await raw.set('cfg', JSON.stringify(cfg));
    }
    let maxId = 0; for (const m in months) for (const t of months[m]) maxId = Math.max(maxId, t.id);
    cfg.nextId = Math.max(cfg.nextId || 1, maxId + 1);
    D = { cfg, learn, months, chunks, rates: (rates && rates.v) || { ...DEFAULT_RATES }, ratesDate: rates && rates.date };
    refreshRates();
  }

  async function refreshRates() {
    try {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 5000);
      const r = await fetch('https://www.cbr-xml-daily.ru/daily_json.js', { signal: ctl.signal });
      clearTimeout(tm);
      const j = await r.json();
      D.rates = { RUB: 1, USD: j.Valute.USD.Value / j.Valute.USD.Nominal, EUR: j.Valute.EUR.Value / j.Valute.EUR.Nominal };
      D.ratesDate = j.Date;
      save('rates', JSON.stringify({ v: D.rates, date: j.Date }));
      window.dispatchEvent(new CustomEvent('monetka:rates', { detail: D.rates }));
    } catch { /* остаются сохранённые курсы */ }
  }

  function save(key, value) { queue = queue.then(() => raw.set(key, value)); return queue; }
  function saveCfg() { return save('cfg', JSON.stringify(D.cfg)); }
  function saveLearn() {
    let entries = Object.entries(D.learn);
    let s = JSON.stringify(D.learn);
    while (s.length > 4000 && entries.length) { entries = entries.slice(1); s = JSON.stringify(Object.fromEntries(entries)); }
    D.learn = Object.fromEntries(entries);
    return save('learn', s);
  }
  function saveMonth(m) {
    const list = (D.months[m] || []).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
    const chunks = chunkLines(encodeMonth(list));
    const old = D.chunks[m] || 0;
    D.chunks[m] = chunks.length;
    queue = queue.then(async () => {
      for (let i = 0; i < chunks.length; i++) await raw.set(`m${m}-${i}`, chunks[i]);
      const extra = []; for (let i = chunks.length; i < old; i++) extra.push(`m${m}-${i}`);
      await raw.del(extra);
    });
    return queue;
  }

  // ---------- логика, как на сервере ----------
  class BadRequest extends Error {}
  const bad = (m) => { throw new BadRequest(m); };
  const allTx = () => Object.values(D.months).flat();
  const ownAccount = (id) => D.cfg.accounts.find((a) => a.id === Number(id) && !a.archived);
  function accounts() {
    const bal = {};
    for (const t of allTx()) bal[t.acc] = (bal[t.acc] || 0) + (t.type === 'in' ? t.amt : -t.amt);
    return D.cfg.accounts.filter((a) => !a.archived).map((a) => ({ id: a.id, name: a.name, cur: a.cur, kind: a.kind, balance: Math.round((a.start + (bal[a.id] || 0)) * 100) / 100 }));
  }
  function cleanTx(t) {
    if (!['in', 'out'].includes(t.type)) bad('Неизвестный тип операции');
    if (!(t.type === 'in' ? P.INCATS[t.cat] : P.CATS[t.cat])) bad('Неизвестная категория');
    const amt = Number(t.amt); if (!(amt > 0 && amt < 1e9)) bad('Сумма должна быть больше нуля');
    if (!ownAccount(t.acc)) bad('Счёт не найден');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date || '') || isNaN(P.fromYmd(t.date))) bad('Неверная дата');
    return { type: t.type, cat: t.cat, amt: Math.round(amt * 100) / 100, acc: Number(t.acc), date: t.date, note: clean(t.note), key: clean(t.key).slice(0, 40) };
  }
  const pub = (t) => ({ id: t.id, date: t.date, type: t.type, cat: t.cat, amt: t.amt, acc: t.acc, note: t.note });
  function findTx(id) {
    for (const m in D.months) { const i = D.months[m].findIndex((t) => t.id === id); if (i >= 0) return { m, i, t: D.months[m][i] }; }
    return null;
  }
  const monthOf = (date) => date.slice(0, 7);

  async function call(method, url, body) {
    if (!D) await load();
    const seg = url.split('/').filter(Boolean).slice(1);
    const id = seg[1] !== undefined ? Number(seg[1]) : null;

    if (method === 'GET' && seg[0] === 'state') {
      const today = P.ymd(new Date());
      const t = P.fromYmd(today), since = P.ymd(new Date(t.getFullYear() - 1, t.getMonth() - 1, 1));
      return {
        accounts: accounts(), budgets: { ...D.cfg.budgets }, learned: { ...D.learn },
        txs: allTx().filter((x) => x.date >= since).map(pub), today, rates: D.rates, ratesDate: D.ratesDate,
        storage: useCloud ? 'cloud' : 'local',
        user: tgw && tgw.initDataUnsafe && tgw.initDataUnsafe.user ? { id: tgw.initDataUnsafe.user.id, first_name: tgw.initDataUnsafe.user.first_name } : null,
      };
    }
    if (seg[0] === 'tx') {
      if (method === 'POST') {
        const list = Array.isArray(body) ? body : [body];
        if (!list.length || list.length > 20) bad('Можно добавить от 1 до 20 операций за раз');
        const cleaned = list.map(cleanTx);
        const touched = new Set(), added = [];
        for (const c of cleaned) {
          const t = { id: D.cfg.nextId++, ...c };
          (D.months[monthOf(t.date)] = D.months[monthOf(t.date)] || []).push(t);
          touched.add(monthOf(t.date)); added.push(t);
        }
        for (const t of list) if (t.learn && t.key) D.learn[P.norm(t.key)] = t.cat;
        saveCfg(); for (const m of touched) saveMonth(m); if (list.some((t) => t.learn)) saveLearn();
        await queue;
        return { txs: added.map(pub), accounts: accounts() };
      }
      if (method === 'PATCH' && id) {
        const f = findTx(id); if (!f) bad('Операция не найдена');
        const c = cleanTx({ ...f.t, ...body });
        const nt = { ...f.t, ...c, key: f.t.key };
        D.months[f.m].splice(f.i, 1);
        (D.months[monthOf(nt.date)] = D.months[monthOf(nt.date)] || []).push(nt);
        saveMonth(f.m); if (monthOf(nt.date) !== f.m) saveMonth(monthOf(nt.date));
        await queue;
        return { tx: pub(nt), accounts: accounts() };
      }
      if (method === 'DELETE' && id) {
        const f = findTx(id);
        if (f) { D.months[f.m].splice(f.i, 1); saveMonth(f.m); await queue; }
        return { ok: true, accounts: accounts() };
      }
    }
    if (seg[0] === 'budget' && seg[1]) {
      if (!P.CATS[seg[1]]) bad('Неизвестная категория');
      if (method === 'PUT') {
        const v = Math.round(Number(body.lim)); if (!(v > 0 && v < 1e9)) bad('Лимит должен быть больше нуля');
        D.cfg.budgets[seg[1]] = v; await saveCfg(); return { cat: seg[1], lim: v };
      }
      if (method === 'DELETE') { delete D.cfg.budgets[seg[1]]; await saveCfg(); return { ok: true }; }
    }
    if (seg[0] === 'account') {
      if (method === 'POST') {
        const name = String(body.name || '').trim().slice(0, 40); if (!name) bad('Введите название счёта');
        if (!CURS.includes(body.cur)) bad('Неизвестная валюта');
        const bal = Number(body.balance || 0); if (!isFinite(bal)) bad('Неверный баланс');
        if (D.cfg.accounts.length >= 20) bad('Можно завести до 20 счетов');
        const a = { id: D.cfg.nextAcc++, name, cur: body.cur, kind: KINDS.includes(body.kind) ? body.kind : 'card', start: bal };
        D.cfg.accounts.push(a); await saveCfg();
        return { account: accounts().find((x) => x.id === a.id) };
      }
      const a = ownAccount(id); if (!a) bad('Счёт не найден');
      if (method === 'PATCH') {
        if (body.name !== undefined) { const n = String(body.name).trim().slice(0, 40); if (!n) bad('Введите название счёта'); a.name = n; }
        if (body.balance !== undefined) {
          const bal = Number(body.balance); if (!isFinite(bal)) bad('Неверный баланс');
          a.start += bal - accounts().find((x) => x.id === a.id).balance;
        }
        await saveCfg(); return { account: accounts().find((x) => x.id === a.id) };
      }
      if (method === 'DELETE') {
        if (accounts().length <= 1) bad('Нужен хотя бы один счёт');
        a.archived = 1; await saveCfg(); return { ok: true };
      }
    }
    bad('Неизвестный запрос');
  }

  window.MonetkaStore = { call, useCloud, _reset: () => { D = null; } };
})();
