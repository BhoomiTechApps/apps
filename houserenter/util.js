// Shared helpers: dates, money, words, calculations.
export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export const pad = (n, l = 2) => String(n).padStart(l, '0');
export const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
export const r2 = x => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
export const money = n => Number(n || 0).toFixed(2);
export const inr = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const clone = o => JSON.parse(JSON.stringify(o));
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- dates (ISO yyyy-mm-dd, months yyyy-mm) ----
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const isoToday = () => isoOf(new Date());
export const ymNow = () => isoToday().slice(0, 7);
export function addDays(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + Number(n || 0)); return isoOf(d); }
export function shiftYm(ym, k) { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
export const nextYm = ym => shiftYm(ym, 1);
export const prevYm = ym => shiftYm(ym, -1);
const ymp = ym => { const [y, m] = String(ym).split('-').map(Number); return { y, m }; };
export const monthLong = ym => { const { y, m } = ymp(ym); return `${MONTHS[m - 1]} ${y}`; };
export const monthShort = ym => { const { y, m } = ymp(ym); return `${MONTHS[m - 1].slice(0, 3)} ${y}`; };
export const monthDash = ym => { const { y, m } = ymp(ym); return `${MONTHS[m - 1].slice(0, 3)}-${y}`; };
export const daysInMonth = ym => { const { y, m } = ymp(ym); return new Date(y, m, 0).getDate(); };
export const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

// Replace {placeholders}
export const fill = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

// ---- amount in words (Indian numbering) ----
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = n => n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
const three = n => [Math.floor(n / 100) ? ONES[Math.floor(n / 100)] + ' Hundred' : '', n % 100 ? two(n % 100) : ''].filter(Boolean).join(' ');
function words(n) {
  if (n === 0) return 'Zero';
  const out = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const th = Math.floor(n / 1e3); n %= 1e3;
  if (crore) out.push(words(crore) + ' Crore');
  if (lakh) out.push(two(lakh) + ' Lakh');
  if (th) out.push(two(th) + ' Thousand');
  if (n) out.push(three(n));
  return out.join(' ');
}
export function amountInWords(amount) {
  const neg = amount < 0; amount = Math.abs(amount);
  const rupees = Math.floor(amount + 1e-9);
  const paise = Math.round((amount - rupees) * 100);
  let s = (neg ? 'Minus ' : '') + 'Rupees ' + words(rupees);
  if (paise) s += ' and ' + two(paise) + ' Paise';
  return s + ' Only';
}

// ---- invoice calculation ----
// f = form values, p = property, s = settings
export function compute(f, p, s) {
  const errors = [], warnings = [];
  const elecOn = p.enableElectricity !== false;
  const waterOn = p.enableWater !== false;
  const rent = num(f.rent);
  const rentAmt = r2(rent);

  let electricity = null;
  if (elecOn) {
    const previous = num(f.elecPrev), current = num(f.elecCur), rate = num(f.elecRate);
    let units = r2(current - previous);
    if (String(f.elecCur ?? '').trim() === '') errors.push('Enter the current electricity meter reading.');
    else if (units < 0) errors.push('Current meter reading is lower than the previous reading.');
    units = Math.max(0, units);
    electricity = { previous, current, units, rate, amount: r2(units * rate) };
  }
  // Water: tank capacity (litres) x days = total litres, x rate per litre
  let water = null;
  if (waterOn) {
    const capacity = num(f.waterCap), days = num(f.waterDays), rate = num(f.waterRate);
    if (!capacity) errors.push('Enter the water tank capacity.');
    if (String(f.waterDays ?? '').trim() === '') errors.push('Enter the number of days for water.');
    const units = r2(capacity * days);
    water = { capacity, days, units, rate, amount: r2(units * rate) };
  }

  // Optional charges (meter rent, trash, WiFi…): only those switched on for this invoice
  const charges = (f.charges || [])
    .filter(c => c.on !== false && (String(c.label || '').trim() || num(c.amount)))
    .map(c => ({ label: String(c.label || 'Other').trim(), amount: r2(num(c.amount)) }));
  const adjustment = num(f.adjAmount) ? { label: String(f.adjLabel || '').trim() || 'Adjustment', amount: r2(num(f.adjAmount)) } : null;

  const subtotal = r2(rentAmt + (electricity?.amount || 0) + (water?.amount || 0)
    + charges.reduce((a, c) => a + c.amount, 0) + (adjustment?.amount || 0));
  const mode = s?.invoice?.rounding || 'nearest';
  const total = mode === 'nearest' ? Math.round(subtotal) : mode === 'up' ? Math.ceil(subtotal - 1e-9) : subtotal;
  if (!f.invoiceNo) errors.push('Invoice number is empty.');
  if (!f.billPeriod) errors.push('Choose a bill period.');

  return { rent, rentAmt, electricity, water, charges, adjustment, subtotal,
    total: r2(total), roundOff: r2(total - subtotal), amountInWords: amountInWords(r2(total)), errors, warnings };
}
