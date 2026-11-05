// Монетка — мини-приложение без сервера. Данные хранит store.js в облаке Telegram (CloudStorage).
const tgw = window.Telegram && window.Telegram.WebApp;
const P = window.MonetkaParser;
const { CATS, INCATS, ALLC, MONTHS_G } = P;
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_P = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
const MSHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const SYM = { RUB: '₽', EUR: '€', USD: '$' };
const KIND = { card: 'Карта', cash: 'Наличные', save: 'Накопления' };

let S = null, TODAY = new Date(), RATES = { RUB: 1 };
let tab = 'home', month = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1), opsFilter = 'all', showAll = false;
let F = null; // open sheet form: {kind: 'tx' | 'limit' | 'acc', ...}
let busy = false;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v, cur = 'RUB', sign = '') => (sign || (v < 0 ? '−' : '')) + new Intl.NumberFormat('ru-RU', { maximumFractionDigits: cur === 'RUB' ? 0 : 2 }).format(Math.abs(v)) + ' ' + SYM[cur];
const accOf = (id) => (S && S.accounts.find((a) => a.id === Number(id))) || { id, name: 'Архивный счёт', cur: 'RUB', kind: 'card', balance: 0 };
const toRub = (t) => t.amt * (RATES[accOf(t.acc).cur] || 1);
const inMonth = (t, m = month) => t.date.getFullYear() === m.getFullYear() && t.date.getMonth() === m.getMonth();
const isCurMonth = () => month.getFullYear() === TODAY.getFullYear() && month.getMonth() === TODAY.getMonth();
const sorted = (l) => [...l].sort((a, b) => b.date - a.date || b.id - a.id);
const haptic = (t) => { try { tgw && tgw.HapticFeedback.notificationOccurred(t); } catch {} };
const ctx = () => ({ today: P.ymd(TODAY), learned: S.learned, accounts: S.accounts });
const parseNum = (s) => parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));

const CONFIG = window.MONETKA_CONFIG || {};
async function api(method, url, body) {
  try { return await window.MonetkaStore.call(method, url, body); }
  catch (e) { throw new Error(e.message || 'Не удалось сохранить, попробуйте ещё раз'); }
}
const local = (t) => ({ ...t, date: P.fromYmd(t.date) });

async function load() {
  try {
    const j = await api('GET', '/api/state');
    S = { ...j, txs: j.txs.map(local) };
    TODAY = P.fromYmd(j.today); RATES = j.rates;
    month = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
    render();
  } catch (e) {
    $('.monthrow').hidden = true;
    $('#screen').innerHTML = `<div class="list" style="margin-top:24px"><div class="empty">${esc(e.message)}<br><br><button class="primary" id="retry">Повторить</button></div></div>`;
  }
}

function monthTotals(m = month) {
  let inc = 0, out = 0;
  for (const t of S.txs) if (inMonth(t, m)) { if (t.type === 'in') inc += toRub(t); else out += toRub(t); }
  return { inc, out };
}
const spentIn = (cat, m = month) => S.txs.filter((t) => inMonth(t, m) && t.type === 'out' && t.cat === cat).reduce((s, t) => s + toRub(t), 0);
function budgetNote(t) {
  const lim = S.budgets[t.cat]; if (t.type !== 'out' || !lim || !inMonth(t, TODAY)) return '';
  const s = spentIn(t.cat, TODAY), n = CATS[t.cat].n.toLowerCase();
  if (s > lim) return `Лимит на ${n} превышен на ${fmt(s - lim)}`;
  if (s > lim * 0.8) return `На ${n} осталось ${fmt(lim - s)} из ${fmt(lim)}`;
  return '';
}
function minMonth() {
  const first = S.txs.reduce((m, t) => (t.date < m ? t.date : m), TODAY);
  return new Date(first.getFullYear(), first.getMonth(), 1);
}

// ---------- views ----------
function render() {
  if (!S) return;
  $('#mLabel').textContent = MONTHS[month.getMonth()] + ' ' + month.getFullYear();
  $('#mNext').disabled = isCurMonth();
  $('#mPrev').disabled = month <= minMonth();
  $('.monthrow').hidden = false;
  document.querySelectorAll('.tab').forEach((b) => { if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $('#screen').innerHTML = { home: homeView, ops: opsView, budgets: budgetsView, stats: statsView }[tab]();
}

function txRow(t) {
  const c = ALLC[t.cat], a = accOf(t.acc);
  return `<button class="tx" data-tx="${t.id}">
    <span class="ico" style="background:color-mix(in srgb,${c.c} 16%,transparent)">${c.e}</span>
    <span class="mid"><span class="t">${esc(t.note || c.n)}</span><span class="s">${c.n} · ${esc(a.name)}</span></span>
    <span class="a num ${t.type === 'in' ? 'in' : ''}">${fmt(t.amt, a.cur, t.type === 'in' ? '+' : '−')}</span></button>`;
}
function rows(list) {
  let html = '', last = '';
  for (const t of list) {
    const key = t.date.toDateString();
    if (key !== last) { html += `<div class="day">${t.date.getDate()} ${MONTHS_G[t.date.getMonth()]}${key === TODAY.toDateString() ? ' · сегодня' : ''}</div>`; last = key; }
    html += txRow(t);
  }
  return html;
}

function homeView() {
  const total = S.accounts.reduce((s, a) => s + a.balance * (RATES[a.cur] || 1), 0);
  const { inc, out } = monthTotals();
  const recent = sorted(S.txs.filter((t) => inMonth(t))).slice(0, 6);
  return `
  <section class="hero">
    <div><div class="label">Всего на счетах</div><div class="total num">${fmt(total)}</div></div>
    <div class="row">
      <div><span class="label">Доходы · ${MSHORT[month.getMonth()]}</span><b class="num">${fmt(inc, 'RUB', '+')}</b></div>
      <div><span class="label">Расходы · ${MSHORT[month.getMonth()]}</span><b class="num">${fmt(out, 'RUB', '−')}</b></div>
    </div>
  </section>
  ${S.storage === 'local' ? '<div class="pace" style="text-align:center;margin-top:10px">Открыто в браузере: записи хранятся только в этом браузере. В Telegram они сохраняются в вашем аккаунте и видны на всех устройствах.</div>' : ''}
  <section class="quick">
    <label class="label" for="qIn">Быстрая запись</label>
    <div class="rowi"><input id="qIn" placeholder="Например: такси 600 вчера" autocomplete="off" enterkeyhint="done"><button class="send" id="qAdd" aria-label="Добавить" disabled>↵</button></div>
    <div class="preview" id="qPreview">Пишите как в заметке, категория определится сама</div>
    <div style="display:flex;gap:16px;flex-wrap:wrap"><button class="linkbtn" id="manual">Заполнить вручную</button></div>
  </section>
  <h2>Счета</h2>
  <div class="accounts">${S.accounts.map((a) => `<button class="acc" data-acc="${a.id}"><span class="n">${esc(a.name)}</span><span class="v num">${fmt(a.balance, a.cur)}</span><span class="c">${a.cur === 'RUB' ? KIND[a.kind] : '≈ ' + fmt(a.balance * (RATES[a.cur] || 1))}</span></button>`).join('')}
    <button class="more" id="addAcc">+ Добавить счёт</button></div>
  ${!S.txs.length && S.accounts.every((a) => !a.balance) ? '<div class="pace" style="padding:6px 16px 0">Нажмите на счёт, чтобы указать, сколько на нём сейчас денег</div>' : ''}
  <h2>Последние операции</h2>
  <div class="list">${recent.length ? rows(recent) + '<button class="more" data-go="ops">Все операции</button>'
    : `<div class="empty">${S.txs.length ? 'В этом месяце операций нет.' : 'Операций пока нет. Напишите «кофе 350» в строке выше или боту в чат.'}</div>`}</div>`;
}

function opsView() {
  let list = sorted(S.txs.filter((t) => inMonth(t) && (opsFilter === 'all' || t.type === opsFilter)));
  const full = list.length; if (!showAll) list = list.slice(0, 60);
  const chip = (v, l) => `<button class="chip" data-filter="${v}" aria-pressed="${opsFilter === v}">${l}</button>`;
  return `<h2>Операции</h2>
  <div class="chips">${chip('all', 'Все')}${chip('out', 'Расходы')}${chip('in', 'Доходы')}</div>
  <div class="list">${list.length ? rows(list) : '<div class="empty">В этом месяце операций нет.</div>'}${full > list.length ? `<button class="more" data-showall>Показать ещё ${full - list.length}</button>` : ''}</div>`;
}

function budgetsView() {
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const passed = isCurMonth() ? TODAY.getDate() : days;
  const keys = Object.keys(S.budgets);
  const totalB = keys.reduce((a, k) => a + S.budgets[k], 0);
  const totalS = keys.reduce((s, k) => s + spentIn(k), 0);
  const free = Object.keys(CATS).filter((k) => !S.budgets[k]);
  const addBtn = free.length ? '<button class="addlim" id="addLimit">+ Добавить лимит</button>' : '';
  const title = `<h2>Бюджеты на ${MONTHS[month.getMonth()].toLowerCase()}</h2>`;
  if (!keys.length) return `${title}<div class="list"><div class="empty">Лимитов пока нет.<br>Задайте сумму на месяц для категории, и я буду следить за темпом трат. Боту можно написать «лимит кафе 7000».</div></div><div class="budgets" style="margin-top:8px">${addBtn}</div>`;
  const items = keys.map((k) => {
    const lim = S.budgets[k], s = spentIn(k), p = s / lim, exp = passed / days, c = CATS[k];
    const st = p >= 1 ? ['bad', 'Превышен'] : p > exp * 1.15 ? ['warn', 'Быстрый темп'] : ['ok', 'В норме'];
    const col = st[0] === 'ok' ? 'var(--good)' : st[0] === 'warn' ? 'var(--warn)' : 'var(--bad)';
    const left = lim - s;
    const pace = isCurMonth() && left > 0 ? `Можно тратить ~${fmt(left / (days - passed + 1))} в день до конца месяца` : left < 0 ? `Сверх лимита на ${fmt(-left)}` : '';
    return `<button class="budget" data-budget="${k}" aria-label="Изменить лимит: ${c.n}">
      <div class="h"><span class="ico" style="background:color-mix(in srgb,${c.c} 16%,transparent)">${c.e}</span><span class="nm">${c.n}</span><span class="pill ${st[0]}">${st[1]}</span></div>
      <div class="bar"><i style="width:${Math.min(100, p * 100).toFixed(1)}%;background:${col}"></i></div>
      <div class="f"><span><b class="num">${fmt(s)}</b> из <span class="num">${fmt(lim)}</span></span><span class="num">${Math.round(p * 100)}%</span></div>
      ${pace ? `<div class="pace">${pace}</div>` : ''}</button>`;
  }).join('');
  return `${title}
  <div class="card" style="display:grid;gap:8px;margin-bottom:8px">
    <div style="display:flex;justify-content:space-between"><span class="label">Потрачено по лимитам</span><span class="label num">день ${passed} из ${days}</span></div>
    <div style="font-weight:700;font-size:22px" class="num">${fmt(totalS)} <span style="font-size:14px;color:var(--muted);font-weight:400">из ${fmt(totalB)}</span></div>
    <div class="bar"><i style="width:${Math.min(100, (totalS / totalB) * 100)}%;background:var(--accent)"></i></div>
  </div>
  <div class="budgets">${items}${addBtn}</div>
  <p class="pace" style="text-align:center;margin-top:10px">Нажмите на бюджет, чтобы изменить или убрать лимит</p>`;
}

function statsView() {
  const by = {}; let out = 0;
  S.txs.filter((t) => inMonth(t) && t.type === 'out').forEach((t) => { const v = toRub(t); by[t.cat] = (by[t.cat] || 0) + v; out += v; });
  const parts = Object.entries(by).sort((a, b) => b[1] - a[1]);
  const R = 54, C = 2 * Math.PI * R; let off = 0;
  const arcs = parts.map(([k, v]) => { const len = (v / out) * C; const s = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${CATS[k].c}" stroke-width="20" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"/>`; off += len; return s; }).join('');
  const compact = (v) => new Intl.NumberFormat('ru-RU', { notation: 'compact' }).format(v);
  const donut = `<svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="Расходы по категориям">
      <circle r="${R}" cx="70" cy="70" fill="none" stroke="var(--line)" stroke-width="20"/>${arcs}
      <text x="70" y="66" text-anchor="middle" style="font-size:11px;fill:var(--muted)">расходы</text>
      <text x="70" y="84" text-anchor="middle" style="font-size:14px;font-weight:600;fill:var(--fg)">${compact(out)} ₽</text></svg>`;
  const legend = parts.map(([k, v]) => `<div><i style="background:${CATS[k].c}"></i><span>${CATS[k].n}</span><b class="num">${fmt(v)}</b><em class="num">${Math.round((v / out) * 100)}%</em></div>`).join('');

  const ms = [2, 1, 0].map((i) => new Date(month.getFullYear(), month.getMonth() - i, 1)).filter((m) => m >= minMonth());
  const data = ms.map((m) => ({ m, ...monthTotals(m) }));
  const max = Math.max(1, ...data.flatMap((d) => [d.inc, d.out]));
  const step = Math.pow(10, Math.floor(Math.log10(max))); const top = Math.ceil(max / step) * step;
  const W = 330, H = 170, pl = 54, pb = 22, pt = 8, ih = H - pb - pt, gw = (W - pl) / data.length, bw = Math.min(26, gw / 3.2);
  const y = (v) => pt + ih - (v / top) * ih;
  const ticks = [0, top / 2, top].map((v) => `<line x1="${pl}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`).join('');
  const cur = (m) => m.getMonth() === TODAY.getMonth() && m.getFullYear() === TODAY.getFullYear();
  const bars = data.map((d, i) => { const cx = pl + gw * i + gw / 2; return `
    <rect x="${cx - bw - 2}" y="${y(d.inc)}" width="${bw}" height="${ih - (y(d.inc) - pt)}" rx="4" fill="var(--accent)"/>
    <rect x="${cx + 2}" y="${y(d.out)}" width="${bw}" height="${ih - (y(d.out) - pt)}" rx="4" fill="var(--warn)"/>
    <text x="${cx}" y="${H - 5}" text-anchor="middle">${MSHORT[d.m.getMonth()]}${cur(d.m) ? ' *' : ''}</text>`; }).join('');
  const top3 = S.txs.filter((t) => inMonth(t) && t.type === 'out').sort((a, b) => toRub(b) - toRub(a)).slice(0, 3);
  return `<h2>Куда ушли деньги</h2>
  <div class="card">${out ? `<div class="donut-wrap">${donut}<div class="legend">${legend}</div></div>` : '<div class="empty">Расходов в этом месяце пока нет.</div>'}</div>
  <h2>Доходы и расходы</h2>
  <div class="card bars"><div class="bars-wrap"><svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:280px" role="img" aria-label="Доходы и расходы по месяцам">${ticks}${bars}</svg></div>
  <div class="key"><span><i style="background:var(--accent)"></i>Доходы</span><span><i style="background:var(--warn)"></i>Расходы</span>${ms.some(cur) ? '<span>* месяц идёт</span>' : ''}</div></div>
  ${top3.length ? `<h2>Самые крупные траты</h2><div class="list">${top3.map(txRow).join('')}</div>` : ''}
  ${CONFIG.supportUrl ? `<section class="support">
    <div class="star" aria-hidden="true">★</div>
    <h2 style="margin:0">Поддержать Монетку</h2>
    <p>${esc(CONFIG.supportText || 'Приложение бесплатное и без рекламы. Если оно помогает вам следить за деньгами, можно поддержать разработку.')}</p>
    <button class="primary" id="donate" style="width:100%">Поддержать</button>
  </section>` : ''}`;
}

// ---------- sheets ----------
function showSheet(html, label) {
  $('#sheetHost').innerHTML = `<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-label="${esc(label)}"><div class="grab"></div>${html}</div></div>`;
  try { tgw && tgw.BackButton.show(); } catch {}
}
function closeSheet() {
  $('#sheetHost').innerHTML = ''; F = null;
  try { tgw && tgw.BackButton.hide(); } catch {}
}
const isoDate = (d) => P.ymd(d);

function openTx(t) {
  F = t ? { kind: 'tx', ...t, amtStr: String(t.amt), edit: true } : { kind: 'tx', type: 'out', cat: 'food', acc: (S.accounts[0] || {}).id, date: new Date(TODAY), note: '', amtStr: '' };
  drawTx();
}
function drawTx() {
  const cats = F.type === 'out' ? CATS : INCATS;
  if (!cats[F.cat]) F.cat = Object.keys(cats)[0];
  const cur = accOf(F.acc).cur;
  showSheet(`
    <div class="seg"><button data-type="out" aria-pressed="${F.type === 'out'}">Расход</button><button data-type="in" aria-pressed="${F.type === 'in'}">Доход</button></div>
    <div class="amount"><input id="amt" inputmode="decimal" placeholder="0" value="${esc(F.amtStr)}" aria-label="Сумма"><span class="cur">${SYM[cur]}</span></div>
    <div class="cats">${Object.entries(cats).map(([k, c]) => `<button class="cat" data-cat="${k}" aria-pressed="${F.cat === k}"><span style="font-size:18px">${c.e}</span><span>${c.n}</span></button>`).join('')}</div>
    <div class="two">
      <div class="field"><label for="acc">Счёт</label><select id="acc">${S.accounts.map((a) => `<option value="${a.id}" ${a.id === Number(F.acc) ? 'selected' : ''}>${esc(a.name)} · ${SYM[a.cur]}</option>`).join('')}</select></div>
      <div class="field"><label for="date">Дата</label><input id="date" type="date" value="${isoDate(F.date)}" max="${isoDate(TODAY)}"></div>
    </div>
    <div class="field"><label for="note">Комментарий</label><input id="note" placeholder="Например, «Пятёрочка»" value="${esc(F.note || '')}" maxlength="120"></div>
    <div class="err" id="err"></div>
    <button class="primary" id="save">${F.edit ? 'Сохранить изменения' : 'Добавить'}</button>
    ${F.edit ? '<button class="danger" id="del">Удалить операцию</button>' : ''}`, F.edit ? 'Операция' : 'Новая операция');
  if (!F.edit) setTimeout(() => $('#amt') && $('#amt').focus(), 50);
}

function avgSpent(k) {
  const ms = [1, 2].map((i) => new Date(TODAY.getFullYear(), TODAY.getMonth() - i, 1));
  return ms.reduce((s, m) => s + spentIn(k, m), 0) / ms.length;
}
const round500 = (v) => Math.max(500, Math.round(v / 500) * 500);
function openLimit(k) { F = { kind: 'limit', cat: k || null, edit: !!k, amtStr: k ? String(S.budgets[k]) : '' }; drawLimit(); }
function drawLimit() {
  const free = Object.keys(CATS).filter((k) => !S.budgets[k] || (k === F.cat && F.edit));
  const k = F.cat, c = k && CATS[k], avg = k ? avgSpent(k) : 0;
  const sugg = avg > 0 ? [...new Set([round500(avg * 0.9), round500(avg), round500(avg * 1.1)])] : [];
  const p1 = new Date(TODAY.getFullYear(), TODAY.getMonth() - 2, 1), p2 = new Date(TODAY.getFullYear(), TODAY.getMonth() - 1, 1);
  showSheet(`
    <h2 style="margin:0;text-align:center">${F.edit ? `Лимит: ${c.n}` : 'Новый лимит'}</h2>
    ${F.edit ? '' : `<div class="cats">${free.map((x) => `<button class="cat" data-limcat="${x}" aria-pressed="${k === x}"><span style="font-size:18px">${CATS[x].e}</span><span>${CATS[x].n}</span></button>`).join('')}</div>`}
    ${k ? `
      <div class="amount"><input id="limAmt" inputmode="numeric" placeholder="0" value="${esc(F.amtStr)}" aria-label="Сумма лимита в месяц"><span class="cur">₽</span></div>
      <div class="pace" style="text-align:center">${avg > 0 ? `В ${MONTHS_P[p1.getMonth()]} и ${MONTHS_P[p2.getMonth()]} в среднем уходило <b class="num">${fmt(avg)}</b> в месяц` : 'По этой категории ещё нет трат за прошлые месяцы'}</div>
      ${sugg.length ? `<div class="chips" style="justify-content:center;margin:0">${sugg.map((v) => `<button class="chip" data-sug="${v}">${fmt(v)}</button>`).join('')}</div>` : ''}
      <div class="pace" style="text-align:center">Лимит действует каждый месяц, пока вы его не измените</div>
      <div class="err" id="err"></div>
      <button class="primary" id="limSave">${F.edit ? 'Сохранить' : 'Установить лимит'}</button>
      ${F.edit ? '<button class="danger" id="limDel">Убрать лимит</button>' : ''}` : '<div class="pace" style="text-align:center">Выберите категорию</div>'}`, 'Лимит на месяц');
  if (k) setTimeout(() => { const i = $('#limAmt'); if (i) { i.focus(); i.select(); } }, 50);
}

function openAcc(a) {
  F = a ? { kind: 'acc', id: a.id, name: a.name, cur: a.cur, acckind: a.kind, balStr: String(Math.round(a.balance * 100) / 100), edit: true }
    : { kind: 'acc', name: '', cur: 'RUB', acckind: 'card', balStr: '', edit: false };
  drawAcc();
}
function drawAcc() {
  showSheet(`
    <h2 style="margin:0;text-align:center">${F.edit ? 'Счёт' : 'Новый счёт'}</h2>
    <div class="field"><label for="accName">Название</label><input id="accName" placeholder="Например, Сбер или Копилка" value="${esc(F.name)}" maxlength="40"></div>
    ${F.edit ? '' : `
    <div class="field"><label>Валюта</label><div class="seg" style="grid-template-columns:repeat(3,1fr)">${['RUB', 'USD', 'EUR'].map((c) => `<button data-cur="${c}" aria-pressed="${F.cur === c}">${SYM[c]} ${c}</button>`).join('')}</div></div>
    <div class="field"><label>Тип</label><div class="seg" style="grid-template-columns:repeat(3,1fr)">${Object.entries(KIND).map(([k, n]) => `<button data-acckind="${k}" aria-pressed="${F.acckind === k}">${n}</button>`).join('')}</div></div>`}
    <div class="field"><label for="accBal">Сейчас на счёте, ${SYM[F.cur]}</label><input id="accBal" inputmode="decimal" placeholder="0" value="${esc(F.balStr)}"></div>
    <div class="pace" style="text-align:center">${F.edit ? 'Если баланс не сходится с банком, просто введите точную сумму: операции останутся на месте' : 'С этой суммы начнётся учёт по счёту'}</div>
    <div class="err" id="err"></div>
    <button class="primary" id="accSave">${F.edit ? 'Сохранить' : 'Добавить счёт'}</button>
    ${F.edit && S.accounts.length > 1 ? '<button class="danger" id="accDel">Убрать счёт</button>' : ''}`, 'Счёт');
}

// ---------- quick entry ----------
function quickPreview() {
  const v = $('#qIn').value, parts = P.parseMany(v, ctx()), ok = parts.filter((p) => p.res);
  const desc = (p) => `${ALLC[p.cat].e} <b>${ALLC[p.cat].n}</b> · <span class="num">${fmt(p.amt, accOf(p.acc).cur, p.type === 'in' ? '+' : '−')}</span> · ${P.dateText(p.date, P.ymd(TODAY))} · ${esc(accOf(p.acc).name)}`;
  $('#qAdd').disabled = !ok.length;
  $('#qPreview').innerHTML = !v.trim() ? 'Пишите как в заметке, категория определится сама'
    : ok.length ? ok.map((p) => `<span>→ ${desc(p.res)}${p.res.sure ? '' : ' · <em>категория не распознана</em>'}</span>`).join('') + (ok.length < parts.length ? '<span>Часть без суммы будет пропущена</span>' : '')
    : 'Не вижу сумму. Добавьте число, например «кофе 350»';
}
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; t.setAttribute('role', 'status');
  document.body.appendChild(t); setTimeout(() => t.remove(), 2200);
}
function applyAccounts(list) { if (list) S.accounts = list; }

// Runs a server action once at a time; shows errors in the sheet or as a toast
async function run(fn) {
  if (busy) return; busy = true;
  try { await fn(); }
  catch (e) { const el = $('#err'); if (el && F) el.textContent = e.message; else toast(e.message); haptic('error'); }
  finally { busy = false; }
}

// ---------- events ----------
document.addEventListener('input', (e) => {
  if (e.target.id === 'qIn') return quickPreview();
  if (!F) return;
  const map = { amt: 'amtStr', note: 'note', limAmt: 'amtStr', accName: 'name', accBal: 'balStr' };
  if (map[e.target.id]) F[map[e.target.id]] = e.target.value;
});
document.addEventListener('change', (e) => {
  if (!F) return;
  if (e.target.id === 'acc') { F.acc = Number(e.target.value); drawTx(); }
  if (e.target.id === 'date' && e.target.value) F.date = P.fromYmd(e.target.value);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && F) return closeSheet();
  if (e.key !== 'Enter') return;
  const target = { qIn: 'qAdd', limAmt: 'limSave', amt: 'save', note: 'save', accBal: 'accSave', accName: 'accSave' }[e.target.id];
  if (target && $('#' + target) && !$('#' + target).disabled) { e.preventDefault(); $('#' + target).click(); }
});

document.addEventListener('click', (e) => {
  const el = e.target.closest('button,#scrim'); if (!el) return;
  if (el.id === 'scrim') { if (e.target === el) closeSheet(); return; }
  if (el.id === 'retry') return load();
  if (!S) return;
  const d = el.dataset;
  if (d.tab) { tab = d.tab; showAll = false; render(); window.scrollTo(0, 0); return; }
  if (d.go) { tab = d.go; render(); window.scrollTo(0, 0); return; }
  if (d.filter) { opsFilter = d.filter; showAll = false; render(); return; }
  if ('showall' in d) { showAll = true; render(); return; }
  if (el.id === 'mPrev') { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); render(); return; }
  if (el.id === 'mNext') { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); render(); return; }
  
  // operations
  if (d.tx) return openTx(S.txs.find((t) => t.id === Number(d.tx)));
  if (el.id === 'manual') return openTx();
  if (d.type && F) { F.type = d.type; return drawTx(); }
  if (d.cat && F) { F.cat = d.cat; return drawTx(); }
  if (el.id === 'save') return run(async () => {
    const v = parseNum(F.amtStr);
    if (!(v > 0)) throw new Error('Введите сумму больше нуля');
    const body = { date: P.ymd(F.date), type: F.type, cat: F.cat, amt: v, acc: Number(F.acc), note: (F.note || '').trim() };
    if (F.edit) {
      const j = await api('PATCH', '/api/tx/' + F.id, body);
      Object.assign(S.txs.find((t) => t.id === F.id), local(j.tx)); applyAccounts(j.accounts);
    } else {
      const j = await api('POST', '/api/tx', body);
      S.txs.push(...j.txs.map(local)); applyAccounts(j.accounts);
    }
    const t = local(body); month = new Date(t.date.getFullYear(), t.date.getMonth(), 1);
    const was = F.edit; closeSheet(); render(); haptic('success');
    toast(budgetNote(t) || (was ? 'Сохранено' : t.type === 'in' ? 'Доход записан' : 'Расход записан'));
  });
  if (el.id === 'del') return run(async () => {
    const j = await api('DELETE', '/api/tx/' + F.id);
    S.txs = S.txs.filter((t) => t.id !== F.id); applyAccounts(j.accounts);
    closeSheet(); render(); haptic('success'); toast('Операция удалена');
  });
  if (el.id === 'qAdd') return run(async () => {
    const ok = P.parseMany($('#qIn').value, ctx()).filter((p) => p.res).map((p) => p.res);
    if (!ok.length) return;
    const j = await api('POST', '/api/tx', ok.map(({ type, cat, amt, acc, date, note, key }) => ({ type, cat, amt, acc, date, note, key })));
    const ts = j.txs.map(local); S.txs.push(...ts); applyAccounts(j.accounts);
    month = new Date(ts[0].date.getFullYear(), ts[0].date.getMonth(), 1);
    render(); haptic('success');
    toast(ts.map(budgetNote).find(Boolean) || (ts.length > 1 ? `Записано: ${ts.length}` : 'Записано'));
    const q = $('#qIn'); if (q) q.focus();
  });

  // limits
  if (d.budget) return openLimit(d.budget);
  if (el.id === 'addLimit') return openLimit(null);
  if (d.limcat) { F.cat = d.limcat; F.amtStr = ''; return drawLimit(); }
  if (d.sug) { F.amtStr = d.sug; $('#limAmt').value = d.sug; return; }
  if (el.id === 'limSave') return run(async () => {
    const v = parseNum(F.amtStr); if (!(v > 0)) throw new Error('Введите сумму больше нуля');
    const k = F.cat, was = F.edit;
    const j = await api('PUT', '/api/budget/' + k, { lim: v });
    S.budgets[k] = j.lim; closeSheet(); render(); haptic('success');
    toast(`Лимит на ${CATS[k].n.toLowerCase()} ${was ? 'изменён' : 'установлен'}`);
  });
  if (el.id === 'limDel') return run(async () => {
    const k = F.cat; await api('DELETE', '/api/budget/' + k);
    delete S.budgets[k]; closeSheet(); render(); toast(`Лимит на ${CATS[k].n.toLowerCase()} убран`);
  });

  // accounts
  if (d.acc) return openAcc(accOf(d.acc));
  if (el.id === 'addAcc') return openAcc(null);
  if (d.cur && F) { F.cur = d.cur; return drawAcc(); }
  if (d.acckind && F) { F.acckind = d.acckind; return drawAcc(); }
  if (el.id === 'accSave') return run(async () => {
    const bal = F.balStr.trim() === '' ? 0 : parseNum(F.balStr);
    if (!isFinite(bal)) throw new Error('Введите баланс числом');
    if (!F.name.trim()) throw new Error('Введите название счёта');
    if (F.edit) {
      const j = await api('PATCH', '/api/account/' + F.id, { name: F.name, balance: bal });
      Object.assign(accOf(F.id), j.account);
    } else {
      const j = await api('POST', '/api/account', { name: F.name, cur: F.cur, kind: F.acckind, balance: bal });
      S.accounts.push(j.account);
    }
    const was = F.edit; closeSheet(); render(); haptic('success'); toast(was ? 'Счёт сохранён' : 'Счёт добавлен');
  });
  if (el.id === 'accDel') return run(async () => {
    await api('DELETE', '/api/account/' + F.id);
    S.accounts = S.accounts.filter((a) => a.id !== F.id); closeSheet(); render();
    toast('Счёт убран. Его операции остались в истории');
  });

  // поддержка проекта
  if (el.id === 'donate') {
    const u = CONFIG.supportUrl;
    try {
      if (tgw && /^https:\/\/t\.me\//.test(u) && tgw.openTelegramLink) tgw.openTelegramLink(u);
      else if (tgw && tgw.openLink) tgw.openLink(u);
      else window.open(u, '_blank', 'noopener');
    } catch { toast('Не удалось открыть ссылку'); }
    return;
  }
});

// ---------- start ----------
if (tgw) {
  try {
    tgw.ready(); tgw.expand();
    tgw.setHeaderColor && tgw.setHeaderColor('secondary_bg_color');
    tgw.setBackgroundColor && tgw.setBackgroundColor('secondary_bg_color');
    tgw.BackButton.onClick(closeSheet);
  } catch {}
}
window.addEventListener('monetka:rates', (e) => { if (S) { S.rates = RATES = e.detail; if (!F) render(); } });
load();
