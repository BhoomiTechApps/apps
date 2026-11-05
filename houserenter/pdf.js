// Builds the invoice PDF (A4 portrait) with jsPDF — light, modern layout.
import { money, inr, fmtDate, monthLong, monthShort, amountInWords, fill, MONTHS } from './util.js';

const PW = 210, PH = 297, M = 16, R = PW - M;
const C = { ink: '#1F2937', muted: '#6B7280', faint: '#9CA3AF', line: '#E5E7EB', card: '#F6F7F9', white: '#FFFFFF' };
// table columns (mm)
const COL = { n: M + 5, desc: M + 13, units: 132, rate: 160, amount: R - 4 };

const fmtRate = v => (v === '' || v == null ? '' : String(+Number(v).toFixed(4)));
const rs = v => 'Rs. ' + inr(v);

function lineItems(rec) {
  const items = [];
  const per = monthShort(rec.billPeriod);
  items.push({ title: 'House Rent', detail: `Monthly rent for ${per}`, units: String(rec.rent?.qty ?? 1), rate: inr(rec.rent?.rate), amount: rec.rent?.amount });
  if (rec.electricity) {
    const e = rec.electricity;
    items.push({ title: 'Electricity Charges', detail: `Meter ${rec.electricMeterNo || '-'}  ·  Previous ${e.previous}  ·  Current ${e.current}`,
      units: `${e.units}`, rate: fmtRate(e.rate), amount: e.amount });
  }
  if (rec.meterRent) items.push({ title: 'Electricity Meter Rent', detail: '', units: '', rate: '', amount: rec.meterRent }); // older records
  if (rec.water) {
    const w = rec.water, cap = w.capacity ?? rec.waterTankCapacity;
    const d = w.days != null ? `${cap} Ltr tank × ${w.days} days = ${w.units} litres`
      : w.fills != null ? `${w.fills} tank fills × ${cap || ''} Ltr` : '';
    items.push({ title: 'Water Charges', detail: d, units: `${w.units}`, rate: fmtRate(w.rate), amount: w.amount });
  }
  for (const c of rec.charges || []) items.push({ title: c.label, detail: '', units: '', rate: '', amount: c.amount });
  if (rec.adjustment) items.push({ title: rec.adjustment.label, detail: rec.adjustment.amount < 0 ? 'Credit' : '', units: '', rate: '', amount: rec.adjustment.amount });
  return items;
}

export function upiLink(rec, settings) {
  const p = rec.issuer?.payment || settings.payment || {};
  const id = p.qrUpiId || p.upiId;
  if (!id) return '';
  const q = [`pa=${encodeURIComponent(id)}`];
  if (p.qrPayeeName) q.push(`pn=${encodeURIComponent(p.qrPayeeName)}`);
  if (p.qrIncludeAmount !== false) q.push(`am=${money(rec.total)}`);
  q.push('cu=INR');
  q.push(`tn=${encodeURIComponent(`Rent ${monthShort(rec.billPeriod)} ${rec.invoiceNo}`)}`);
  return `upi://pay?${q.join('&')}`;
}

export function invoiceFileName(rec, settings) {
  const [y, m] = rec.billPeriod.split('-').map(Number);
  const name = fill(settings.invoice?.fileNameFormat || '{mon} {year} - {tenant}', {
    mon: MONTHS[m - 1].slice(0, 3), month: MONTHS[m - 1], year: y, tenant: rec.tenantName || '',
    code: rec.propertyCode || '', invoiceNo: rec.invoiceNo || ''
  });
  return name.replace(/[\\/:*?"<>|%]+/g, '-').replace(/\s+/g, ' ').trim() + '.pdf';
}

// Mix a hex colour with white (t = 0..1 share of the colour)
function tint(hex, t) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const ch = s => Math.round(255 - (255 - ((n >> s) & 255)) * t);
  return '#' + [16, 8, 0].map(s => ch(s).toString(16).padStart(2, '0')).join('');
}

export function buildInvoicePdf(rec, settings) {
  const { jsPDF } = window.jspdf;
  const landlord = rec.issuer?.landlord || settings.landlord || {};
  const pay = rec.issuer?.payment || settings.payment || {};
  const accent = settings.theme?.accent || '#0F766E';
  const soft = settings.theme?.soft || tint(accent, 0.08);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: `${rec.invoiceNo} ${rec.tenantName}`, author: landlord.name || '', subject: 'House Rent Invoice' });
  doc.setLineHeightFactor(1.3);

  const T = (s, x, y, o = {}) => {
    let size = o.size || 10;
    doc.setFont('helvetica', o.style || 'normal');
    doc.setFontSize(size);
    doc.setTextColor(o.color || C.ink);
    s = String(s ?? '');
    if (o.maxW) while (doc.getTextWidth(s) > o.maxW && size > 6) { size -= 0.25; doc.setFontSize(size); }
    doc.text(s, x, y, { align: o.align || 'left', baseline: o.baseline || 'alphabetic', charSpace: o.cs || 0 });
  };
  const label = (s, x, y, o = {}) => T(s.toUpperCase(), x, y, { size: 7, style: 'bold', color: o.color || C.faint, cs: 0.35, align: o.align });
  const rule = (x1, y, x2, color = C.line, w = 0.25) => { doc.setDrawColor(color); doc.setLineWidth(w); doc.line(x1, y, x2, y); };
  const card = (x, y, w, h, fillC = C.card) => { doc.setFillColor(fillC); doc.roundedRect(x, y, w, h, 2.5, 2.5, 'F'); };

  // ---- Header -------------------------------------------------------------
  doc.setFillColor(accent); doc.rect(0, 0, PW, 3, 'F');
  T(landlord.name || '', M, 21, { size: 17, style: 'bold', maxW: 105 });
  let ly = 27.5;
  for (const ln of landlord.addressLines || []) { T(ln, M, ly, { size: 9, color: C.muted, maxW: 105 }); ly += 4.4; }
  if (landlord.phone) T(`Phone: ${landlord.phone}`, M, ly, { size: 9, color: C.muted });

  T(settings.invoice?.title || 'House Rent Invoice', R, 21, { size: 15, style: 'bold', color: accent, align: 'right', maxW: 80 });
  const meta = [['Invoice No.', rec.invoiceNo], ['Invoice Date', fmtDate(rec.invoiceDate)], ['Due Date', fmtDate(rec.dueDate)]];
  meta.forEach(([k, v], i) => {
    const y = 28 + i * 5.2;
    T(k, R - 30, y, { size: 8.5, color: C.muted, align: 'right' });
    T(v, R, y, { size: 9.5, style: 'bold', align: 'right', maxW: 28 });
  });

  // ---- Billed to / details cards -------------------------------------------
  const cy = 50, ch = 38, cw = (R - M - 6) / 2;
  card(M, cy, cw, ch);
  label('Billed to', M + 5, cy + 7);
  T(rec.tenantName, M + 5, cy + 14, { size: 13, style: 'bold', maxW: cw - 10 });
  T(rec.propertyCode ? `Unit ${rec.propertyCode}` : '', M + 5, cy + 19.5, { size: 9, style: 'bold', color: accent, maxW: cw - 10 });
  const addr = (rec.propertyAddressLines?.length ? rec.propertyAddressLines : settings.propertyAddressLines) || [];
  T(addr.slice(0, 2).join(', '), M + 5, cy + 25, { size: 8.5, color: C.muted, maxW: cw - 10 });
  T(addr.slice(2, 4).join(', '), M + 5, cy + 29.4, { size: 8.5, color: C.muted, maxW: cw - 10 });

  const rx = M + cw + 6;
  card(rx, cy, cw, ch);
  label('Billing details', rx + 5, cy + 7);
  const det = [['Bill period', monthLong(rec.billPeriod)], ['Bill month', monthLong(rec.billMonth)],
    ['Electric meter', rec.electricMeterNo || '-'], ['Water tank', rec.waterTankCapacity ? `${rec.waterTankCapacity} Ltr` : '-']];
  det.forEach(([k, v], i) => {
    const y = cy + 14 + i * 6;
    T(k, rx + 5, y, { size: 9, color: C.muted });
    T(v, rx + cw - 5, y, { size: 9.5, style: 'bold', align: 'right', maxW: cw - 35 });
  });

  // ---- Line items -----------------------------------------------------------
  let y = cy + ch + 9;
  doc.setFillColor(soft); doc.roundedRect(M, y, R - M, 9, 1.8, 1.8, 'F');
  const hy = y + 5.8;
  label('#', COL.n, hy, { color: accent, align: 'center' });
  label('Description', COL.desc, hy, { color: accent });
  label('Units / Ltr', COL.units, hy, { color: accent, align: 'right' });
  label('Rate', COL.rate, hy, { color: accent, align: 'right' });
  label('Amount', COL.amount, hy, { color: accent, align: 'right' });
  y += 9;

  lineItems(rec).forEach((it, i) => {
    const h = it.detail ? 13 : 9.5;
    const ty = y + (it.detail ? 6 : 6.1);
    T(String(i + 1), COL.n, ty, { size: 9, color: C.faint, align: 'center' });
    T(it.title, COL.desc, ty, { size: 10, style: 'bold', maxW: COL.units - COL.desc - 22 });
    if (it.detail) T(it.detail, COL.desc, ty + 4.6, { size: 8, color: C.muted, maxW: COL.units - COL.desc - 4 });
    T(it.units, COL.units, ty, { size: 9.5, align: 'right' });
    T(it.rate, COL.rate, ty, { size: 9.5, color: C.muted, align: 'right' });
    T(inr(it.amount), COL.amount, ty, { size: 10, style: 'bold', align: 'right' });
    y += h;
    rule(M, y, R);
  });

  // ---- Totals ---------------------------------------------------------------
  y += 6;
  const tx = 118;
  const totals = [['Subtotal', inr(rec.subtotal)]];
  if (rec.roundOff) totals.push(['Round off', (rec.roundOff > 0 ? '+' : '') + money(rec.roundOff)]);
  totals.forEach(([k, v]) => { T(k, tx + 4, y + 4, { size: 9.5, color: C.muted }); T(v, COL.amount, y + 4, { size: 9.5, align: 'right' }); y += 6.5; });
  doc.setFillColor(accent); doc.roundedRect(tx, y, R - tx, 13, 2.5, 2.5, 'F');
  T('Total Payable', tx + 4, y + 8.3, { size: 10.5, style: 'bold', color: C.white });
  T(rs(rec.total), COL.amount, y + 8.6, { size: 14, style: 'bold', color: C.white, align: 'right', maxW: 45 });

  // amount in words (left of totals)
  const wy = y - (totals.length * 6.5) + 1;
  label('Amount in words', M, wy);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  const words = doc.splitTextToSize(rec.amountInWords || amountInWords(rec.total), tx - M - 8);
  words.slice(0, 3).forEach((ln, i) => T(ln, M, wy + 5.5 + i * 4.6, { size: 9.5, style: 'bold' }));
  y += 13;

  // ---- Payment ---------------------------------------------------------------
  y += 10;
  const link = pay.showQr !== false ? upiLink(rec, settings) : '';
  const ph = 52;
  card(M, y, R - M, ph);
  label('Payment details', M + 6, y + 8);
  if (pay.note) T(pay.note, M + 6, y + 13.5, { size: 8.5, color: C.muted, maxW: link ? 115 : 165 });
  const bank = [['Account No.', pay.accountNo], ['Bank', pay.bankName], ['Branch', pay.branch], ['IFSC', pay.ifsc], ['UPI ID', pay.upiId]].filter(r => r[1]);
  bank.forEach(([k, v], i) => {
    const by = y + 21 + i * 6;
    T(k, M + 6, by, { size: 9, color: C.muted });
    T(v, M + 34, by, { size: 9.5, style: k === 'Account No.' || k === 'IFSC' ? 'bold' : 'normal', maxW: link ? 90 : 135 });
  });

  if (link && window.qrcode) {
    const qs = 36, qx = R - 6 - qs - 2, qy = y + 5;
    doc.setFillColor(C.white); doc.roundedRect(qx - 2, qy - 2, qs + 4, qs + 4, 2, 2, 'F');
    const qr = window.qrcode(0, 'M'); qr.addData(link); qr.make();
    const n = qr.getModuleCount(), c = qs / n;
    doc.setFillColor(C.ink);
    for (let r = 0; r < n; r++) {
      let run = -1;
      for (let k = 0; k <= n; k++) {
        const dark = k < n && qr.isDark(r, k);
        if (dark && run < 0) run = k;
        if (!dark && run >= 0) { doc.rect(qx + run * c, qy + r * c, (k - run) * c + 0.02, c + 0.02, 'F'); run = -1; }
      }
    }
    const cx = qx + qs / 2;
    T(pay.qrIncludeAmount !== false ? `Scan to pay ${rs(rec.total)}` : 'Scan to pay by UPI', cx, qy + qs + 6, { size: 8.5, style: 'bold', color: accent, align: 'center', maxW: 52 });
    T(pay.qrUpiId || pay.upiId, cx, qy + qs + 9.8, { size: 7, color: C.muted, align: 'center', maxW: 52 });
  }

  // ---- Footer ---------------------------------------------------------------
  const fy = PH - 18;
  rule(M, fy, R);
  T('Thank you!', M, fy + 6, { size: 10, style: 'bold' });
  T(`Please pay by ${fmtDate(rec.dueDate)} and quote ${rec.invoiceNo} with the payment.`, M, fy + 10.5, { size: 8.5, color: C.muted });
  T([landlord.name, landlord.phone].filter(Boolean).join('  ·  '), R, fy + 6, { size: 8.5, color: C.muted, align: 'right' });
  T('Computer-generated invoice; no signature required.', R, fy + 10.5, { size: 7.5, color: C.faint, align: 'right' });

  return doc;
}
