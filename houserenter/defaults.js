// Defaults used to create settings.json / properties.json the first time an empty
// houserent folder is opened. Edit the real files (or use the Settings tab) afterwards.

export const DEFAULT_SETTINGS = {
  version: 2,
  landlord: {
    name: 'Shankar Sinha',
    addressLines: ['#H47, West By Lane, 12', 'Rajgarh Road, Guwahati', 'Assam - 781007'],
    phone: '9401036595'
  },
  propertyAddressLines: ['House No 47', 'West Bye Lane 12', 'Rajgarh Road', 'Guwahati, Assam'],
  invoice: {
    title: 'House Rent Invoice',
    prefix: 'HRC',
    numberFormat: '{prefix}-{seq}/{year}',
    seqDigits: 2,
    numbering: 'perProperty',
    dueDays: 2,
    rounding: 'nearest',
    fileNameFormat: '{mon} {year} - {tenant}'
  },
  rates: {
    electricityPerUnit: 9.95,
    waterPerLitre: 0.045
  },
  // Optional monthly charges offered to new properties (each can be switched on/off per invoice)
  defaultCharges: [
    { label: 'Electricity Meter Rent', amount: 5, on: true },
    { label: 'Trash', amount: 25, on: true },
    { label: 'WiFi', amount: 25, on: true }
  ],
  payment: {
    note: 'Payment to be made online to the following account',
    accountNo: '40657654867',
    bankName: 'State Bank of India',
    branch: 'Lachit Nagar Personal Banking Branch',
    ifsc: 'SBIN0014255',
    upiId: '9401036595@sbi',
    showQr: true,
    qrUpiId: 'reachout.shankar@oksbi',
    qrPayeeName: 'Shankar Sinha',
    qrIncludeAmount: true
  },
  whatsapp: {
    countryCode: '91',
    message: 'Dear {tenant},\n\nYour house rent invoice {invoiceNo} for {period} is attached.\nTotal payable: Rs. {total}\nDue date: {dueDate}\n\nPay by UPI: {upi}\nor A/c {accountNo}, {bank}, IFSC {ifsc}\n\nThank you,\n{landlord}',
    receiptMessage: 'Dear {tenant},\n\nReceived Rs. {amount} on {date} by {mode}{reference} towards invoice {invoiceNo} ({period}).\nBalance due: Rs. {balance}\n\nThank you,\n{landlord}'
  },
  paymentModes: ['UPI', 'Bank transfer', 'Cash', 'Cheque', 'Other'],
  theme: {
    accent: '#0F766E',
    soft: '#EDF5F4'
  }
};

export const DEFAULT_PROPERTIES = {
  version: 1,
  properties: [
    {
      id: 'p1',
      code: 'RC 1BH 1F',
      name: '1 BHK, First Floor',
      tenantName: 'Anthony Bannerjee',
      tenantPhone: '',
      addressLines: [],
      electricMeterNo: '423363',
      waterTankCapacity: 200,
      rent: 5500,
      electricityRate: null,
      waterRate: null,
      openingMeterReading: 2394,
      charges: [
        { label: 'Electricity Meter Rent', amount: 5, on: true },
        { label: 'Trash', amount: 25, on: true },
        { label: 'WiFi', amount: 25, on: true }
      ],
      enableElectricity: true,
      enableWater: true,
      active: true,
      notes: ''
    }
  ]
};

// History seeded from the sample PDF so the next bill picks up the last meter reading.
export const SAMPLE_INVOICES = {
  p1: {
    propertyId: 'p1',
    invoices: [
      {
        id: 'p1_2026-10', propertyId: 'p1', propertyCode: 'RC 1BH 1F',
        propertyAddressLines: ['House No 47', 'West Bye Lane 12', 'Rajgarh Road', 'Guwahati, Assam'],
        invoiceNo: 'HRC-09/2026', invoiceSeq: 9, invoiceDate: '2026-11-05', dueDate: '2026-11-07',
        billPeriod: '2026-10', billMonth: '2026-11',
        tenantName: 'Anthony Bannerjee', tenantPhone: '', electricMeterNo: '423363', waterTankCapacity: 200,
        rent: { qty: 1, rate: 5500, amount: 5500 },
        electricity: { previous: 2394, current: 2463, units: 69, rate: 9.95, amount: 686.55 },
        water: { capacity: 200, days: 31, units: 6200, rate: 0.045, amount: 279 },
        charges: [{ label: 'Electricity Meter Rent', amount: 5 }, { label: 'Others (Trash/WiFi)', amount: 50 }],
        adjustment: null,
        subtotal: 6520.55, roundOff: 0.45, total: 6521,
        amountInWords: 'Rupees Six Thousand Five Hundred Twenty One Only',
        createdAt: '2026-11-05T10:00:00.000Z', updatedAt: '2026-11-05T10:00:00.000Z',
        pdfFile: 'pdf/p1/Oct 2026 - Anthony Bannerjee.pdf'
      }
    ]
  }
};
