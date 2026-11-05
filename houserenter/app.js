import { Store } from './storage.js';
import { buildInvoicePdf, invoiceFileName } from './pdf.js';
import { DEFAULT_SETTINGS, DEFAULT_PROPERTIES, SAMPLE_INVOICES } from './defaults.js';
import * as U from './util.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = U.esc;

const S = { settings: null, properties: [], invoices: {}, payments: {}, tab: 'invoice', form: null, histFilter: 'all' };

// ------------------------------------------------------------------ boot
boot();
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  setupInstall();
  const bar = $('.appbar'); // keep sticky panels clear of the pinned header
  new ResizeObserver(() => document.documentElement.style.setProperty('--bar-h', bar.offsetHeight + 'px')).observe(bar);
  $$('#tabs button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('#storageBadge').addEventListener('click', () => S.settings && switchTab('settings'));
  const view = $('#view');
  view.addEventListener('input', onInput);
  view.addEventListener('change', onChange);
  view.addEventListener('click', onClick);
  let st;
  try { st = await Store.init(); } catch (e) { st = 'needs-setup'; }
  if (st === 'ready') start(); else renderSetup(st);
}

function renderSetup(state) {
  document.body.classList.add('setup');
  const fsa = Store.fsaSupported;
  $('#storageBadge').textContent = 'Not connected';
  $('#view').innerHTML = `
  <section class="card setup-card">
    <div class="setup-icon" aria-hidden="true">${ICON.folder}</div>
    <h2>Connect the <code>houserent</code> folder</h2>
    <p>Settings, the property list, every invoice record and the PDFs are kept together in one folder named <b>houserent</b>.</p>
    ${state === 'needs-permission' ? `<button class="btn primary block" data-act="reconnect">Reconnect “${esc(Store.savedName)}”</button>
      <p class="hint">Your browser asks again for access after a restart.</p>` : ''}
    ${fsa ? `<button class="btn ${state === 'needs-permission' ? '' : 'primary'} block" data-act="pick">Choose folder…</button>
      <p class="hint">Select your <b>houserent</b> folder, or the folder it should live in (e.g. Documents) and it will be created.</p>` : ''}
    <button class="btn block" data-act="device">Use on-device storage</button>
    <p class="hint">${fsa ? '' : 'This browser can’t open disk folders (normal on phones and Safari). '}On-device storage keeps a private <b>houserent</b> store inside the app. Use <b>Settings → Import / Backup</b> to bring in or save your JSON files.</p>
  </section>`;
}

async function start() {
  document.body.classList.remove('setup');
  let err = null;
  try { await loadAll(); }
  catch (e) { err = e; S.settings ||= U.clone(DEFAULT_SETTINGS); }
  updateBadge();
  S.form = null;
  switchTab(err ? 'settings' : S.tab);
  if (err) {
    $('#view').insertAdjacentHTML('afterbegin', `<section class="card load-error"><h3>Couldn’t read your data</h3>
      <p>${esc(err.message)}</p><p class="hint">Fix the file (check quotes and commas), then tap <b>Reload files</b>.</p>
      <button class="btn small primary" data-act="s-reload">${ICON.refresh} Reload files</button></section>`);
  }
}

function deepMerge(base, over) {
  for (const k in over) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) deepMerge(base[k], over[k]);
    else base[k] = over[k];
  }
  return base;
}

async function loadAll() {
  const sj = await Store.readJSON('settings.json', null);
  const oldTheme = sj?.theme && 'highlight' in sj.theme; // colours from the earlier dark layout
  if (oldTheme) delete sj.theme;
  S.settings = deepMerge(U.clone(DEFAULT_SETTINGS), sj || {});
  if (!sj || oldTheme) await Store.writeJSON('settings.json', S.settings);

  let pj = await Store.readJSON('properties.json', null);
  if (!pj) {
    pj = U.clone(DEFAULT_PROPERTIES);
    await Store.writeJSON('properties.json', pj);
    for (const [pid, data] of Object.entries(SAMPLE_INVOICES))
      if (!(await Store.exists(`invoices/${pid}.json`))) await Store.writeJSON(`invoices/${pid}.json`, data);
  }
  S.properties = Array.isArray(pj) ? pj : (pj.properties || []);

  S.invoices = {};
  for (const f of await Store.list('invoices')) {
    if (!f.endsWith('.json')) continue;
    const data = await Store.readJSON('invoices/' + f, []);
    const arr = Array.isArray(data) ? data : (data.invoices || []);
    S.invoices[f.slice(0, -5)] = arr.sort(byPeriod);
  }
  S.payments = {};
  for (const f of await Store.list('payments')) {
    if (!f.endsWith('.json')) continue;
    const data = await Store.readJSON('payments/' + f, []);
    S.payments[f.slice(0, -5)] = Array.isArray(data) ? data : (data.payments || []);
  }
  await migrate();
}

// Upgrade data written by earlier versions of the app.
async function migrate() {
  const s = S.settings;
  let sDirty = false, pDirty = false;
  const oldMeterRent = s.rates?.meterRent;
  if (s.rates && 'waterPerUnit' in s.rates) { s.rates.waterPerLitre = s.rates.waterPerUnit; delete s.rates.waterPerUnit; sDirty = true; }
  if (s.rates && 'meterRent' in s.rates) {
    const m = (s.defaultCharges || []).find(c => /meter/i.test(c.label)); if (m) m.amount = s.rates.meterRent;
    delete s.rates.meterRent; sDirty = true;
  }
  for (const p of S.properties) {
    p.charges ||= [];
    if ('meterRent' in p) { // meter rent becomes an optional charge
      if (p.enableElectricity !== false && !p.charges.some(c => /meter/i.test(c.label)))
        p.charges.unshift({ label: 'Electricity Meter Rent', amount: p.meterRent ?? oldMeterRent ?? 5, on: true });
      delete p.meterRent; pDirty = true;
    }
    const i = p.charges.findIndex(c => /trash\s*\/\s*wi-?fi/i.test(c.label)); // split combined Trash/WiFi
    if (i >= 0) { const half = U.r2(U.num(p.charges[i].amount) / 2); p.charges.splice(i, 1, { label: 'Trash', amount: half, on: true }, { label: 'WiFi', amount: half, on: true }); pDirty = true; }
  }
  for (const [pid, arr] of Object.entries(S.invoices)) { // old "paid" toggle -> payment entry
    let iDirty = false;
    for (const r of arr) {
      if (!('status' in r) && !('paidOn' in r)) continue;
      if (r.status === 'paid' && !(S.payments[pid] || []).some(x => x.invoiceId === r.id)) {
        (S.payments[pid] ||= []).push(newPaymentObj(r, { date: r.paidOn || r.invoiceDate, amount: r.total, mode: 'Not recorded', reference: '', note: 'Marked paid before payment tracking' }));
        await savePaymentFile(pid);
      }
      delete r.status; delete r.paidOn; iDirty = true;
    }
    if (iDirty) await saveInvoiceFile(pid);
  }
  if (sDirty) await Store.writeJSON('settings.json', s);
  if (pDirty) await saveProperties();
}

const byPeriod = (a, b) => a.billPeriod.localeCompare(b.billPeriod) || (a.invoiceDate || '').localeCompare(b.invoiceDate || '');
const prop = id => S.properties.find(p => p.id === id);
const activeProps = () => S.properties.filter(p => p.active !== false);
const allInvoices = () => Object.values(S.invoices).flat();
const findInvoice = id => allInvoices().find(r => r.id === id);
const saveProperties = () => Store.writeJSON('properties.json', { version: 1, properties: S.properties });
const savePaymentFile = pid => Store.writeJSON(`payments/${pid}.json`, { propertyId: pid, payments: S.payments[pid] || [] });
const saveInvoiceFile = pid => Store.writeJSON(`invoices/${pid}.json`, { propertyId: pid, invoices: S.invoices[pid] || [] });

function updateBadge() {
  const b = $('#storageBadge');
  b.innerHTML = `${Store.mode === 'folder' ? ICON.folder : ICON.phone}<span>${esc(Store.label())}</span>`;
}

function switchTab(t) {
  if (!S.settings) return;
  S.tab = t;
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  ({ invoice: renderInvoice, history: renderHistory, payments: renderPayments, properties: renderProperties, settings: renderSettings })[t]();
  window.scrollTo({ top: 0 });
}

// ------------------------------------------------------------------ invoice form
function nextInvoiceNumber(pid, dateIso, excludeId) {
  const s = S.settings.invoice, year = (dateIso || U.isoToday()).slice(0, 4);
  const pool = s.numbering === 'global' ? allInvoices() : (S.invoices[pid] || []);
  let max = 0;
  for (const r of pool) if (r.id !== excludeId && (r.invoiceDate || '').startsWith(year)) max = Math.max(max, Number(r.invoiceSeq) || 0);
  const seq = max + 1;
  const no = U.fill(s.numberFormat || '{prefix}-{seq}/{year}', {
    prefix: s.prefix || '', seq: String(seq).padStart(Number(s.seqDigits) || 1, '0'), year, yy: year.slice(2), code: prop(pid)?.code || ''
  });
  return { seq, no };
}

// Charges billed on a saved invoice (switched on) + the property's other optional charges (switched off)
function mergeCharges(r) {
  const billed = (r.meterRent ? [{ label: 'Electricity Meter Rent', amount: r.meterRent }] : []).concat(r.charges || [])
    .map(c => ({ label: c.label, amount: c.amount, on: true }));
  const have = new Set(billed.map(c => c.label.toLowerCase()));
  const extra = (prop(r.propertyId)?.charges || []).filter(c => !have.has(String(c.label).toLowerCase())).map(c => ({ label: c.label, amount: c.amount, on: false }));
  return [...billed, ...extra];
}

function formFromRecord(r) {
  return {
    existingId: r.id, propertyId: r.propertyId, billPeriod: r.billPeriod,
    invoiceNo: r.invoiceNo, invoiceSeq: r.invoiceSeq, autoNo: false, invoiceDate: r.invoiceDate, dueDate: r.dueDate, autoDue: false,
    tenantName: r.tenantName,
    elecPrev: r.electricity?.previous ?? '', elecCur: r.electricity?.current ?? '', elecRate: r.electricity?.rate ?? '',
    waterCap: r.water?.capacity ?? r.waterTankCapacity ?? '', waterRate: r.water?.rate ?? '',
    waterDays: r.water?.days ?? (r.water && (r.water.capacity ?? r.waterTankCapacity) ? U.r2(r.water.units / (r.water.capacity ?? r.waterTankCapacity)) : ''),
    rent: r.rent?.rate ?? r.rent?.amount ?? 0,
    charges: mergeCharges(r),
    adjLabel: r.adjustment?.label || '', adjAmount: r.adjustment?.amount ?? '',
    createdAt: r.createdAt
  };
}

function newForm(pid, period) {
  const p = prop(pid), s = S.settings;
  const recs = S.invoices[pid] || [];
  const existing = recs.find(r => r.billPeriod === period);
  if (existing) return formFromRecord(existing);
  const last = recs.filter(r => r.billPeriod < period).sort(byPeriod).pop();
  const today = U.isoToday();
  const { seq, no } = nextInvoiceNumber(pid, today);
  return {
    existingId: null, propertyId: pid, billPeriod: period,
    invoiceNo: no, invoiceSeq: seq, autoNo: true, invoiceDate: today, dueDate: U.addDays(today, s.invoice.dueDays), autoDue: true,
    tenantName: p.tenantName || '',
    elecPrev: last?.electricity ? last.electricity.current : (p.openingMeterReading ?? ''),
    elecCur: '', elecRate: p.electricityRate ?? s.rates.electricityPerUnit,
    waterCap: p.waterTankCapacity ?? '', waterDays: U.daysInMonth(period), waterRate: p.waterRate ?? s.rates.waterPerLitre,
    rent: p.rent ?? 0,
    charges: (p.charges || []).map(c => ({ label: c.label, amount: c.amount, on: c.on !== false })), adjLabel: '', adjAmount: '',
    lastWaterUnits: last?.water?.units, lastElecUnits: last?.electricity?.units
  };
}

function ensureForm() {
  const props = activeProps();
  if (!props.length) return null;
  if (!S.form || !prop(S.form.propertyId)) {
    const p = props[0];
    S.form = newForm(p.id, defaultPeriod(p.id));
  }
  return S.form;
}
// The month after the property's latest invoice (last month if it has none), so a new bill is always a new month.
function defaultPeriod(pid) {
  const recs = S.invoices[pid] || [];
  const latest = recs.reduce((m, r) => (r.billPeriod > m ? r.billPeriod : m), '');
  return latest ? U.nextYm(latest) : U.prevYm(U.ymNow());
}

const fld = (k, label, type = 'text', extra = '') => {
  const v = S.form[k] ?? '';
  return `<div class="field"><label for="f_${k}">${label}</label><input id="f_${k}" data-k="${k}" type="${type}" value="${esc(v)}" ${type === 'number' ? 'inputmode="decimal" step="any"' : ''} ${extra}></div>`;
};

function renderInvoice() {
  const v = $('#view');
  const f = ensureForm();
  if (!f) {
    v.innerHTML = `<section class="card empty"><h2>No active properties</h2><p>Add a property to start billing.</p><button class="btn primary" data-act="add-prop">Add property</button></section>`;
    return;
  }
  const p = prop(f.propertyId);
  const elecOn = p.enableElectricity !== false, waterOn = p.enableWater !== false;
  v.innerHTML = `
  <div class="inv-layout">
    <div class="inv-main">
      <section class="card">
        <div class="field"><label for="fProp">Property</label>
          <select id="fProp" data-act="prop">${activeProps().map(x => `<option value="${esc(x.id)}" ${x.id === f.propertyId ? 'selected' : ''}>${esc(x.code)} — ${esc(x.tenantName || 'Vacant')}</option>`).join('')}</select></div>
        ${f.existingId ? `<div class="note">${ICON.edit}<span>Editing saved invoice <b>${esc(f.invoiceNo)}</b> for ${esc(U.monthLong(f.billPeriod))}. Saving replaces it.</span></div>` : ''}
        <div class="grid2">
          ${fld('billPeriod', 'Bill period', 'month')}
          ${fld('invoiceNo', 'Invoice no.')}
          ${fld('invoiceDate', 'Invoice date', 'date')}
          ${fld('dueDate', 'Due date', 'date')}
        </div>
        ${fld('tenantName', 'Tenant name')}
      </section>
      ${elecOn ? `<section class="card">
        <h3>Electricity <small>Meter ${esc(p.electricMeterNo || '—')}</small></h3>
        <div class="grid3">${fld('elecPrev', 'Previous reading', 'number')}${fld('elecCur', 'Current reading', 'number', 'autofocus')}${fld('elecRate', 'Rate / unit', 'number')}</div>
        <div class="calc" id="cElec"></div>
      </section>` : ''}
      ${waterOn ? `<section class="card">
        <h3>Water <small>tank capacity × days = litres</small></h3>
        <div class="grid3">${fld('waterCap', 'Tank capacity (Ltr)', 'number')}${fld('waterDays', 'Days', 'number')}${fld('waterRate', 'Rate / litre', 'number')}</div>
        <div class="calc" id="cWater"></div>
      </section>` : ''}
      <section class="card">
        <h3>Rent &amp; charges</h3>
        ${fld('rent', 'House rent', 'number')}
        <p class="sublabel">Optional charges <small>tick to include on this invoice</small></p>
        <div id="chargeRows">${chargeRows()}</div>
        <button class="btn ghost small" data-act="add-charge">${ICON.plus} Add charge</button>
        <div class="grid2 adj">${fld('adjLabel', 'Adjustment label', 'text', 'placeholder="e.g. Arrears / Advance"')}${fld('adjAmount', 'Adjustment amount (− for credit)', 'number')}</div>
      </section>
    </div>
    <aside class="inv-side">
      <section class="card summary" id="summary"></section>
      <div class="actions">
        <button class="btn wa block" data-act="share">${ICON.wa} Save &amp; send on WhatsApp</button>
        <div class="row2">
          <button class="btn primary" data-act="save">${ICON.save} Save</button>
          <button class="btn" data-act="download">${ICON.down} PDF</button>
        </div>
        <button class="btn ghost block" data-act="preview">${ICON.eye} Preview without saving</button>
      </div>
    </aside>
  </div>`;
  updateSummary();
}

function chargeRows() {
  return (S.form.charges || []).map((c, i) => `
    <div class="charge ${c.on === false ? 'off' : ''}">
      <input type="checkbox" aria-label="Include ${esc(c.label)}" data-ci="${i}" data-cf="on" ${c.on === false ? '' : 'checked'}>
      <input aria-label="Charge label" data-ci="${i}" data-cf="label" value="${esc(c.label)}" placeholder="Label">
      <input aria-label="Charge amount" data-ci="${i}" data-cf="amount" type="number" step="any" inputmode="decimal" value="${esc(c.amount)}" placeholder="0">
      <button class="icon-btn" data-act="del-charge" data-i="${i}" aria-label="Remove charge">${ICON.x}</button>
    </div>`).join('');
}

function currentCalc() {
  const f = S.form, p = prop(f.propertyId);
  return U.compute(f, p, S.settings);
}

function updateSummary() {
  const f = S.form, p = prop(f.propertyId), c = currentCalc();
  const el = $('#cElec');
  if (el && c.electricity) el.innerHTML = `<span>${c.electricity.units} units × ${c.electricity.rate}</span><b>₹ ${U.inr(c.electricity.amount)}</b>${f.lastElecUnits != null ? `<em>Last month: ${f.lastElecUnits} units</em>` : ''}`;
  const wl = $('#cWater');
  if (wl && c.water) wl.innerHTML = `<span>${c.water.capacity} Ltr × ${c.water.days} days = ${c.water.units} Ltr × ${c.water.rate}</span><b>₹ ${U.inr(c.water.amount)}</b>${f.lastWaterUnits != null ? `<em>Last month: ${f.lastWaterUnits} Ltr</em>` : ''}`;
  const lines = [['House rent', c.rentAmt]];
  if (c.electricity) lines.push([`Electricity (${c.electricity.units} u)`, c.electricity.amount]);
  if (c.water) lines.push([`Water (${c.water.units} Ltr)`, c.water.amount]);
  c.charges.forEach(x => lines.push([x.label, x.amount]));
  if (c.adjustment) lines.push([c.adjustment.label, c.adjustment.amount]);
  if (c.roundOff) lines.push(['Round off', c.roundOff]);
  $('#summary').innerHTML = `
    <div class="sum-head"><span>${esc(p.code)} · ${esc(U.monthLong(f.billPeriod || U.ymNow()))}</span><span>${esc(f.invoiceNo)}</span></div>
    <dl>${lines.map(([k, val]) => `<div><dt>${esc(k)}</dt><dd>${U.inr(val)}</dd></div>`).join('')}</dl>
    <div class="sum-total"><span>Total payable</span><b>₹ ${U.inr(c.total)}</b></div>
    <p class="words">${esc(c.amountInWords)}</p>
    ${[...c.errors.map(e => `<p class="msg err">${esc(e)}</p>`), ...c.warnings.map(w => `<p class="msg warn">${esc(w)}</p>`)].join('')}`;
}

function onInput(e) {
  const t = e.target;
  if (S.tab !== 'invoice' || !S.form) return;
  const f = S.form;
  if (t.dataset.k) {
    const k = t.dataset.k;
    if (k === 'billPeriod') return; // handled on change
    f[k] = t.value;
    if (k === 'invoiceNo') f.autoNo = false;
    if (k === 'dueDate') f.autoDue = false;
    updateSummary();
  } else if (t.dataset.ci !== undefined) {
    const ch = f.charges[+t.dataset.ci];
    if (t.dataset.cf === 'on') { ch.on = t.checked; t.closest('.charge').classList.toggle('off', !t.checked); }
    else ch[t.dataset.cf] = t.value;
    updateSummary();
  }
}

function onChange(e) {
  const t = e.target;
  if (S.tab === 'invoice' && S.form) {
    if (t.id === 'fProp') { S.form = newForm(t.value, defaultPeriod(t.value)); renderInvoice(); return; }
    if (t.dataset.k === 'billPeriod' && t.value) { S.form = newForm(S.form.propertyId, t.value); renderInvoice(); if (S.form.existingId) toast('Loaded the saved invoice for this month'); return; }
    if (t.dataset.k === 'invoiceDate' && t.value) {
      const f = S.form;
      if (f.autoDue) { f.dueDate = U.addDays(t.value, S.settings.invoice.dueDays); $('#f_dueDate').value = f.dueDate; }
      if (f.autoNo) { const n = nextInvoiceNumber(f.propertyId, t.value, f.existingId); f.invoiceNo = n.no; f.invoiceSeq = n.seq; $('#f_invoiceNo').value = n.no; }
      updateSummary();
    }
  }
  if (S.tab === 'history' && t.id === 'hFilter') { S.histFilter = t.value; renderHistory(); }
  if (S.tab === 'payments' && t.id === 'pFilter') { S.histFilter = t.value; renderPayments(); }
}

async function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.tagName === 'SELECT') return;
  const act = b.dataset.act, id = b.dataset.id;
  try {
    switch (act) {
      // setup
      case 'pick': await Store.pickFolder(); await start(); break;
      case 'reconnect': await Store.reconnect(); await start(); break;
      case 'device': await Store.useDevice(); await start(); break;
      // invoice
      case 'add-charge': S.form.charges.push({ label: '', amount: '', on: true }); $('#chargeRows').innerHTML = chargeRows(); updateSummary(); break;
      case 'del-charge': S.form.charges.splice(+b.dataset.i, 1); $('#chargeRows').innerHTML = chargeRows(); updateSummary(); break;
      case 'save': { const r = await saveCurrent(); if (r) { toast(`Saved ${r.rec.invoiceNo}`, 'ok'); renderInvoice(); } break; }
      case 'download': { const r = await saveCurrent(); if (r) { downloadBlob(r.blob, r.fname); renderInvoice(); } break; }
      case 'share': { const r = await saveCurrent(); if (r) { renderInvoice(); await shareInvoice(r.rec, r.blob, r.fname); } break; }
      case 'preview': {
        const c = currentCalc(); if (c.errors.length) return toast(c.errors[0], 'err');
        const rec = recordFromForm(S.form, c);
        openBlob(pdfBlob(rec), invoiceFileName(rec, S.settings)); break;
      }
      case 'add-prop': switchTab('properties'); editProperty(null); break;
      // history
      case 'h-open': { const r = findInvoice(id); S.form = formFromRecord(r); switchTab('invoice'); break; }
      case 'h-pdf': { const r = findInvoice(id); const { blob, fname } = await getPdf(r); openBlob(blob, fname); break; }
      case 'h-share': { const r = findInvoice(id); const { blob, fname } = await getPdf(r); await shareInvoice(r, blob, fname); break; }
      case 'h-text': { const r = findInvoice(id); openWhatsAppText(r); break; }
      case 'h-pay': await recordPayment(id); break;
      case 'pay-new': await recordPayment(null); break;
      case 'pay-del': await deletePayment(id); break;
      case 'pay-receipt': openReceipt(findPayment(id)); break;
      case 'h-del': await deleteInvoice(id); break;
      // properties
      case 'p-edit': editProperty(id); break;
      case 'p-new': editProperty(null); break;
      case 'p-bill': { S.form = newForm(id, defaultPeriod(id)); switchTab('invoice'); toast(`New invoice for ${U.monthLong(S.form.billPeriod)} — change the bill period if needed`); break; }
      // settings
      case 's-save': await saveSettingsForm(); break;
      case 's-json': await editRawJson(b.dataset.file); break;
      case 's-backup': await backup(); break;
      case 's-import': $('#importFile').click(); break;
      case 's-folder': await changeLocation('folder'); break;
      case 's-device': await changeLocation('device'); break;
      case 's-reload': await loadAll(); S.form = null; toast('Reloaded from the houserent folder', 'ok'); renderSettings(); break;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
    console.error(err); toast(err.message || String(err), 'err');
  }
}

// ------------------------------------------------------------------ records & PDFs
function recordFromForm(f, c) {
  const p = prop(f.propertyId), s = S.settings, now = new Date().toISOString();
  let seq = f.invoiceSeq;
  if (!f.autoNo) { // derive the sequence from a hand-typed number so later auto numbers continue from it
    const year = (f.invoiceDate || '').slice(0, 4);
    const nums = (String(f.invoiceNo).match(/\d+/g) || []).filter(n => n !== year && n !== year.slice(2));
    if (nums.length) seq = Number(nums[0]);
  }
  return {
    id: `${f.propertyId}_${f.billPeriod}`, propertyId: f.propertyId, propertyCode: p.code || '',
    propertyAddressLines: p.addressLines?.length ? p.addressLines : s.propertyAddressLines,
    invoiceNo: String(f.invoiceNo).trim(), invoiceSeq: seq, invoiceDate: f.invoiceDate, dueDate: f.dueDate,
    billPeriod: f.billPeriod, billMonth: U.nextYm(f.billPeriod),
    tenantName: String(f.tenantName || '').trim(), tenantPhone: p.tenantPhone || '',
    electricMeterNo: p.electricMeterNo || '', waterTankCapacity: p.waterTankCapacity || '',
    rent: { qty: 1, rate: c.rent, amount: c.rentAmt },
    electricity: c.electricity, water: c.water,
    charges: c.charges, adjustment: c.adjustment,
    subtotal: c.subtotal, roundOff: c.roundOff, total: c.total, amountInWords: c.amountInWords,
    createdAt: f.createdAt || now, updatedAt: now,
    issuer: { landlord: U.clone(s.landlord), payment: U.clone(s.payment) }
  };
}

const pdfBlob = rec => buildInvoicePdf(rec, S.settings).output('blob');

async function saveCurrent() {
  const f = S.form, c = currentCalc();
  if (c.errors.length) { toast(c.errors[0], 'err'); return null; }
  const rec = recordFromForm(f, c);
  const pid = rec.propertyId;
  const list = S.invoices[pid] || [];
  const clash = list.find(r => r.id === rec.id && r.id !== f.existingId);
  if (clash && !confirm(`An invoice for ${U.monthLong(rec.billPeriod)} already exists (${clash.invoiceNo}). Replace it?`)) return null;
  const old = list.find(r => r.id === f.existingId) || clash;
  if (old) rec.createdAt = old.createdAt;
  const fname = invoiceFileName(rec, S.settings);
  rec.pdfFile = `pdf/${pid}/${fname}`;
  const blob = pdfBlob(rec);
  S.invoices[pid] = [...list.filter(r => r.id !== rec.id && r.id !== f.existingId), rec].sort(byPeriod);
  await saveInvoiceFile(pid);
  for (const o of [old, clash]) if (o?.pdfFile && o.pdfFile !== rec.pdfFile) await Store.remove(o.pdfFile).catch(() => {});
  await Store.writeBlob(rec.pdfFile, blob);
  // keep payments attached when the bill period / number of a saved invoice changes
  const moved = (S.payments[pid] || []).filter(x => x.invoiceId === f.existingId && (f.existingId !== rec.id || x.invoiceNo !== rec.invoiceNo));
  if (moved.length) { moved.forEach(x => { x.invoiceId = rec.id; x.invoiceNo = rec.invoiceNo; x.billPeriod = rec.billPeriod; }); await savePaymentFile(pid); }
  S.form = formFromRecord(rec);
  return { rec, blob, fname };
}

async function getPdf(rec) {
  const fname = invoiceFileName(rec, S.settings);
  let blob = rec.pdfFile ? await Store.readBlob(rec.pdfFile) : null;
  if (!blob) { // regenerate from the saved record
    blob = pdfBlob(rec);
    rec.pdfFile = `pdf/${rec.propertyId}/${fname}`;
    await Store.writeBlob(rec.pdfFile, blob);
    await saveInvoiceFile(rec.propertyId);
  }
  return { blob: blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' }), fname: rec.pdfFile.split('/').pop() };
}

function waText(rec) {
  const s = S.settings, pay = rec.issuer?.payment || s.payment, ll = rec.issuer?.landlord || s.landlord;
  return U.fill(s.whatsapp.message, {
    tenant: rec.tenantName, period: U.monthLong(rec.billPeriod), periodShort: U.monthShort(rec.billPeriod),
    invoiceNo: rec.invoiceNo, total: U.inr(rec.total), dueDate: U.fmtDate(rec.dueDate), code: rec.propertyCode,
    upi: pay.upiId || '', accountNo: pay.accountNo || '', bank: pay.bankName || '', ifsc: pay.ifsc || '', landlord: ll.name || ''
  });
}
function waPhone(rec) {
  let ph = String(prop(rec.propertyId)?.tenantPhone || rec.tenantPhone || '').replace(/\D/g, '');
  if (ph.length === 10) ph = (S.settings.whatsapp.countryCode || '91') + ph;
  return ph;
}
function openWhatsAppText(rec) {
  const ph = waPhone(rec);
  window.open(`https://wa.me/${ph}?text=${encodeURIComponent(waText(rec))}`, '_blank', 'noopener');
}

async function shareInvoice(rec, blob, fname) {
  const file = new File([blob], fname, { type: 'application/pdf' });
  const text = waText(rec);
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: fname.replace(/\.pdf$/, ''), text }); return; }
    catch (e) {
      if (e.name === 'AbortError') return;
      if (e.name === 'NotAllowedError') { // the save took too long for the browser's tap window; ask for one more tap
        const ok = await modal({ title: 'Ready to share', body: `<p>${esc(fname)} is saved. Tap <b>Share</b> and choose WhatsApp.</p>`, ok: 'Share' });
        if (ok) await navigator.share({ files: [file], title: fname, text }).catch(() => {});
        return;
      }
      throw e;
    }
  }
  // No file sharing (most desktop browsers): download the PDF and open the chat with the message.
  downloadBlob(blob, fname);
  if (!waPhone(rec)) toast('Add the tenant’s WhatsApp number in Properties to open their chat directly', 'warn');
  openWhatsAppText(rec);
  toast('PDF downloaded — attach it in the WhatsApp chat', 'ok');
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
function openBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) downloadBlob(blob, name);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ------------------------------------------------------------------ payments
const allPayments = () => Object.values(S.payments).flat();
const findPayment = id => allPayments().find(x => x.id === id);
const paymentsFor = invId => allPayments().filter(x => x.invoiceId === invId).sort((a, b) => a.date.localeCompare(b.date));

function invStatus(rec) {
  const pays = paymentsFor(rec.id);
  const paid = U.r2(pays.reduce((a, x) => a + U.num(x.amount), 0));
  const balance = U.r2(rec.total - paid);
  const state = paid > 0 && balance <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
  return { pays, paid, balance, state, lastDate: pays.length ? pays[pays.length - 1].date : null };
}
function statusPill(rec, st = invStatus(rec)) {
  const txt = st.state === 'paid' ? `Paid ${U.fmtDate(st.lastDate)}` : st.state === 'partial' ? `Due ₹ ${U.inr(st.balance)}` : 'Unpaid';
  return `<span class="pill ${st.state === 'paid' ? 'ok' : st.state === 'partial' ? 'part' : ''}">${esc(txt)}</span>`;
}

function newPaymentObj(rec, v) {
  return {
    id: 'pay_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    invoiceId: rec.id, invoiceNo: rec.invoiceNo, propertyId: rec.propertyId, billPeriod: rec.billPeriod, tenantName: rec.tenantName,
    date: v.date, amount: U.r2(U.num(v.amount)), mode: v.mode, reference: v.reference || '', note: v.note || '',
    createdAt: new Date().toISOString()
  };
}

// invId null = choose from invoices that still have a balance
async function recordPayment(invId) {
  const open = allInvoices().map(r => ({ r, st: invStatus(r) })).filter(x => x.st.balance > 0 || x.r.id === invId)
    .sort((a, b) => a.r.billPeriod.localeCompare(b.r.billPeriod));
  if (!open.length) return toast('All invoices are fully paid', 'ok');
  const sel = invId ? open.find(x => x.r.id === invId) || { r: findInvoice(invId), st: invStatus(findInvoice(invId)) } : open[0];
  const modes = S.settings.paymentModes?.length ? S.settings.paymentModes : ['UPI', 'Bank transfer', 'Cash', 'Cheque', 'Other'];
  const body = `<form id="payForm">
    ${invId ? `<p><b>${esc(sel.r.invoiceNo)}</b> · ${esc(sel.r.tenantName)} · ${esc(U.monthLong(sel.r.billPeriod))}<br>
      <span class="hint">Total ₹ ${U.inr(sel.r.total)} · paid ₹ ${U.inr(sel.st.paid)} · balance ₹ ${U.inr(sel.st.balance)}</span></p>`
    : `<div class="field"><label>Invoice</label><select name="inv">${open.map(x => `<option value="${esc(x.r.id)}">${esc(x.r.propertyCode)} · ${esc(U.monthShort(x.r.billPeriod))} · ${esc(x.r.invoiceNo)} — due ₹ ${U.inr(x.st.balance)}</option>`).join('')}</select></div>`}
    <div class="grid2">
      <div class="field"><label>Amount received</label><input name="amount" type="number" step="any" inputmode="decimal" value="${Math.max(0, sel.st.balance)}" required></div>
      <div class="field"><label>Date</label><input name="date" type="date" value="${U.isoToday()}" required></div>
    </div>
    <div class="field"><label>Mode</label><select name="mode">${modes.map(m => `<option>${esc(m)}</option>`).join('')}</select></div>
    <div class="field"><label>Transaction ID / UTR / cheque no.</label><input name="reference" autocomplete="off"></div>
    <div class="field"><label>Note</label><input name="note" autocomplete="off"></div>
    <label class="check"><input type="checkbox" name="receipt"> Send receipt on WhatsApp after saving</label>
  </form>`;
  const pending = modal({ title: 'Record payment', body, ok: 'Save payment',
    validate: () => { if (U.num($('#payForm [name=amount]').value) <= 0) { toast('Enter the amount received', 'err'); return false; } if (!$('#payForm [name=date]').value) { toast('Enter the payment date', 'err'); return false; } return true; },
    collect: () => Object.fromEntries(new FormData($('#payForm'))) });
  const invSel = $('#payForm [name=inv]');
  if (invSel) invSel.onchange = () => { const x = open.find(o => o.r.id === invSel.value); $('#payForm [name=amount]').value = Math.max(0, x.st.balance); };
  const v = await pending;
  if (!v) return;
  const rec = invId ? sel.r : open.find(o => o.r.id === v.inv).r;
  const pay = newPaymentObj(rec, v);
  (S.payments[rec.propertyId] ||= []).push(pay);
  S.payments[rec.propertyId].sort((a, b) => a.date.localeCompare(b.date));
  await savePaymentFile(rec.propertyId);
  const st = invStatus(rec);
  toast(st.state === 'paid' ? `${rec.invoiceNo} fully paid` : `Payment saved — balance ₹ ${U.inr(st.balance)}`, 'ok');
  rerender();
  if (v.receipt) openReceipt(pay);
}

async function deletePayment(id) {
  const x = findPayment(id);
  const ok = await modal({ title: 'Delete payment?', body: `<p>₹ ${U.inr(x.amount)} on ${esc(U.fmtDate(x.date))} (${esc(x.mode)}) for ${esc(x.invoiceNo)}</p>`, ok: 'Delete', danger: true });
  if (!ok) return;
  S.payments[x.propertyId] = S.payments[x.propertyId].filter(p => p.id !== id);
  await savePaymentFile(x.propertyId);
  toast('Payment deleted'); rerender();
}

function openReceipt(pay) {
  const rec = findInvoice(pay.invoiceId);
  const st = rec ? invStatus(rec) : { balance: 0 };
  const text = U.fill(S.settings.whatsapp.receiptMessage, {
    tenant: pay.tenantName, amount: U.inr(pay.amount), date: U.fmtDate(pay.date), mode: pay.mode,
    reference: pay.reference ? ` (Ref: ${pay.reference})` : '', invoiceNo: pay.invoiceNo, period: U.monthLong(pay.billPeriod),
    balance: U.inr(Math.max(0, st.balance)), landlord: S.settings.landlord?.name || ''
  });
  const ph = waPhone(rec || pay);
  const w = window.open(`https://wa.me/${ph}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  if (w === null && !navigator.userAgent.includes('Headless')) toast('Allow pop-ups to open WhatsApp', 'warn');
}

function rerender() { switchTab(S.tab); }

async function deleteInvoice(id) {
  const r = findInvoice(id);
  const pays = paymentsFor(id);
  const ok = await modal({ title: 'Delete invoice?', body: `<p>${esc(r.invoiceNo)} · ${esc(r.tenantName)} · ${esc(U.monthLong(r.billPeriod))}</p><p class="hint">The record and its PDF are removed from the houserent folder${pays.length ? `, together with ${pays.length} recorded payment(s)` : ''}.</p>`, ok: 'Delete', danger: true });
  if (!ok) return;
  S.invoices[r.propertyId] = S.invoices[r.propertyId].filter(x => x.id !== id);
  await saveInvoiceFile(r.propertyId);
  if (pays.length) { S.payments[r.propertyId] = (S.payments[r.propertyId] || []).filter(x => x.invoiceId !== id); await savePaymentFile(r.propertyId); }
  if (r.pdfFile) await Store.remove(r.pdfFile).catch(() => {});
  if (S.form?.existingId === id) S.form = null;
  toast('Invoice deleted');
  renderHistory();
}

const propFilter = id => `<select id="${id}"><option value="all">All properties</option>${S.properties.map(p => `<option value="${esc(p.id)}" ${S.histFilter === p.id ? 'selected' : ''}>${esc(p.code)} — ${esc(p.tenantName || '')}</option>`).join('')}</select>`;

// ------------------------------------------------------------------ history
function renderHistory() {
  const all = allInvoices().filter(r => S.histFilter === 'all' || r.propertyId === S.histFilter)
    .sort((a, b) => b.billPeriod.localeCompare(a.billPeriod) || (b.invoiceDate || '').localeCompare(a.invoiceDate || ''));
  const sts = new Map(all.map(r => [r.id, invStatus(r)]));
  const open = all.filter(r => sts.get(r.id).state !== 'paid');
  const due = open.reduce((a, r) => a + Math.max(0, sts.get(r.id).balance), 0);
  $('#view').innerHTML = `
  <section class="card hist-top">
    <div class="field"><label for="hFilter">Property</label>${propFilter('hFilter')}</div>
    <div class="stats"><div><b>${all.length}</b><span>invoices</span></div><div><b>${open.length}</b><span>not fully paid</span></div><div><b>₹ ${U.inr(due)}</b><span>outstanding</span></div></div>
  </section>
  ${all.length ? `<div class="hist">${all.map(r => histCard(r, sts.get(r.id))).join('')}</div>` : `<section class="card empty"><p>No invoices yet.</p></section>`}`;
}
function histCard(r, st) {
  return `<article class="card hcard ${st.state}">
    <div class="h-top">
      <div><h3>${esc(U.monthLong(r.billPeriod))}</h3><p>${esc(r.propertyCode)} · ${esc(r.tenantName)}</p></div>
      <div class="h-amt"><b>₹ ${U.inr(r.total)}</b>${statusPill(r, st)}</div>
    </div>
    <p class="h-meta">${esc(r.invoiceNo)} · ${esc(U.fmtDate(r.invoiceDate))}${r.electricity ? ` · ${r.electricity.previous}→${r.electricity.current} (${r.electricity.units} u)` : ''}${r.water ? ` · water ${r.water.units} L` : ''}</p>
    ${st.pays.length ? `<ul class="paylist">${st.pays.map(x => `<li><span>${esc(U.fmtDate(x.date))} · ${esc(x.mode)}${x.reference ? ` · ${esc(x.reference)}` : ''}</span><b>₹ ${U.inr(x.amount)}</b></li>`).join('')}</ul>` : ''}
    <div class="h-actions">
      <button class="btn small wa ${st.state === 'paid' ? 'span2' : ''}" data-act="h-share" data-id="${esc(r.id)}">${ICON.wa} Send</button>
      ${st.state !== 'paid' ? `<button class="btn small pay" data-act="h-pay" data-id="${esc(r.id)}" title="Record payment">Payment</button>` : ''}
      <button class="btn small" data-act="h-pdf" data-id="${esc(r.id)}">${ICON.eye} PDF</button>
      <button class="btn small ghost" data-act="h-open" data-id="${esc(r.id)}" aria-label="Edit" title="Edit">${ICON.edit}</button>
      <button class="btn small ghost danger" data-act="h-del" data-id="${esc(r.id)}" aria-label="Delete" title="Delete">${ICON.trash}</button>
    </div>
  </article>`;
}

// ------------------------------------------------------------------ payments tab
function renderPayments() {
  const list = allPayments().filter(x => S.histFilter === 'all' || x.propertyId === S.histFilter)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const ym = U.ymNow();
  const month = list.filter(x => x.date.startsWith(ym)).reduce((a, x) => a + U.num(x.amount), 0);
  const total = list.reduce((a, x) => a + U.num(x.amount), 0);
  $('#view').innerHTML = `
  <div class="sec-head"><h2>Payments</h2><button class="btn pay small" data-act="pay-new">${ICON.plus} Record payment</button></div>
  <section class="card hist-top">
    <div class="field"><label for="pFilter">Property</label>${propFilter('pFilter')}</div>
    <div class="stats"><div><b>${list.length}</b><span>payments</span></div><div><b>₹ ${U.inr(month)}</b><span>${esc(U.monthShort(ym))}</span></div><div><b>₹ ${U.inr(total)}</b><span>total received</span></div></div>
  </section>
  ${list.length ? `<div class="plist">${list.map(x => `<article class="card paycard">
      <div class="h-top"><div><h3>₹ ${U.inr(x.amount)}</h3><p>${esc(U.fmtDate(x.date))} · ${esc(x.mode)}</p></div>
        <div class="h-amt"><b>${esc(x.invoiceNo)}</b><span class="h-meta" style="margin:0">${esc(U.monthShort(x.billPeriod))}</span></div></div>
      <p class="h-meta">${esc(prop(x.propertyId)?.code || '')} · ${esc(x.tenantName)}${x.reference ? ` · Ref ${esc(x.reference)}` : ''}${x.note ? ` · ${esc(x.note)}` : ''}</p>
      <div class="h-actions"><button class="btn small wa" data-act="pay-receipt" data-id="${esc(x.id)}">${ICON.wa} Receipt</button>
        <button class="btn small ghost danger" data-act="pay-del" data-id="${esc(x.id)}" aria-label="Delete">${ICON.trash}</button></div>
    </article>`).join('')}</div>` : `<section class="card empty"><p>No payments recorded yet.</p></section>`}`;
}


// ------------------------------------------------------------------ properties
function renderProperties() {
  $('#view').innerHTML = `
  <div class="sec-head"><h2>Properties</h2><button class="btn primary small" data-act="p-new">${ICON.plus} Add</button></div>
  <div class="plist">${S.properties.map(p => {
    const last = (S.invoices[p.id] || []).slice(-1)[0];
    return `<article class="card pcard ${p.active === false ? 'inactive' : ''}">
      <div class="h-top"><div><h3>${esc(p.code)}</h3><p>${esc(p.name || '')}</p></div><b>₹ ${U.inr(p.rent)}</b></div>
      <p class="h-meta">${esc(p.tenantName || 'Vacant')}${p.tenantPhone ? ' · ' + esc(p.tenantPhone) : ' · <em>no WhatsApp no.</em>'}</p>
      <p class="h-meta">Meter ${esc(p.electricMeterNo || '—')} · Tank ${esc(p.waterTankCapacity || '—')} Ltr${last ? ` · last bill ${esc(U.monthShort(last.billPeriod))}` : ''}${p.active === false ? ' · inactive' : ''}</p>
      <div class="h-actions"><button class="btn small" data-act="p-edit" data-id="${esc(p.id)}">${ICON.edit} Edit</button>
        ${p.active !== false ? `<button class="btn small primary" data-act="p-bill" data-id="${esc(p.id)}">${ICON.doc} New invoice</button>` : ''}</div>
    </article>`;
  }).join('') || '<section class="card empty"><p>No properties yet.</p></section>'}</div>`;
}

const PROP_FIELDS = [
  ['code', 'Property code (shown in invoice title)', 'text', 'e.g. RC 1BH 1F'],
  ['name', 'Description', 'text', 'e.g. 1 BHK, First Floor'],
  ['tenantName', 'Tenant name', 'text'],
  ['tenantPhone', 'Tenant WhatsApp number', 'tel', '10-digit or with country code'],
  ['rent', 'Monthly rent', 'number'],
  ['electricMeterNo', 'Electric meter no.', 'text'],
  ['openingMeterReading', 'Opening meter reading (used when there is no previous invoice)', 'number'],
  ['waterTankCapacity', 'Water tank capacity (Ltr)', 'number'],
  ['electricityRate', 'Electricity rate / unit (blank = default)', 'number'],
  ['waterRate', 'Water rate / litre (blank = default)', 'number'],
  ['charges', 'Optional monthly charges (ticked = included by default; can be switched per invoice)', 'charges'],
  ['addressLines', 'Address on invoice header (one line each; blank = default)', 'lines'],
  ['enableElectricity', 'Bill electricity', 'check'],
  ['enableWater', 'Bill water', 'check'],
  ['active', 'Active (show in invoice list)', 'check'],
  ['notes', 'Notes', 'text']
];

async function editProperty(id) {
  const isNew = !id;
  const p = isNew ? { id: 'p' + Date.now().toString(36), code: '', rent: 0, waterTankCapacity: 200, charges: [], enableElectricity: true, enableWater: true, active: true, electricityRate: null, waterRate: null } : U.clone(prop(id));
  if (isNew) p.charges = U.clone(S.settings.defaultCharges || []);
  const d = S.settings;
  const ph = { electricityRate: d.rates.electricityPerUnit, waterRate: d.rates.waterPerLitre, addressLines: (d.propertyAddressLines || []).join('\n') };
  const body = `<form id="propForm" class="pform">${PROP_FIELDS.map(([k, label, type, hint]) => {
    const v = p[k];
    if (type === 'check') return `<label class="check"><input type="checkbox" name="${k}" ${v !== false ? 'checked' : ''}> ${label}</label>`;
    if (type === 'charges') return `<div class="field"><label>${label}</label><div id="pCharges">${(v || []).map(chargeEditRow).join('')}</div>
      <button type="button" class="btn ghost small" id="pAddCharge">${ICON.plus} Add charge</button></div>`;
    if (type === 'lines') return `<div class="field"><label>${label}</label><textarea name="${k}" rows="3" placeholder="${esc(ph[k])}">${esc((v || []).join('\n'))}</textarea></div>`;
    return `<div class="field"><label>${label}</label><input name="${k}" type="${type}" ${type === 'number' ? 'step="any" inputmode="decimal"' : ''} value="${esc(v ?? '')}" placeholder="${esc(hint || ph[k] || '')}"></div>`;
  }).join('')}</form>`;
  const pending = modal({ title: isNew ? 'Add property' : `Edit ${p.code}`, body, ok: 'Save', extra: isNew ? null : 'Delete',
    validate: () => { const c = $('#propForm [name=code]').value.trim(); if (!c) { toast('Property code is required', 'err'); return false; } return true; },
    collect: () => {
      const fd = new FormData($('#propForm'));
      const out = { ...p };
      for (const [k, , type] of PROP_FIELDS) {
        const raw = fd.get(k);
        if (type === 'check') out[k] = raw === 'on';
        else if (type === 'charges') out[k] = $$('#pCharges .charge').map(row => ({ label: $('[data-pc=label]', row).value.trim(), amount: U.num($('[data-pc=amount]', row).value), on: $('[data-pc=on]', row).checked })).filter(c => c.label);
        else if (type === 'lines') out[k] = String(raw || '').split('\n').map(l => l.trim()).filter(Boolean);
        else if (type === 'number') out[k] = String(raw).trim() === '' ? null : U.num(raw);
        else out[k] = String(raw || '').trim();
      }
      out.rent = out.rent ?? 0;
      return out;
    } });
  $('#pAddCharge').onclick = () => $('#pCharges').insertAdjacentHTML('beforeend', chargeEditRow({ label: '', amount: '', on: true }));
  $('#pCharges').onclick = e => { const x = e.target.closest('[data-pc=del]'); if (x) x.closest('.charge').remove(); };
  const res = await pending;
  if (!res) return;
  if (res === 'extra') {
    const hasInv = (S.invoices[id] || []).length;
    const ok = await modal({ title: `Delete ${p.code}?`, body: `<p>${hasInv ? `This property has ${hasInv} saved invoice(s). They stay in the houserent folder, but the property disappears from the app. Consider unticking <b>Active</b> instead.` : 'The property will be removed.'}</p>`, ok: 'Delete', danger: true });
    if (!ok) return;
    S.properties = S.properties.filter(x => x.id !== id);
  } else {
    const i = S.properties.findIndex(x => x.id === res.id);
    if (i >= 0) S.properties[i] = res; else S.properties.push(res);
  }
  await saveProperties();
  if (S.form && (S.form.propertyId === p.id) && !S.form.existingId) S.form = null;
  toast('properties.json saved', 'ok');
  renderProperties();
}

function chargeEditRow(c) {
  return `<div class="charge"><input type="checkbox" data-pc="on" aria-label="Included by default" ${c.on === false ? '' : 'checked'}>
    <input data-pc="label" value="${esc(c.label)}" placeholder="e.g. Trash" aria-label="Charge label">
    <input data-pc="amount" type="number" step="any" inputmode="decimal" value="${esc(c.amount)}" placeholder="0" aria-label="Amount">
    <button type="button" class="icon-btn" data-pc="del" aria-label="Remove">${ICON.x}</button></div>`;
}

// ------------------------------------------------------------------ settings
const SETTINGS_FIELDS = [
  ['Landlord', [
    ['landlord.name', 'Name'], ['landlord.addressLines', 'Address (one line each)', 'lines'], ['landlord.phone', 'Phone']]],
  ['Invoice', [
    ['propertyAddressLines', 'Default header address (one line each)', 'lines'],
    ['invoice.title', 'Title'], ['invoice.prefix', 'Number prefix'],
    ['invoice.numberFormat', 'Number format — {prefix} {seq} {year} {yy} {code}'], ['invoice.seqDigits', 'Sequence digits', 'number'],
    ['invoice.numbering', 'Numbering', 'select', [['perProperty', 'Separate sequence per property'], ['global', 'One sequence for all properties']]],
    ['invoice.dueDays', 'Due date = invoice date + days', 'number'],
    ['invoice.rounding', 'Round total', 'select', [['nearest', 'To nearest rupee'], ['up', 'Up to next rupee'], ['none', 'No rounding']]],
    ['invoice.fileNameFormat', 'PDF file name — {mon} {month} {year} {tenant} {code} {invoiceNo}']]],
  ['Default rates', [
    ['rates.electricityPerUnit', 'Electricity / unit', 'number'], ['rates.waterPerLitre', 'Water / litre', 'number'],
    ['defaultCharges', 'Optional charges for new properties — one per line: Label | amount', 'charges']]],
  ['Payments', [
    ['paymentModes', 'Payment modes (one per line)', 'lines'],
    ['whatsapp.receiptMessage', 'Receipt message — {tenant} {amount} {date} {mode} {reference} {invoiceNo} {period} {balance} {landlord}', 'textarea']]],
  ['Payment details', [
    ['payment.note', 'Band text'], ['payment.accountNo', 'Account no.'], ['payment.bankName', 'Bank'], ['payment.branch', 'Branch'],
    ['payment.ifsc', 'IFSC'], ['payment.upiId', 'UPI ID (printed)'], ['payment.showQr', 'Print UPI QR code', 'check'],
    ['payment.qrUpiId', 'UPI ID for QR (blank = same)'], ['payment.qrPayeeName', 'Payee name for QR'], ['payment.qrIncludeAmount', 'QR pre-fills the bill amount', 'check']]],
  ['WhatsApp', [
    ['whatsapp.countryCode', 'Country code for 10-digit numbers'],
    ['whatsapp.message', 'Message — {tenant} {period} {invoiceNo} {total} {dueDate} {upi} {accountNo} {bank} {ifsc} {landlord} {code}', 'textarea']]],
  ['PDF colours', [
    ['theme.accent', 'Accent (title, table header, total)', 'color'], ['theme.soft', 'Light tint (table header background)', 'color']]]
];
const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => (a[k] ||= {}), o)[last] = v; };

function renderSettings() {
  const s = S.settings;
  const input = ([path, label, type = 'text', opts]) => {
    const v = getPath(s, path);
    const id = 's_' + path.replace(/\./g, '_');
    if (type === 'check') return `<label class="check"><input type="checkbox" data-sp="${path}" data-st="check" ${v ? 'checked' : ''}> ${esc(label)}</label>`;
    if (type === 'select') return `<div class="field"><label for="${id}">${esc(label)}</label><select id="${id}" data-sp="${path}" data-st="text">${opts.map(([val, l]) => `<option value="${val}" ${v === val ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
    if (type === 'charges') return `<div class="field"><label for="${id}">${esc(label)}</label><textarea id="${id}" rows="4" data-sp="${path}" data-st="charges">${esc((v || []).map(c => `${c.label} | ${c.amount}`).join('\n'))}</textarea></div>`;
    if (type === 'lines' || type === 'textarea') return `<div class="field"><label for="${id}">${esc(label)}</label><textarea id="${id}" rows="${type === 'textarea' ? 8 : 4}" data-sp="${path}" data-st="${type}">${esc(type === 'lines' ? (v || []).join('\n') : v)}</textarea></div>`;
    return `<div class="field ${type === 'color' ? 'color' : ''}"><label for="${id}">${esc(label)}</label><input id="${id}" type="${type}" ${type === 'number' ? 'step="any" inputmode="decimal"' : ''} data-sp="${path}" data-st="${type}" value="${esc(v ?? '')}"></div>`;
  };
  $('#view').innerHTML = `
  <section class="card">
    <h3>Data folder</h3>
    <p class="loc">${Store.mode === 'folder' ? ICON.folder : ICON.phone}<b>${esc(Store.label())}</b></p>
    <p class="hint">settings.json · properties.json · invoices/&lt;property&gt;.json · payments/&lt;property&gt;.json · pdf/&lt;property&gt;/*.pdf</p>
    <div class="btn-row">
      ${Store.fsaSupported ? `<button class="btn small" data-act="s-folder">${ICON.folder} ${Store.mode === 'folder' ? 'Change folder' : 'Use a disk folder'}</button>` : ''}
      ${Store.mode === 'folder' ? `<button class="btn small" data-act="s-device">${ICON.phone} Use on-device storage</button>` : ''}
      <button class="btn small" data-act="s-reload">${ICON.refresh} Reload files</button>
      <button class="btn small" data-act="s-backup">${ICON.down} Backup</button>
      <button class="btn small" data-act="s-import">${ICON.up} Import JSON</button>
    </div>
    <input type="file" id="importFile" accept=".json,application/json" multiple hidden>
    <div class="btn-row"><button class="btn small ghost" data-act="s-json" data-file="settings.json">Edit settings.json</button>
      <button class="btn small ghost" data-act="s-json" data-file="properties.json">Edit properties.json</button></div>
  </section>
  ${SETTINGS_FIELDS.map(([title, fields]) => `<section class="card"><h3>${esc(title)}</h3><div class="sgrid">${fields.map(input).join('')}</div></section>`).join('')}
  <div class="sticky-save"><button class="btn primary block" data-act="s-save">${ICON.save} Save settings.json</button></div>`;
  $('#importFile').addEventListener('change', e => importFiles([...e.target.files]).catch(err => toast(err.message, 'err')));
}

async function saveSettingsForm() {
  const s = U.clone(S.settings);
  $$('[data-sp]').forEach(el => {
    const t = el.dataset.st, p = el.dataset.sp;
    let v = el.value;
    if (t === 'check') v = el.checked;
    else if (t === 'number') v = U.num(v);
    else if (t === 'lines') v = v.split('\n').map(l => l.trim()).filter(Boolean);
    else if (t === 'charges') v = v.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const i = l.lastIndexOf('|'); return i < 0 ? { label: l, amount: 0, on: true } : { label: l.slice(0, i).trim(), amount: U.num(l.slice(i + 1)), on: true }; });
    setPath(s, p, v);
  });
  S.settings = s;
  await Store.writeJSON('settings.json', s);
  if (S.form && !S.form.existingId) S.form = null; // pick up new default rates
  toast('settings.json saved', 'ok');
}

async function editRawJson(file) {
  const data = await Store.readJSON(file, file === 'settings.json' ? S.settings : { properties: S.properties });
  const res = await modal({ title: file, wide: true, body: `<textarea id="rawJson" class="code" spellcheck="false" rows="20">${esc(JSON.stringify(data, null, 2))}</textarea>`, ok: 'Save',
    collect: () => JSON.parse($('#rawJson').value),
    validate: () => { try { JSON.parse($('#rawJson').value); return true; } catch (e) { toast('Invalid JSON: ' + e.message, 'err'); return false; } } });
  if (!res) return;
  await Store.writeJSON(file, res);
  await loadAll(); S.form = null;
  toast(`${file} saved`, 'ok'); renderSettings();
}

async function exportBundle() {
  const files = { 'settings.json': S.settings, 'properties.json': { version: 1, properties: S.properties } };
  for (const [pid, arr] of Object.entries(S.invoices)) files[`invoices/${pid}.json`] = { propertyId: pid, invoices: arr };
  for (const [pid, arr] of Object.entries(S.payments)) files[`payments/${pid}.json`] = { propertyId: pid, payments: arr };
  return { __houserentBackup: 1, createdAt: new Date().toISOString(), files };
}
async function importBundle(b) { for (const [path, data] of Object.entries(b.files || {})) await Store.writeJSON(path, data); }

async function backup() {
  const b = await exportBundle();
  downloadBlob(new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' }), `houserent-backup-${U.isoToday()}.json`);
  toast('Backup downloaded (PDFs are rebuilt from records when needed)', 'ok');
}

async function importFiles(files) {
  let n = 0;
  for (const f of files) {
    const data = JSON.parse(await f.text());
    if (data.__houserentBackup) { await importBundle(data); n++; }
    else if (f.name === 'settings.json' || data.landlord || data.payment) { await Store.writeJSON('settings.json', data); n++; }
    else if (f.name === 'properties.json' || Array.isArray(data.properties)) { await Store.writeJSON('properties.json', data); n++; }
    else if (data.propertyId && Array.isArray(data.payments)) { await Store.writeJSON(`payments/${data.propertyId}.json`, data); n++; }
    else if (data.propertyId && Array.isArray(data.invoices)) { await Store.writeJSON(`invoices/${data.propertyId}.json`, data); n++; }
    else if (Array.isArray(data) && data[0]?.propertyId) { await Store.writeJSON(`invoices/${data[0].propertyId}.json`, { propertyId: data[0].propertyId, invoices: data }); n++; }
    else toast(`${f.name}: not a houserent file`, 'warn');
  }
  await loadAll(); S.form = null;
  toast(`Imported ${n} file(s)`, 'ok'); renderSettings();
}

async function changeLocation(mode) {
  const bundle = await exportBundle();
  if (mode === 'folder') await Store.pickFolder(); else await Store.useDevice();
  const hasData = await Store.exists('settings.json');
  if (!hasData) await importBundle(bundle);
  else if (await modal({ title: 'This location already has data', body: '<p>Keep the data already here, or overwrite it with the data you had open?</p>', ok: 'Keep existing', extra: 'Overwrite' }) === 'extra') await importBundle(bundle);
  await loadAll(); S.form = null; updateBadge();
  toast('Now using ' + Store.label(), 'ok'); renderSettings();
}

// ------------------------------------------------------------------ modal / toast / install
function modal({ title, body, ok = 'OK', cancel = 'Cancel', extra = null, danger = false, wide = false, collect, validate }) {
  const dlg = $('#modal');
  dlg.className = wide ? 'wide' : '';
  dlg.innerHTML = `<div class="m-head"><h2>${esc(title)}</h2><button class="icon-btn" value="cancel" aria-label="Close">${ICON.x}</button></div>
    <div class="m-body">${body}</div>
    <div class="m-foot">${extra ? `<button class="btn ghost danger" value="extra">${esc(extra)}</button>` : ''}<span></span>
      <button class="btn" value="cancel">${esc(cancel)}</button><button class="btn ${danger ? 'danger-fill' : 'primary'}" value="ok">${esc(ok)}</button></div>`;
  return new Promise(resolve => {
    const done = v => { dlg.close(); resolve(v); };
    dlg.onclick = e => {
      const b = e.target.closest('button[value]');
      if (e.target === dlg) return done(false);
      if (!b) return;
      if (b.value === 'cancel') done(false);
      else if (b.value === 'extra') done('extra');
      else if (b.value === 'ok') { if (validate && !validate()) return; done(collect ? collect() : true); }
    };
    dlg.oncancel = e => { e.preventDefault(); done(false); };
    dlg.showModal();
  });
}

let toastT;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = 'show ' + kind;
  clearTimeout(toastT); toastT = setTimeout(() => (t.className = ''), kind === 'err' ? 5000 : 3000);
}

function setupInstall() {
  let ev;
  const btn = $('#installBtn');
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); ev = e; btn.hidden = false; });
  btn.addEventListener('click', async () => { if (!ev) return; ev.prompt(); await ev.userChoice; ev = null; btn.hidden = true; });
}

// ------------------------------------------------------------------ icons
const svg = d => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  phone: svg('<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  save: svg('<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/>'),
  down: svg('<path d="M12 4v12M6 10l6 6 6-6M4 20h16"/>'),
  up: svg('<path d="M12 20V8M6 14l6-6 6 6M4 4h16"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  doc: svg('<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h6"/>'),
  refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>'),
  cash: svg('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v4M18 10v4"/>'),
  chat: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),
  wa: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.4.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.3c0-.1-.2-.2-.4-.3z"/></svg>`
};
