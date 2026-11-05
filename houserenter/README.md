# Rent Invoices (PWA)

Generates house-rent invoice PDFs in the same layout as your sample, keeps every invoice per property, and sends them on WhatsApp. Works offline once installed.

## Files

```
index.html  styles.css  app.js  storage.js  pdf.js  util.js  defaults.js
sw.js  manifest.webmanifest  icons/  lib/ (jsPDF, QR generator — bundled, no internet needed)
houserent/                      ← sample data folder
  settings.json                 landlord, bank/UPI, rates, invoice numbering, WhatsApp message, PDF colours
  properties.json               property list (code, tenant, phone, rent, meter no., tank size, optional charges…)
  invoices/<propertyId>.json    every saved invoice for that property (created by the app)
  payments/<propertyId>.json    every payment received: date, amount, mode, transaction ID/UTR, note
  pdf/<propertyId>/*.pdf        saved PDFs (created by the app)
```

## Put it online (needed to install as an app)

A PWA must be served over HTTPS. Easiest options:

- **Netlify Drop** – go to app.netlify.com/drop and drag this whole folder in. You get an https link.
- **GitHub Pages** – push the folder to a repo, Settings → Pages → deploy from branch.

Open the link, then use **Install app** (desktop Chrome/Edge) or the browser menu → **Add to Home screen** (Android/iPhone).
For a quick local test: `python3 -m http.server 8080` in this folder and open http://localhost:8080.

## The `houserent` folder

- **Computer (Chrome / Edge):** on first launch tap **Choose folder…** and select your `houserent` folder (copy the sample one from this zip, e.g. into Documents). If you pick a different folder, a `houserent` sub-folder is created inside it. The app remembers it; after a browser restart it may ask you to tap **Reconnect** once.
- **Phone / Safari / Firefox:** browsers there can’t open disk folders, so choose **Use on-device storage** — a private `houserent` store inside the app with the same files. Use **Settings → Import JSON** to load `settings.json` / `properties.json` (or a backup), and **Backup** to save everything as one JSON file.
- If `settings.json` / `properties.json` are missing, the app creates them from the sample defaults.

## Monthly use

1. **Invoice** tab → pick the property. The bill period defaults to the next unbilled month; previous meter reading, rates, rent and charges are loaded from the last invoice and the property.
2. Enter the current meter reading. Water = tank capacity × days (days default to the days in the month) = litres × rate per litre.
   Optional charges (meter rent, trash, WiFi, …) have a tick box — untick any that don't apply this month.
3. **Save & send on WhatsApp** – on Android/iPhone (and Windows/ChromeOS Chrome) the share sheet opens with the PDF; pick WhatsApp and the tenant. Where file sharing isn’t available, the PDF downloads and WhatsApp opens the tenant’s chat with the message filled in.
4. **History** tab – reopen/edit, view PDF, resend, record a payment, delete.
5. **Payments** tab – every payment received, with WhatsApp receipt. An invoice shows Unpaid / Due ₹x (part-paid) / Paid from its recorded payments. Choosing a month that already has an invoice loads it for editing.

## Notes

- Total is rounded to the nearest rupee (6520.55 → 6521, as in your sample). Change under Settings → Invoice.
- Invoice numbers run per property per year (`HRC-09/2026`, `HRC-10/2026`…). Switch to one global sequence in Settings, or type any number by hand.
- The QR code is a UPI payment code with the bill amount pre-filled (uses `qrUpiId` from settings).
- Each saved invoice stores a copy of the bank/landlord details used, so old PDFs regenerate unchanged after you edit settings.
