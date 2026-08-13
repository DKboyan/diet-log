/* 饮食记录 App —— 纯前端，数据存本机（原生壳里另存 JSON 文件双保险） */
'use strict';

/* ================= 数据层 ================= */
const KEY = 'diet.v1';
const DEFAULTS = {
  settings: { calTarget: 2200, proTarget: 140, weightTarget: null, height: null },
  days: {},     // "2026-07-28": { entries:[{id,name,cal,pro,meal,ts}], weight: 82.5 }
  foods: {},    // 自动记住的常用食物 "鸡胸肉100g": { cal, pro, count, last }
  library: [],  // 食物库 [{id,name,unit:'g100'|'serving',cal,pro,count,last,lastAmt}]
};

let state = load();

function parseRaw(raw) {
  if (!raw) return null;
  try { const d = JSON.parse(raw); return d && typeof d === 'object' ? d : null; } catch (e) { return null; }
}

function load() {
  // 两个来源：原生壳注入的文件备份 + localStorage，取 _rev 较新的那份
  let native = null, local = null;
  if (window.__NATIVE_DATA_B64__) {
    try {
      const bytes = Uint8Array.from(atob(window.__NATIVE_DATA_B64__), c => c.charCodeAt(0));
      native = parseRaw(new TextDecoder().decode(bytes));
    } catch (e) { native = null; }
  }
  try { local = parseRaw(localStorage.getItem(KEY)); } catch (e) { local = null; }
  const d = ((native && native._rev || 0) >= (local && local._rev || 0)) ? (native || local) : local;
  if (!d) return JSON.parse(JSON.stringify(DEFAULTS));
  // 以 d 打底透传未知字段：旧版本的壳/备份读到新版数据时不会把新字段剥掉再落盘
  return Object.assign({}, d, {
    settings: Object.assign({}, DEFAULTS.settings, d.settings || {}),
    days: d.days || {},
    foods: d.foods || {},
    library: sanitizeLibrary(d.library),
  });
}

// 食物库元素可能来自导入的备份，逐个校验收敛，防 NaN/Infinity/注入/缺字段
function sanitizeLibrary(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const f of arr) {
    if (!f || typeof f !== 'object') continue;
    const name = String(f.name || '').trim();
    if (!name) continue;
    const cal = Number(f.cal), pro = Number(f.pro);
    out.push({
      id: (typeof f.id === 'string' && f.id) ? f.id : uid(),
      name: name.slice(0, 60),
      unit: f.unit === 'serving' ? 'serving' : 'g100',
      cal: (Number.isFinite(cal) && cal >= 0 && cal <= 10000) ? Math.round(cal * 10) / 10 : 0,
      pro: (Number.isFinite(pro) && pro >= 0 && pro <= 5000) ? Math.round(pro * 10) / 10 : 0,
      count: Number.isFinite(Number(f.count)) ? Number(f.count) : 0,
      last: Number.isFinite(Number(f.last)) ? Number(f.last) : 0,
      lastAmt: (Number.isFinite(Number(f.lastAmt)) && Number(f.lastAmt) > 0) ? Number(f.lastAmt) : null,
    });
  }
  return out;
}

function validNum(v, max) { return Number.isFinite(v) && v >= 0 && v <= max; }

function save() {
  state._rev = Date.now();
  const str = JSON.stringify(state);
  try { localStorage.setItem(KEY, str); } catch (e) { /* 忽略 */ }
  try {
    if (window.webkit && webkit.messageHandlers && webkit.messageHandlers.save) {
      webkit.messageHandlers.save.postMessage(str);
    }
  } catch (e) { /* 浏览器环境无原生桥 */ }
}

/* ================= 日期工具（全部用本地时区） ================= */
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function dstr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function parseD(s) { const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd); }
function addDays(s, n) { const d = parseD(s); d.setDate(d.getDate() + n); return dstr(d); }
function todayStr() { return dstr(new Date()); }

let viewDate = todayStr();

/* ================= 通用小组件 ================= */
const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 中文输入法里按 Enter 是「上屏确认候选词」，不能当成提交。
// Safari/WKWebView 的 compositionend 先于那次 keydown 派发且 isComposing 为 false，
// 所以除了标准判断，还要看是否刚结束过合成。
let lastCompEnd = 0;
document.addEventListener('compositionend', () => { lastCompEnd = Date.now(); }, true);
function bindEnter(el, fn) {
  el.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (e.isComposing || e.keyCode === 229 || Date.now() - lastCompEnd < 120) return;
    fn();
  });
}

let toastTimer = null, undoFn = null;
function toast(msg, undo) {
  const t = $('#toast');
  $('#toast-msg').textContent = msg;
  undoFn = undo || null;
  $('#toast-undo').style.display = undo ? '' : 'none';
  t.style.display = 'flex';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.display = 'none'; undoFn = null; }, undo ? 5000 : 2000);
}

function uiConfirm(title, msg, danger, cb) {
  $('#cf-title').textContent = title;
  $('#cf-msg').textContent = msg;
  const ok = $('#cf-ok');
  ok.className = danger ? 'btn-danger' : 'btn-primary';
  ok.textContent = danger ? '确认删除' : '确认';
  $('#modal-confirm').classList.add('show');
  ok.onclick = () => { $('#modal-confirm').classList.remove('show'); cb(); };
}

/* ================= 记录页 ================= */
const MEALS = ['早餐', '午餐', '晚餐', '加餐'];
let selMeal = defaultMeal();
let editId = null; // 正在编辑的条目 id

function defaultMeal() {
  const h = new Date().getHours();
  if (h < 10) return '早餐';
  if (h < 14) return '午餐';
  if (h < 17) return '加餐';
  if (h < 21) return '晚餐';
  return '加餐';
}

function day(ds) { return state.days[ds] || { entries: [] }; }
function ensureDay(ds) {
  if (!state.days[ds]) state.days[ds] = { entries: [] };
  return state.days[ds];
}
function dayTotals(ds) {
  const d = day(ds);
  let cal = 0, pro = 0;
  for (const e of d.entries) { cal += e.cal; pro += e.pro; }
  return { cal: Math.round(cal), pro: Math.round(pro * 10) / 10 };
}

function renderDateNav() {
  const d = parseD(viewDate);
  const today = todayStr();
  const isToday = viewDate === today;
  $('#d-main').textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEK[d.getDay()];
  $('#d-sub').textContent = isToday ? '今天' : (viewDate === addDays(today, -1) ? '昨天' : d.getFullYear() + '年');
  $('#nav-next').disabled = isToday;
  $('#btn-today').style.visibility = isToday ? 'hidden' : 'visible';
  $('#date-input').value = viewDate;
  $('#date-input').max = today;
}

function ringSVG(pct, over) {
  const R = 56, C = 2 * Math.PI * R;
  const p = Math.min(pct, 1);
  const color = over ? 'var(--serious)' : 'var(--accent)';
  return '<svg viewBox="0 0 132 132" width="132" height="132">' +
    '<circle cx="66" cy="66" r="' + R + '" fill="none" stroke="var(--grid)" stroke-width="10"/>' +
    '<circle cx="66" cy="66" r="' + R + '" fill="none" stroke="' + color + '" stroke-width="10" stroke-linecap="round" ' +
    'stroke-dasharray="' + (C * p) + ' ' + C + '" transform="rotate(-90 66 66)" style="transition:stroke-dasharray .4s"/>' +
    '</svg>';
}

function renderSummary() {
  const t = dayTotals(viewDate);
  const s = state.settings;
  const overCal = t.cal > s.calTarget;
  $('#ring-box').innerHTML = ringSVG(t.cal / s.calTarget, overCal);
  $('#rc-val').textContent = t.cal;
  const remain = s.calTarget - t.cal;
  $('#cal-head').innerHTML = '热量 <b>' + t.cal + '</b>&thinsp;/&thinsp;' + s.calTarget + ' 大卡';
  const calFill = $('#cal-fill');
  calFill.style.width = Math.min(t.cal / s.calTarget * 100, 100) + '%';
  calFill.className = 'sl-fill cal' + (overCal ? ' over' : '');
  $('#pro-head').innerHTML = '蛋白质 <b>' + t.pro + '</b>&thinsp;/&thinsp;' + s.proTarget + ' 克';
  const proFill = $('#pro-fill');
  proFill.style.width = Math.min(t.pro / s.proTarget * 100, 100) + '%';
  const proDone = t.pro >= s.proTarget;
  $('#sum-note').innerHTML = (overCal
    ? '<span class="over-txt">⚠ 已超出 ' + (t.cal - s.calTarget) + ' 大卡</span>'
    : '还可摄入 <b>' + remain + '</b> 大卡')
    + ' &nbsp;·&nbsp; ' + (proDone
      ? '<span class="ok-txt">✓ 蛋白质已达标</span>'
      : '蛋白质还差 ' + Math.round((s.proTarget - t.pro) * 10) / 10 + ' 克');
  const w = day(viewDate).weight;
  $('#weight-line').innerHTML = w
    ? '体重 <b>' + w + ' kg</b>'
    : (viewDate === todayStr() ? '<button id="go-weight">今天还没记体重 →</button>' : '');
  const gw = $('#go-weight');
  if (gw) gw.onclick = () => switchTab('weight');
}

function renderMealSeg() {
  $('#meal-seg').innerHTML = MEALS.map(m =>
    '<button data-m="' + m + '" class="' + (m === selMeal ? 'sel' : '') + '">' + m + '</button>').join('');
  document.querySelectorAll('#meal-seg button').forEach(b => {
    b.onclick = () => { selMeal = b.dataset.m; renderMealSeg(); };
  });
}

function renderChips() {
  const top = Object.entries(state.foods)
    .sort((a, b) => b[1].count - a[1].count || b[1].last - a[1].last)
    .slice(0, 8);
  const box = $('#chips');
  if (!top.length) {
    box.innerHTML = '<div class="chips-empty">记录几次后，常吃的食物会出现在这里，点一下就能直接添加</div>';
    return;
  }
  box.innerHTML = top.map(([name, f], i) =>
    '<button class="chip" data-i="' + i + '">' + esc(name) + '<small>' + esc(String(f.cal)) + '大卡</small></button>').join('');
  document.querySelectorAll('#chips .chip').forEach(b => {
    b.onclick = () => {
      const [name, f] = top[b.dataset.i];
      addEntry(name, f.cal, f.pro, selMeal);
      toast('已添加「' + name + '」');
    };
  });
  // 名称联想
  $('#food-datalist').innerHTML = Object.keys(state.foods).map(n => '<option value="' + esc(n) + '">').join('');
}

function renderEntries() {
  const d = day(viewDate);
  const box = $('#entries');
  if (!d.entries.length) {
    const prev = day(addDays(viewDate, -1));
    box.innerHTML = '<div class="empty-day">这一天还没有记录' +
      (prev.entries.length ? '<br><button id="copy-prev">把前一天的记录复制过来</button>' : '') + '</div>';
    const cp = $('#copy-prev');
    if (cp) cp.onclick = () => {
      const cur = ensureDay(viewDate);
      for (const e of prev.entries) {
        const c = { id: uid(), name: e.name, cal: e.cal, pro: e.pro, meal: e.meal, ts: Date.now() };
        if (e.lib) c.lib = true;
        cur.entries.push(c);
      }
      save(); renderRecord(); toast('已复制 ' + prev.entries.length + ' 条记录');
    };
    return;
  }
  let html = '';
  for (const m of MEALS) {
    const list = d.entries.filter(e => e.meal === m);
    if (!list.length) continue;
    let mc = 0, mp = 0;
    list.forEach(e => { mc += e.cal; mp += e.pro; });
    html += '<div class="meal-group"><div class="meal-head">' + m +
      '<span>' + Math.round(mc) + ' 大卡 · 蛋白 ' + (Math.round(mp * 10) / 10) + ' 克</span></div>';
    for (const e of list) {
      html += '<div class="entry' + (e.id === editId ? ' editing' : '') + '" data-id="' + e.id + '">' +
        '<div class="e-name">' + esc(e.name) + '</div>' +
        '<div class="e-nums"><b>' + e.cal + '</b> 大卡 · ' + e.pro + ' 克</div>' +
        '<button class="e-del" data-id="' + e.id + '" title="删除">✕</button></div>';
    }
    html += '</div>';
  }
  box.innerHTML = html;
  document.querySelectorAll('#entries .e-del').forEach(b => {
    b.onclick = ev => { ev.stopPropagation(); delEntry(b.dataset.id); };
  });
  document.querySelectorAll('#entries .entry').forEach(row => {
    row.onclick = () => startEdit(row.dataset.id);
  });
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function learnFood(name, cal, pro) {
  const f = state.foods[name] || { cal: 0, pro: 0, count: 0, last: 0 };
  f.cal = cal; f.pro = pro; f.count++; f.last = Date.now();
  state.foods[name] = f;
}

function addEntry(name, cal, pro, meal, opts) {
  const e = { id: uid(), name, cal, pro, meal, ts: Date.now() };
  if (opts && opts.lib) e.lib = true; // 标记来自食物库，编辑时也不进常用食物
  ensureDay(viewDate).entries.push(e);
  // 食物库带克数的条目不进「常用食物」，不然会被各种克数变体挤满
  if (!opts || opts.learn !== false) learnFood(name, cal, pro);
  save();
  renderRecord();
}

/* ================= 食物库 ================= */
let amtFood = null;   // 正在填用量的食物
let editFood = null;  // 正在编辑的食物（null = 新建）
let foodUnit = 'g100';

function unitWord(f) { return f.unit === 'serving' ? '份' : '克'; }
function perWord(f) { return f.unit === 'serving' ? '每份' : '每100克'; }

function renderLibrary() {
  const box = $('#lib-chips');
  const foods = [...state.library].sort((a, b) =>
    (b.count || 0) - (a.count || 0) || (b.last || 0) - (a.last || 0));
  let html = foods.map(f =>
    '<button class="chip" data-id="' + esc(f.id) + '">' + esc(f.name) +
    '<small>' + esc(String(f.cal)) + '大卡/' + (f.unit === 'serving' ? '份' : '100克') + '</small></button>').join('');
  html += '<button class="chip chip-new" id="lib-new">＋ 新建食物</button>';
  if (!foods.length) {
    html = '<div class="chips-empty">把常吃的食物存进来（如：鸡胸肉，每100克 133大卡 / 31克蛋白），' +
      '以后点一下、填个克数，热量自动算好。</div>' + html;
  }
  box.innerHTML = html;
  box.querySelectorAll('.chip[data-id]').forEach(b => { b.onclick = () => openAmt(b.dataset.id); });
  $('#lib-new').onclick = () => openFoodModal(null);
}

function openAmt(id) {
  const f = state.library.find(x => x.id === id);
  if (!f) return;
  amtFood = f;
  $('#amt-title').textContent = f.name;
  $('#amt-info').textContent = perWord(f) + ' ' + f.cal + ' 大卡 · 蛋白质 ' + f.pro + ' 克';
  $('#amt-unit').textContent = unitWord(f);
  const inp = $('#amt-input');
  inp.value = f.lastAmt || (f.unit === 'serving' ? 1 : 100);
  updateAmtPreview();
  $('#modal-amt').classList.add('show');
  // iOS 只在用户手势的同步调用栈里允许 focus 弹键盘，不能用 setTimeout
  inp.focus(); inp.select();
}

function amtCompute() {
  const amt = parseFloat($('#amt-input').value);
  if (!amtFood || !Number.isFinite(amt) || amt <= 0 || amt > 10000) return null;
  const k = amtFood.unit === 'serving' ? amt : amt / 100;
  return { amt, cal: Math.round(amtFood.cal * k), pro: Math.round(amtFood.pro * k * 10) / 10 };
}

function updateAmtPreview() {
  const c = amtCompute();
  $('#amt-preview').textContent = c ? '≈ ' + c.cal + ' 大卡 · 蛋白质 ' + c.pro + ' 克 · 记入' + selMeal : '　';
}

function submitAmt() {
  const c = amtCompute();
  if (!c) { toast('请输入数量'); return; }
  const name = amtFood.name + ' ' + c.amt + unitWord(amtFood);
  amtFood.lastAmt = c.amt;
  amtFood.count = (amtFood.count || 0) + 1;
  amtFood.last = Date.now();
  $('#modal-amt').classList.remove('show');
  addEntry(name, c.cal, c.pro, selMeal, { learn: false, lib: true });
  toast('已添加「' + name + '」');
}

function openFoodModal(id) {
  editFood = id ? state.library.find(x => x.id === id) : null;
  foodUnit = editFood ? editFood.unit : 'g100';
  $('#food-title').textContent = editFood ? '编辑食物' : '新建食物';
  $('#food-name').value = editFood ? editFood.name : '';
  $('#food-cal').value = editFood ? editFood.cal : '';
  $('#food-pro').value = editFood ? editFood.pro : '';
  $('#food-del').classList.toggle('hidden', !editFood);
  renderUnitSeg();
  $('#modal-food').classList.add('show');
  $('#food-name').focus();
}

function renderUnitSeg() {
  document.querySelectorAll('#food-unit-seg button').forEach(b => {
    b.classList.toggle('sel', b.dataset.u === foodUnit);
  });
  const u = foodUnit === 'serving' ? '/份' : '/100克';
  $('#food-cal-unit').textContent = '大卡' + u;
  $('#food-pro-unit').textContent = '蛋白' + u;
}

function saveFood() {
  const name = $('#food-name').value.trim();
  const cal = parseFloat($('#food-cal').value);
  const pro = parseFloat($('#food-pro').value);
  if (!name) { toast('请填写食物名称'); $('#food-name').focus(); return; }
  if (!validNum(cal, 10000)) { toast('请填写热量'); $('#food-cal').focus(); return; }
  const c = Math.round(cal * 10) / 10;
  const p = validNum(pro, 5000) ? Math.round(pro * 10) / 10 : 0;
  if (editFood) {
    // 换了计量单位后，上次填的数量就没意义了，清掉防止按错单位预填
    if (editFood.unit !== foodUnit) editFood.lastAmt = null;
    editFood.name = name; editFood.unit = foodUnit; editFood.cal = c; editFood.pro = p;
  } else {
    state.library.push({ id: uid(), name, unit: foodUnit, cal: c, pro: p, count: 0, last: 0, lastAmt: null });
  }
  save();
  $('#modal-food').classList.remove('show');
  renderLibrary();
  toast('已保存「' + name + '」');
}

function delFood() {
  if (!editFood) return;
  const f = editFood;
  uiConfirm('删除食物', '「' + f.name + '」会从食物库移除，已记录的条目不受影响。', true, () => {
    state.library = state.library.filter(x => x.id !== f.id);
    save();
    $('#modal-food').classList.remove('show');
    renderLibrary();
    toast('已删除「' + f.name + '」');
  });
}

function delEntry(id) {
  const d = ensureDay(viewDate);
  const idx = d.entries.findIndex(e => e.id === id);
  if (idx < 0) return;
  const [removed] = d.entries.splice(idx, 1);
  if (editId === id) cancelEdit();
  save(); renderRecord();
  const ds = viewDate;
  toast('已删除「' + removed.name + '」', () => {
    ensureDay(ds).entries.splice(Math.min(idx, ensureDay(ds).entries.length), 0, removed);
    save(); if (viewDate === ds) renderRecord();
  });
}

function startEdit(id) {
  const e = day(viewDate).entries.find(x => x.id === id);
  if (!e) return;
  editId = id;
  $('#f-name').value = e.name;
  $('#f-cal').value = e.cal;
  $('#f-pro').value = e.pro;
  selMeal = e.meal;
  $('#btn-add').textContent = '保存修改';
  $('#btn-cancel').classList.remove('hidden');
  renderMealSeg(); renderEntries();
  $('#f-name').focus();
}

function cancelEdit() {
  editId = null;
  $('#f-name').value = ''; $('#f-cal').value = ''; $('#f-pro').value = '';
  $('#btn-add').textContent = '添加';
  $('#btn-cancel').classList.add('hidden');
  renderEntries();
}

function submitForm() {
  const name = $('#f-name').value.trim();
  const cal = parseFloat($('#f-cal').value);
  const pro = parseFloat($('#f-pro').value);
  if (!name) { toast('请填写食物名称'); $('#f-name').focus(); return; }
  if (!validNum(cal, 50000)) { toast('请填写热量（大卡）'); $('#f-cal').focus(); return; }
  const p = validNum(pro, 5000) ? Math.round(pro * 10) / 10 : 0;
  const c = Math.round(cal);
  if (editId) {
    const e = ensureDay(viewDate).entries.find(x => x.id === editId);
    if (e) { e.name = name; e.cal = c; e.pro = p; e.meal = selMeal; if (!e.lib) learnFood(name, c, p); }
    save();
    const kept = '已保存修改';
    cancelEdit(); renderRecord(); toast(kept);
  } else {
    addEntry(name, c, p, selMeal);
    $('#f-name').value = ''; $('#f-cal').value = ''; $('#f-pro').value = '';
    $('#f-name').focus();
    toast('已添加「' + name + '」');
  }
}

function renderRecord() {
  renderDateNav();
  renderSummary();
  renderLibrary();
  renderChips();
  renderEntries();
}

/* ================= 体重页 ================= */
let weightRange = 30; // 30 / 90 / 0(全部)

function weightSeries() {
  return Object.entries(state.days)
    .filter(([, d]) => typeof d.weight === 'number')
    .map(([ds, d]) => ({ ds, w: d.weight }))
    .sort((a, b) => a.ds < b.ds ? -1 : 1);
}

function renderWeightStats() {
  const all = weightSeries();
  const latest = all.length ? all[all.length - 1] : null;
  $('#w-latest').innerHTML = latest ? latest.w + '<small> kg</small>' : '—';
  // 7 日均值
  const cut7 = addDays(todayStr(), -6);
  const last7 = all.filter(p => p.ds >= cut7);
  $('#w-avg7').innerHTML = last7.length
    ? (Math.round(last7.reduce((s, p) => s + p.w, 0) / last7.length * 10) / 10) + '<small> kg</small>' : '—';
  // 30 天变化：与 30 天前最近一次记录比
  const el = $('#w-delta30');
  el.className = 'st-val';
  if (all.length >= 2) {
    const cut30 = addDays(todayStr(), -30);
    const base = [...all].reverse().find(p => p.ds <= cut30) || all[0];
    const diff = Math.round((latest.w - base.w) * 10) / 10;
    el.innerHTML = (diff > 0 ? '+' : '') + diff + '<small> kg</small>';
    if (diff < 0) el.classList.add('delta-down');
    else if (diff > 0) el.classList.add('delta-up');
  } else el.textContent = '—';
  // BMI
  const h = state.settings.height;
  $('#w-bmi').innerHTML = (latest && h)
    ? (Math.round(latest.w / Math.pow(h / 100, 2) * 10) / 10) + ''
    : '—';
}

function renderWeightChart() {
  const box = $('#w-chart');
  const tip = $('#w-tip');
  let all = weightSeries();
  if (weightRange > 0) {
    const cut = addDays(todayStr(), -(weightRange - 1));
    all = all.filter(p => p.ds >= cut);
  }
  if (all.length < 2) {
    box.innerHTML = '<div class="chart-empty">' + (all.length ? '再记一天就能看到趋势线了' : '记录体重后这里会显示趋势图') + '</div>';
    return;
  }
  const W = box.clientWidth || 480, H = 180;
  const PL = 34, PR = 10, PT = 12, PB = 22;
  const t0 = parseD(all[0].ds).getTime(), t1 = parseD(all[all.length - 1].ds).getTime();
  const tgt = state.settings.weightTarget;
  let lo = Math.min(...all.map(p => p.w)), hi = Math.max(...all.map(p => p.w));
  if (tgt) { lo = Math.min(lo, tgt); hi = Math.max(hi, tgt); }
  const pad = Math.max((hi - lo) * 0.15, 0.5);
  lo -= pad; hi += pad;
  const X = t => t1 === t0 ? (PL + (W - PL - PR) / 2) : PL + (t - t0) / (t1 - t0) * (W - PL - PR);
  const Y = w => PT + (hi - w) / (hi - lo) * (H - PT - PB);
  // 网格：4 条横线
  let g = '';
  for (let i = 0; i <= 3; i++) {
    const w = lo + (hi - lo) * i / 3;
    const y = Y(w);
    g += '<line x1="' + PL + '" y1="' + y + '" x2="' + (W - PR) + '" y2="' + y + '" stroke="var(--grid)" stroke-width="1"/>' +
      '<text x="' + (PL - 6) + '" y="' + (y + 3.5) + '" text-anchor="end" font-size="10" fill="var(--muted)" style="font-variant-numeric:tabular-nums">' + (Math.round(w * 10) / 10) + '</text>';
  }
  // x 轴标签：首、中、尾
  const xlab = idxs => idxs.map(i => {
    const p = all[i], d = parseD(p.ds);
    return '<text x="' + X(parseD(p.ds).getTime()) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10" fill="var(--muted)">' + (d.getMonth() + 1) + '/' + d.getDate() + '</text>';
  }).join('');
  const labels = xlab(all.length > 2 ? [0, Math.floor(all.length / 2), all.length - 1] : [0, all.length - 1]);
  // 目标线
  let tline = '';
  if (tgt && tgt > lo && tgt < hi) {
    tline = '<line x1="' + PL + '" y1="' + Y(tgt) + '" x2="' + (W - PR) + '" y2="' + Y(tgt) + '" stroke="var(--baseline)" stroke-width="1.5" stroke-dasharray="5 4"/>' +
      '<text x="' + (W - PR) + '" y="' + (Y(tgt) - 4) + '" text-anchor="end" font-size="10" fill="var(--muted)">目标 ' + tgt + '</text>';
  }
  const pts = all.map(p => ({ x: X(parseD(p.ds).getTime()), y: Y(p.w), p }));
  const path = pts.map((q, i) => (i ? 'L' : 'M') + q.x.toFixed(1) + ' ' + q.y.toFixed(1)).join(' ');
  const dots = pts.map((q, i) =>
    '<circle cx="' + q.x + '" cy="' + q.y + '" r="3" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>' +
    '<circle cx="' + q.x + '" cy="' + q.y + '" r="11" fill="transparent" data-i="' + i + '" class="hit"/>').join('');
  box.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '">' + g + tline +
    '<path d="' + path + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
    dots + labels + '</svg>';
  box.querySelectorAll('.hit').forEach(c => {
    const show = () => {
      const q = pts[c.dataset.i];
      const d = parseD(q.p.ds);
      tip.innerHTML = '<div class="tt-t">' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEK[d.getDay()] + '</div><b>' + q.p.w + ' kg</b>';
      tip.style.display = 'block';
      const bw = box.clientWidth;
      tip.style.left = Math.min(Math.max(q.x - 40, 0), bw - 90) + 'px';
      tip.style.top = (q.y - 52) + 'px';
    };
    c.addEventListener('mouseenter', show);
    c.addEventListener('click', show);
  });
  box.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
}

function renderWeightList() {
  const all = weightSeries().slice(-10).reverse();
  const box = $('#w-list');
  if (!all.length) { box.innerHTML = '<div class="chart-empty">还没有体重记录</div>'; return; }
  box.innerHTML = all.map(p => {
    const d = parseD(p.ds);
    return '<div class="hist-item"><span class="h-date">' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEK[d.getDay()] + '</span>' +
      '<span style="display:flex;align-items:center;gap:6px"><span class="h-val">' + p.w + ' kg</span>' +
      '<button class="e-del" data-ds="' + p.ds + '">✕</button></span></div>';
  }).join('');
  box.querySelectorAll('.e-del').forEach(b => {
    b.onclick = () => {
      const ds = b.dataset.ds;
      const old = state.days[ds].weight;
      delete state.days[ds].weight;
      save(); renderWeight();
      toast('已删除该条体重', () => { ensureDay(ds).weight = old; save(); renderWeight(); });
    };
  });
}

function renderWeight() {
  $('#w-date').value = $('#w-date').value || todayStr();
  $('#w-date').max = todayStr();
  renderWeightStats();
  renderWeightChart();
  renderWeightList();
}

function submitWeight() {
  const ds = $('#w-date').value || todayStr();
  const w = parseFloat($('#w-input').value);
  if (!(w > 20 && w < 400)) { toast('请输入正确的体重（kg）'); return; }
  ensureDay(ds).weight = Math.round(w * 10) / 10;
  save();
  $('#w-input').value = '';
  renderWeight(); renderSummary();
  toast('已记录 ' + (ds === todayStr() ? '今天' : ds) + ' 体重 ' + (Math.round(w * 10) / 10) + ' kg');
}

/* ================= 统计页 ================= */
function renderStats() {
  const s = state.settings;
  const today = todayStr();
  // 最近 7 天（有记录的天）平均
  let cals = [], pros = [], proHit = 0, recDays = 0;
  for (let i = 0; i < 7; i++) {
    const ds = addDays(today, -i);
    const d = day(ds);
    if (d.entries.length) {
      const t = dayTotals(ds);
      cals.push(t.cal); pros.push(t.pro);
      if (t.pro >= s.proTarget) proHit++;
      recDays++;
    }
  }
  $('#st-cal7').innerHTML = cals.length ? Math.round(cals.reduce((a, b) => a + b, 0) / cals.length) + '<small> 大卡</small>' : '—';
  $('#st-pro7').innerHTML = pros.length ? Math.round(pros.reduce((a, b) => a + b, 0) / pros.length) + '<small> 克</small>' : '—';
  $('#st-prohit').innerHTML = recDays ? proHit + '<small> / ' + recDays + ' 天</small>' : '—';
  // 连续记录天数（今天没记不打断）
  let streak = 0, ds = today;
  if (!day(ds).entries.length) ds = addDays(ds, -1);
  while (day(ds).entries.length) { streak++; ds = addDays(ds, -1); }
  $('#st-streak').innerHTML = streak + '<small> 天</small>';
  renderCalChart();
}

function renderCalChart() {
  const box = $('#cal-chart');
  const tip = $('#cal-tip');
  const s = state.settings;
  const today = todayStr();
  const N = 14;
  const data = [];
  for (let i = N - 1; i >= 0; i--) {
    const ds = addDays(today, -i);
    data.push({ ds, t: day(ds).entries.length ? dayTotals(ds) : null });
  }
  if (!data.some(d => d.t)) {
    box.innerHTML = '<div class="chart-empty">记录饮食后，这里会显示最近 14 天的热量图</div>';
    return;
  }
  const W = box.clientWidth || 480, H = 190;
  const PL = 40, PR = 10, PT = 16, PB = 22;
  const maxV = Math.max(s.calTarget * 1.15, ...data.map(d => d.t ? d.t.cal : 0)) * 1.05;
  const iw = (W - PL - PR) / N;
  const bw = Math.max(iw - 2, 3); // 柱间 2px 间隔
  const Y = v => PT + (1 - v / maxV) * (H - PT - PB);
  let g = '';
  for (let i = 0; i <= 3; i++) {
    const v = maxV * i / 3;
    const y = Y(v);
    g += '<line x1="' + PL + '" y1="' + y + '" x2="' + (W - PR) + '" y2="' + y + '" stroke="var(--grid)" stroke-width="1"/>' +
      '<text x="' + (PL - 6) + '" y="' + (y + 3.5) + '" text-anchor="end" font-size="10" fill="var(--muted)" style="font-variant-numeric:tabular-nums">' + Math.round(v) + '</text>';
  }
  let bars = '', labels = '';
  data.forEach((d, i) => {
    const x = PL + i * iw + (iw - bw) / 2;
    const dd = parseD(d.ds);
    if (i % 2 === (N - 1) % 2) {
      labels += '<text x="' + (PL + i * iw + iw / 2) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="9.5" fill="var(--muted)">' + (dd.getMonth() + 1) + '/' + dd.getDate() + '</text>';
    }
    if (!d.t) return;
    const y = Y(d.t.cal);
    const bh = H - PB - y;
    const r = Math.min(4, bw / 2, bh);
    bars += '<path d="M' + x + ' ' + (H - PB) + ' V' + (y + r) + ' Q' + x + ' ' + y + ' ' + (x + r) + ' ' + y +
      ' H' + (x + bw - r) + ' Q' + (x + bw) + ' ' + y + ' ' + (x + bw) + ' ' + (y + r) + ' V' + (H - PB) + ' Z" fill="var(--accent)" data-i="' + i + '" class="bar"/>';
  });
  // 目标虚线
  const ty = Y(s.calTarget);
  const tline = '<line x1="' + PL + '" y1="' + ty + '" x2="' + (W - PR) + '" y2="' + ty + '" stroke="var(--baseline)" stroke-width="1.5" stroke-dasharray="5 4"/>' +
    '<text x="' + (W - PR) + '" y="' + (ty - 4) + '" text-anchor="end" font-size="10" fill="var(--muted)">目标 ' + s.calTarget + '</text>';
  box.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '">' + g + bars + tline + labels + '</svg>';
  box.querySelectorAll('.bar').forEach(b => {
    const show = () => {
      const d = data[b.dataset.i];
      const dd = parseD(d.ds);
      const diff = d.t.cal - s.calTarget;
      tip.innerHTML = '<div class="tt-t">' + (dd.getMonth() + 1) + '月' + dd.getDate() + '日 ' + WEEK[dd.getDay()] + '</div>' +
        '<b>' + d.t.cal + '</b> 大卡（' + (diff > 0 ? '超 ' + diff : '剩 ' + (-diff)) + '）<br>蛋白质 <b>' + d.t.pro + '</b> 克';
      tip.style.display = 'block';
      const x = PL + (+b.dataset.i) * iw;
      tip.style.left = Math.min(Math.max(x - 40, 0), box.clientWidth - 130) + 'px';
      tip.style.top = '6px';
    };
    b.addEventListener('mouseenter', show);
    b.addEventListener('click', show);
  });
  box.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
}

/* ================= 设置页 ================= */
function renderSettings() {
  const s = state.settings;
  $('#set-cal').value = s.calTarget;
  $('#set-pro').value = s.proTarget;
  $('#set-weight').value = s.weightTarget || '';
  $('#set-height').value = s.height || '';
}

function saveSettings() {
  const s = state.settings;
  const cal = parseInt($('#set-cal').value, 10);
  const pro = parseInt($('#set-pro').value, 10);
  const wt = parseFloat($('#set-weight').value);
  const h = parseFloat($('#set-height').value);
  if (cal > 0) s.calTarget = cal;
  if (pro > 0) s.proTarget = pro;
  s.weightTarget = wt > 0 ? wt : null;
  s.height = h > 0 ? h : null;
  save();
  renderAll();
  toast('目标已保存');
}

function exportJSON() {
  openIOModal('导出备份（JSON）', '全部数据都在下面，点「复制」后存到备忘录或微信收藏即可备份。', JSON.stringify(state), false);
}

function exportCSV() {
  let csv = '﻿日期,类型,餐别/项目,热量(大卡),蛋白质(克),体重(kg)\n';
  const days = Object.keys(state.days).sort();
  for (const ds of days) {
    const d = state.days[ds];
    for (const e of (d.entries || [])) {
      csv += ds + ',饮食,' + e.meal + '·' + String(e.name).replace(/[,\n]/g, ' ') + ',' + e.cal + ',' + e.pro + ',\n';
    }
    if (typeof d.weight === 'number') csv += ds + ',体重,,,,' + d.weight + '\n';
  }
  openIOModal('导出表格（CSV）', '点「复制」后粘贴到 Excel / Numbers 里即可。', csv, false);
}

function importJSON() {
  openIOModal('导入备份', '把之前导出的 JSON 粘贴到下面，点「导入」。会覆盖当前数据（旧备份里没有食物库时，现有食物库会保留）。', '', true);
}

function openIOModal(title, msg, content, isImport) {
  $('#io-title').textContent = title;
  $('#io-msg').textContent = msg;
  const ta = $('#io-text');
  ta.value = content;
  ta.readOnly = !isImport;
  ta.placeholder = isImport ? '在这里粘贴 JSON…' : '';
  $('#io-copy').classList.toggle('hidden', isImport);
  $('#io-import').classList.toggle('hidden', !isImport);
  $('#modal-io').classList.add('show');
  if (isImport) setTimeout(() => ta.focus(), 100);
}

function doCopy() {
  const ta = $('#io-text');
  ta.select(); ta.setSelectionRange(0, ta.value.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  if (!ok && navigator.clipboard) {
    navigator.clipboard.writeText(ta.value).then(() => toast('已复制到剪贴板')).catch(() => toast('复制失败，请手动全选复制'));
    return;
  }
  toast(ok ? '已复制到剪贴板' : '复制失败，请手动全选复制');
}

function doImport() {
  const raw = $('#io-text').value.trim();
  if (!raw) { toast('请先粘贴备份内容'); return; }
  let d;
  try { d = JSON.parse(raw); } catch (e) { toast('格式不对：不是有效的 JSON'); return; }
  if (!d || typeof d !== 'object' || !d.days) { toast('格式不对：缺少数据字段'); return; }
  // 与 load() 一致：以 d 打底透传未知字段；食物库上线前的旧备份没有 library 字段，保留现有的
  state = Object.assign({}, d, {
    settings: Object.assign({}, DEFAULTS.settings, d.settings || {}),
    days: d.days || {},
    foods: d.foods || {},
    library: d.library === undefined ? state.library : sanitizeLibrary(d.library),
  });
  save();
  $('#modal-io').classList.remove('show');
  renderAll();
  toast('导入成功');
}

function clearAll() {
  uiConfirm('清空全部数据', '所有饮食记录、体重记录和食物库都会被删除，且无法恢复。建议先导出一份 JSON 备份。', true, () => {
    state = JSON.parse(JSON.stringify(DEFAULTS));
    save(); renderAll(); toast('已清空');
  });
}

/* ================= 标签页切换 ================= */
const TABS = ['record', 'weight', 'stats', 'settings'];
function switchTab(name) {
  TABS.forEach(t => {
    $('#page-' + t).classList.toggle('active', t === name);
    $('#tab-' + t).classList.toggle('sel', t === name);
  });
  if (name === 'record') renderRecord();
  if (name === 'weight') renderWeight();
  if (name === 'stats') renderStats();
  if (name === 'settings') renderSettings();
}

function renderAll() {
  renderRecord(); renderWeight(); renderStats(); renderSettings();
}

/* ================= 启动 ================= */
document.addEventListener('DOMContentLoaded', () => {
  // 日期导航
  $('#nav-prev').onclick = () => { viewDate = addDays(viewDate, -1); cancelEdit(); renderRecord(); };
  $('#nav-next').onclick = () => { viewDate = addDays(viewDate, 1); cancelEdit(); renderRecord(); };
  $('#btn-today').onclick = () => { viewDate = todayStr(); cancelEdit(); renderRecord(); };
  $('#date-input').onchange = e => {
    if (e.target.value && e.target.value <= todayStr()) { viewDate = e.target.value; cancelEdit(); renderRecord(); }
  };
  // 表单
  $('#btn-add').onclick = submitForm;
  $('#btn-cancel').onclick = cancelEdit;
  ['f-name', 'f-cal', 'f-pro'].forEach(id => bindEnter($('#' + id), submitForm));
  $('#f-name').addEventListener('change', () => {
    const f = state.foods[$('#f-name').value.trim()];
    if (f && !$('#f-cal').value) { $('#f-cal').value = f.cal; $('#f-pro').value = f.pro; }
  });
  // 体重
  $('#btn-weight').onclick = submitWeight;
  bindEnter($('#w-input'), submitWeight);
  document.querySelectorAll('#w-range button').forEach(b => {
    b.onclick = () => {
      weightRange = +b.dataset.r;
      document.querySelectorAll('#w-range button').forEach(x => x.classList.toggle('sel', x === b));
      renderWeightChart();
    };
  });
  // 设置
  $('#btn-save-set').onclick = saveSettings;
  $('#btn-export-json').onclick = exportJSON;
  $('#btn-export-csv').onclick = exportCSV;
  $('#btn-import').onclick = importJSON;
  $('#btn-clear').onclick = clearAll;
  // 模态
  $('#io-close').onclick = () => $('#modal-io').classList.remove('show');
  $('#io-copy').onclick = doCopy;
  $('#io-import').onclick = doImport;
  $('#cf-cancel').onclick = () => $('#modal-confirm').classList.remove('show');
  // 食物库
  $('#amt-cancel').onclick = () => $('#modal-amt').classList.remove('show');
  $('#amt-ok').onclick = submitAmt;
  $('#amt-input').addEventListener('input', updateAmtPreview);
  bindEnter($('#amt-input'), submitAmt);
  $('#amt-edit').onclick = () => {
    const id = amtFood && amtFood.id;
    $('#modal-amt').classList.remove('show');
    if (id) openFoodModal(id);
  };
  document.querySelectorAll('#food-unit-seg button').forEach(b => {
    b.onclick = () => { foodUnit = b.dataset.u; renderUnitSeg(); };
  });
  $('#food-cancel').onclick = () => $('#modal-food').classList.remove('show');
  $('#food-save').onclick = saveFood;
  $('#food-del').onclick = delFood;
  ['food-name', 'food-cal', 'food-pro'].forEach(id => bindEnter($('#' + id), saveFood));
  // Toast 撤销
  $('#toast-undo').onclick = () => { if (undoFn) undoFn(); $('#toast').style.display = 'none'; undoFn = null; };
  // 标签栏
  TABS.forEach(t => { $('#tab-' + t).onclick = () => switchTab(t); });
  // 窗口尺寸变化重画图表
  let rt = null;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { renderWeightChart(); renderCalChart(); }, 150);
  });
  renderMealSeg();
  switchTab('record');
  // 原生壳首启：把默认数据落盘，确认桥接可用
  save();
  // PWA：离线缓存（file:// 的原生壳里不注册）
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 不支持就算了 */ });
  }
});
