import React, { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard, BookOpen, Users, Truck, Package, ShoppingCart, FileText,
  ClipboardList, PieChart, Settings as SettingsIcon, Plus, Trash2, Pencil,
  X, Search, AlertTriangle, TrendingUp, TrendingDown, Wallet, Landmark,
  ChevronDown, ChevronRight, Check, Printer, ArrowUpRight, ArrowDownRight,
  Loader2, Banknote, Menu, CheckCircle2, XCircle, Bell, Repeat, Sparkles, Award
} from 'lucide-react';

/* ============================== CONSTANTS ============================== */

const STORAGE_KEYS = {
  settings: 'settings',
  accounts: 'accounts',
  customers: 'customers',
  suppliers: 'suppliers',
  products: 'products',
  sales: 'sales-invoices',
  purchases: 'purchase-invoices',
  expenses: 'expenses',
  journal: 'journal-entries',
  reps: 'reps',
  recurring: 'recurring-templates',
};

const DEFAULT_SETTINGS = {
  companyName: 'منشأتي التجارية',
  currency: 'ر.س',
  taxRate: 15,
  nextSalesNo: 1,
  nextPurchaseNo: 1,
  nextJournalNo: 1,
  nextExpenseNo: 1,
  nextRepNo: 1,
  // VIP program
  vipEnabled: true,
  vipMonthlyThreshold: 1000000,
  vipDiscountPercent: 0.5,
  // credit terms / collections
  defaultPaymentTermsDays: 30,
  reminderBeforeDays: 7,
  overdueBlockThresholdDays: 15, // an invoice overdue by more than this counts against the customer's credit score
  overdueBlockCount: 2, // this many currently-overdue invoices => credit blocked
  // distributor commission
  defaultCommissionPercent: 2,
};


// kind identifies the accounting role an account plays in automatic postings
const DEFAULT_ACCOUNTS = [
  { id: 'acc_cash', code: '1000', name: 'الصندوق (نقدية)', type: 'asset', kind: 'cash', system: true },
  { id: 'acc_bank', code: '1010', name: 'البنك', type: 'asset', kind: 'bank', system: true },
  { id: 'acc_ar', code: '1100', name: 'العملاء (ذمم مدينة)', type: 'asset', kind: 'ar', system: true },
  { id: 'acc_inventory', code: '1200', name: 'المخزون', type: 'asset', kind: 'inventory', system: true },
  { id: 'acc_vat_in', code: '1300', name: 'ضريبة القيمة المضافة - مشتريات', type: 'asset', kind: 'vat_in', system: true },
  { id: 'acc_ap', code: '2000', name: 'الموردون (ذمم دائنة)', type: 'liability', kind: 'ap', system: true },
  { id: 'acc_vat_out', code: '2100', name: 'ضريبة القيمة المضافة - مبيعات', type: 'liability', kind: 'vat_out', system: true },
  { id: 'acc_capital', code: '3000', name: 'رأس المال', type: 'equity', kind: 'capital', system: true },
  { id: 'acc_retained', code: '3100', name: 'الأرباح المرحلة', type: 'equity', kind: 'retained', system: true },
  { id: 'acc_sales', code: '4000', name: 'إيرادات المبيعات', type: 'revenue', kind: 'sales_revenue', system: true },
  { id: 'acc_cogs', code: '5000', name: 'تكلفة البضاعة المباعة', type: 'expense', kind: 'cogs', system: true },
  { id: 'acc_exp_rent', code: '5100', name: 'مصاريف إيجار', type: 'expense', kind: 'expense', system: false },
  { id: 'acc_exp_salaries', code: '5200', name: 'مصاريف رواتب', type: 'expense', kind: 'expense', system: false },
  { id: 'acc_exp_utilities', code: '5300', name: 'مصاريف كهرباء وماء', type: 'expense', kind: 'expense', system: false },
  { id: 'acc_exp_general', code: '5400', name: 'مصاريف عامة وإدارية', type: 'expense', kind: 'expense', system: false },
];

const ACCOUNT_TYPE_LABELS = {
  asset: 'أصول',
  liability: 'خصوم',
  equity: 'حقوق ملكية',
  revenue: 'إيرادات',
  expense: 'مصاريف',
};

const ACCOUNT_TYPE_ORDER = ['asset', 'liability', 'equity', 'revenue', 'expense'];

const PAYMENT_METHOD_LABELS = { cash: 'نقدي', bank: 'بنك', credit: 'آجل' };

const UNITS = ['قطعة', 'كرتون', 'كيلوجرام', 'لتر', 'متر', 'علبة', 'صندوق'];

/* ================================ HELPERS ================================ */

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function fmtNum(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pad(n, len) {
  return String(n).padStart(len, '0');
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function classNames(...args) {
  return args.filter(Boolean).join(' ');
}

/* Natural balance sign per account type: for asset/expense debit is positive;
   for liability/equity/revenue credit is positive. */
function accountBalance(account, journalEntries) {
  let debit = 0, credit = 0;
  for (const je of journalEntries) {
    for (const line of je.lines) {
      if (line.accountId === account.id) {
        debit += Number(line.debit) || 0;
        credit += Number(line.credit) || 0;
      }
    }
  }
  const natural = (account.type === 'asset' || account.type === 'expense') ? (debit - credit) : (credit - debit);
  return { debit, credit, balance: natural };
}

function filterEntriesByDate(journalEntries, from, to) {
  return journalEntries.filter(je => {
    if (from && je.date < from) return false;
    if (to && je.date > to) return false;
    return true;
  });
}

/* ============================ DATE MATH ============================ */

function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(iso, months) {
  const d = new Date(iso + 'T00:00:00');
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function daysDiff(fromISO, toISO) {
  const a = new Date(fromISO + 'T00:00:00');
  const b = new Date(toISO + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

/* ============================ VIP TIER ============================ */

// Total credit-worthy sales for a customer within the trailing `days` window
// (used to decide automatic VIP promotion).
function customerTrailingSales(customerId, salesInvoices, today, days = 30) {
  const since = addDays(today, -days);
  return salesInvoices
    .filter(inv => inv.customerId === customerId && inv.date >= since && inv.date <= today)
    .reduce((s, inv) => s + inv.total, 0);
}

function computeCustomerTier(customer, salesInvoices, settings, today) {
  if (!settings.vipEnabled || !customer) return { tier: 'normal', trailingTotal: 0 };
  const trailingTotal = customerTrailingSales(customer.id, salesInvoices, today, 30);
  return { tier: trailingTotal >= settings.vipMonthlyThreshold ? 'vip' : 'normal', trailingTotal };
}

/* ============================ CREDIT RISK ============================ */

// Looks only at currently-unpaid invoices relative to today vs. their due date.
function computeCustomerRisk(customer, salesInvoices, settings, today) {
  if (!customer) return { level: 'excellent', overdueCount: 0, overdueAmount: 0, maxDaysOverdue: 0 };
  const overdue = salesInvoices.filter(inv => {
    if (inv.customerId !== customer.id) return false;
    const remaining = inv.total - inv.paidAmount;
    if (remaining <= 0.005) return false;
    if (!inv.dueDate) return false;
    return inv.dueDate < today;
  });
  const overdueAmount = overdue.reduce((s, inv) => s + (inv.total - inv.paidAmount), 0);
  const maxDaysOverdue = overdue.reduce((m, inv) => Math.max(m, daysDiff(inv.dueDate, today)), 0);
  let level = 'excellent';
  if (overdue.length >= settings.overdueBlockCount || maxDaysOverdue > settings.overdueBlockThresholdDays) {
    level = 'poor';
  } else if (overdue.length >= 1) {
    level = 'fair';
  }
  return { level, overdueCount: overdue.length, overdueAmount, maxDaysOverdue };
}

const RISK_LABELS = { excellent: 'ممتاز - يسدد بانتظام', fair: 'متوسط - تأخر بسيط', poor: 'ضعيف - آجل محظور' };

/* ============================ WHATSAPP REMINDERS ============================ */

function cleanPhoneForWhatsApp(phone) {
  return (phone || '').replace(/[^0-9]/g, '');
}

function buildWhatsAppLink(phone, message) {
  const digits = cleanPhoneForWhatsApp(phone);
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

// Determine what stage of collections reminder an unpaid invoice is at today.
function reminderStage(invoice, settings, today) {
  const remaining = invoice.total - invoice.paidAmount;
  if (remaining <= 0.005 || !invoice.dueDate) return null;
  const daysToDue = daysDiff(today, invoice.dueDate); // positive = due in future
  if (daysToDue < 0) return { stage: 'overdue', daysOverdue: -daysToDue };
  if (daysToDue === 0) return { stage: 'due_today', daysOverdue: 0 };
  if (daysToDue <= settings.reminderBeforeDays) return { stage: 'upcoming', daysOverdue: 0, daysToDue };
  return null;
}

function composeReminderMessage(stage, invoice, customer, companyName, currency) {
  const remaining = fmtNum(invoice.total - invoice.paidAmount);
  const name = customer ? customer.name : 'عميلنا العزيز';
  if (stage.stage === 'upcoming') {
    return `مرحبًا ${name}، تذكير لطيف بأن فاتورتكم رقم #${invoice.no} بمبلغ ${remaining} ${currency} لدى ${companyName} يستحق سدادها بتاريخ ${fmtDate(invoice.dueDate)}. نشكر لكم حسن التعامل ونتطلع لتسديدها في موعدها. 🌿`;
  }
  if (stage.stage === 'due_today') {
    return `مرحبًا ${name}، نود تذكيركم بأن فاتورتكم رقم #${invoice.no} بمبلغ ${remaining} ${currency} لدى ${companyName} تستحق السداد اليوم. نرجو التكرم بالسداد في أقرب وقت ممكن لتفادي أي تأخير. شكرًا لتعاونكم.`;
  }
  return `السيد/ة ${name}، نحيطكم علمًا بأن فاتورتكم رقم #${invoice.no} بمبلغ ${remaining} ${currency} لدى ${companyName} متأخرة السداد منذ ${stage.daysOverdue} يومًا عن تاريخ الاستحقاق (${fmtDate(invoice.dueDate)}). نأمل تسوية المبلغ خلال 3 أيام عمل تجنبًا لاتخاذ الإجراءات القانونية اللازمة لتحصيل الحقوق.`;
}

/* ============================ DEMAND FORECAST ============================ */

// Average weekly sales velocity per product over the trailing `days` window,
// with a simple reorder suggestion for the coming week.
function computeForecast(products, salesInvoices, today, days = 90) {
  const since = addDays(today, -days);
  const weeks = days / 7;
  const soldQty = {};
  salesInvoices.forEach(inv => {
    if (inv.date < since || inv.date > today) return;
    inv.items.forEach(it => {
      if (!it.productId) return;
      soldQty[it.productId] = (soldQty[it.productId] || 0) + Number(it.qty);
    });
  });
  return products.map(p => {
    const totalSold = soldQty[p.id] || 0;
    const weeklyAvg = totalSold / weeks;
    const coverageWeeks = weeklyAvg > 0 ? Number(p.qty) / weeklyAvg : Infinity;
    const suggestedOrder = weeklyAvg > 0 ? Math.max(0, Math.ceil(weeklyAvg * 2 - Number(p.qty))) : 0;
    return { product: p, totalSold, weeklyAvg, coverageWeeks, suggestedOrder };
  }).filter(f => f.totalSold > 0).sort((a, b) => a.coverageWeeks - b.coverageWeeks);
}

/* ============================ RECURRING INVOICES ENGINE ============================
   Runs once when the app loads: generates any sales invoices that have come due
   for active recurring templates, advancing each template's next run date.
   Written as a standalone function (not a hook) so it can run once against the
   freshly-loaded data before React state settles. */

function runRecurringInvoices({ recurringTemplates, salesInvoices, products, accounts, journalEntries, settings, reps, today }) {
  let nextSalesNo = settings.nextSalesNo;
  let nextJournalNo = settings.nextJournalNo;
  const newSales = [...salesInvoices];
  const newJournal = [...journalEntries];
  let workingProducts = products.map(p => ({ ...p }));
  let generatedCount = 0;

  const nextTemplates = recurringTemplates.map(tpl => {
    if (!tpl.active) return tpl;
    let nextRunDate = tpl.nextRunDate;
    let guard = 0;
    while (nextRunDate <= today && guard < 24) {
      guard++;
      const totals = computeInvoiceTotals(tpl.items, tpl.discount || 0, tpl.applyTax, settings.taxRate);
      const no = nextSalesNo;
      const invId = uid('sinv');
      const jeNo = nextJournalNo;

      const lines = [];
      if (tpl.paymentMethod === 'credit') {
        lines.push({ accountId: getAccountByKind(accounts, 'ar').id, debit: totals.total, credit: 0 });
      } else {
        lines.push({ accountId: getCashLikeAccountId(accounts, tpl.paymentMethod), debit: totals.total, credit: 0 });
      }
      lines.push({ accountId: getAccountByKind(accounts, 'sales_revenue').id, debit: 0, credit: totals.afterDiscount });
      if (totals.tax > 0) lines.push({ accountId: getAccountByKind(accounts, 'vat_out').id, debit: 0, credit: totals.tax });
      if (totals.cost > 0) {
        lines.push({ accountId: getAccountByKind(accounts, 'cogs').id, debit: totals.cost, credit: 0 });
        lines.push({ accountId: getAccountByKind(accounts, 'inventory').id, debit: 0, credit: totals.cost });
      }
      const je = makeEntry(jeNo, nextRunDate, `فاتورة دورية #${no} (${tpl.name || 'اشتراك متكرر'})`, lines, 'sales', invId);

      const rep = tpl.repId ? reps.find(r => r.id === tpl.repId) : null;
      const commissionAmount = rep ? totals.afterDiscount * (Number(rep.commissionPercent) || 0) / 100 : 0;

      newSales.push({
        id: invId, no, date: nextRunDate, customerId: tpl.customerId, items: tpl.items,
        discount: tpl.discount || 0, subtotal: totals.subtotal, tax: totals.tax, total: totals.total,
        paymentMethod: tpl.paymentMethod, paidAmount: tpl.paymentMethod === 'credit' ? 0 : totals.total,
        journalId: je.id, dueDate: addDays(nextRunDate, settings.defaultPaymentTermsDays),
        repId: tpl.repId || null, commissionAmount, isVipSale: false, isRecurring: true,
      });
      newJournal.push(je);

      workingProducts = workingProducts.map(p => {
        const item = tpl.items.find(it => it.productId === p.id);
        return item ? { ...p, qty: Number(p.qty) - Number(item.qty) } : p;
      });

      nextSalesNo += 1;
      nextJournalNo += 1;
      generatedCount += 1;
      nextRunDate = tpl.frequency === 'weekly' ? addDays(nextRunDate, 7) : addMonths(nextRunDate, 1);
    }
    return { ...tpl, nextRunDate };
  });

  return {
    recurringTemplates: nextTemplates,
    salesInvoices: newSales,
    products: workingProducts,
    journalEntries: newJournal,
    settings: { ...settings, nextSalesNo, nextJournalNo },
    generatedCount,
  };
}

/* ============================ STORAGE HELPERS ============================
   Standalone build: uses the browser's localStorage (available natively in
   both the Electron shell and the Capacitor WebView), namespaced so it
   never collides with anything else running on the same origin. */

const STORAGE_PREFIX = 'acct_';

async function loadKey(key, fallback) {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (raw !== null) return JSON.parse(raw);
    return fallback;
  } catch (e) {
    return fallback;
  }
}

async function saveKey(key, value) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

/* ============================ JOURNAL BUILDER ============================ */

function makeEntry(no, date, description, lines, sourceType, sourceId) {
  // lines: [{accountId, debit, credit}]
  const cleanLines = lines
    .filter(l => (Number(l.debit) || 0) !== 0 || (Number(l.credit) || 0) !== 0)
    .map(l => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 }));
  return {
    id: uid('je'),
    no,
    date,
    description,
    lines: cleanLines,
    sourceType: sourceType || 'manual',
    sourceId: sourceId || null,
  };
}

function isBalanced(lines) {
  const d = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const c = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  return Math.abs(d - c) < 0.005;
}

/* ============================ INVOICE MATH ============================ */

function computeInvoiceTotals(items, discount, applyTax, taxRate) {
  const subtotal = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
  const afterDiscount = Math.max(0, subtotal - (Number(discount) || 0));
  const tax = applyTax ? afterDiscount * (Number(taxRate) || 0) / 100 : 0;
  const total = afterDiscount + tax;
  const cost = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.cost) || 0), 0);
  return { subtotal, afterDiscount, tax, total, cost };
}

function getCashLikeAccountId(accounts, method) {
  const kind = method === 'bank' ? 'bank' : 'cash';
  const acc = accounts.find(a => a.kind === kind);
  return acc ? acc.id : null;
}

function getAccountByKind(accounts, kind) {
  return accounts.find(a => a.kind === kind) || null;
}

/* ============================== DESIGN ATOMS ============================== */


function Figure({ value, className = '', currency = '', tone }) {
  const toneClass = tone === 'pos' ? 'text-emerald-700' : tone === 'neg' ? 'text-rose-700' : '';
  return (
    <span dir="ltr" className={classNames('font-figures tabular-nums', toneClass, className)}>
      {fmtNum(value)}{currency ? ` ${currency}` : ''}
    </span>
  );
}

function Card({ children, className = '' }) {
  return (
    <div className={classNames('bg-white rounded-lg border border-stone-200 shadow-sm', className)}>
      {children}
    </div>
  );
}

function LedgerStatCard({ icon: Icon, label, value, currency, tone = 'neutral', sub }) {
  const iconBg = tone === 'pos' ? 'bg-emerald-100 text-emerald-700'
    : tone === 'neg' ? 'bg-rose-100 text-rose-700'
    : tone === 'warn' ? 'bg-amber-100 text-amber-700'
    : 'bg-stone-100 text-stone-600';
  return (
    <div className="ledger-card rounded-lg p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between">
        <span className="text-sm text-stone-500 font-body">{label}</span>
        <span className={classNames('p-1.5 rounded-md', iconBg)}><Icon size={16} /></span>
      </div>
      <Figure value={value} currency={currency} className="text-xl font-semibold text-stone-800" />
      {sub && <span className="text-xs text-stone-400 font-body">{sub}</span>}
    </div>
  );
}

function Button({ children, onClick, variant = 'primary', size = 'md', icon: Icon, type = 'button', disabled, className = '' }) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-md font-body font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const sizes = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : size === 'lg' ? 'px-5 py-2.5 text-base' : 'px-3.5 py-2 text-sm';
  const variants = {
    primary: 'bg-emerald-700 text-white hover:bg-emerald-800',
    secondary: 'bg-stone-100 text-stone-700 hover:bg-stone-200',
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
    ghost: 'bg-transparent text-stone-600 hover:bg-stone-100',
    outline: 'bg-white text-stone-700 border border-stone-300 hover:bg-stone-50',
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={classNames(base, sizes, variants[variant], className)}>
      {Icon && <Icon size={size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  );
}

function IconButton({ icon: Icon, onClick, title, variant = 'ghost', size = 16 }) {
  const variants = {
    ghost: 'text-stone-500 hover:bg-stone-100 hover:text-stone-800',
    danger: 'text-rose-500 hover:bg-rose-50 hover:text-rose-700',
  };
  return (
    <button type="button" onClick={onClick} title={title} className={classNames('p-1.5 rounded-md transition-colors', variants[variant])}>
      <Icon size={size} />
    </button>
  );
}

function Field({ label, children, required, hint }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-body">
      {label && <span className="text-stone-600">{label}{required && <span className="text-rose-500"> *</span>}</span>}
      {children}
      {hint && <span className="text-xs text-stone-400">{hint}</span>}
    </label>
  );
}

const inputBase = 'w-full rounded-md border border-stone-300 px-3 py-2 text-sm font-body focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-600';

function Input(props) {
  return <input {...props} className={classNames(inputBase, props.className)} />;
}
function Select({ children, ...props }) {
  return <select {...props} className={classNames(inputBase, 'bg-white', props.className)}>{children}</select>;
}
function Textarea(props) {
  return <textarea {...props} className={classNames(inputBase, props.className)} />;
}

function Badge({ children, tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-stone-100 text-stone-600',
    green: 'bg-emerald-100 text-emerald-700',
    red: 'bg-rose-100 text-rose-700',
    amber: 'bg-amber-100 text-amber-700',
    blue: 'bg-sky-100 text-sky-700',
  };
  return <span className={classNames('inline-block px-2 py-0.5 rounded-full text-xs font-body font-medium', tones[tone])}>{children}</span>;
}

function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      <span className="p-3 rounded-full bg-stone-100 text-stone-400"><Icon size={26} /></span>
      <p className="font-body text-stone-600 font-medium">{title}</p>
      {hint && <p className="font-body text-sm text-stone-400 max-w-xs">{hint}</p>}
      {action}
    </div>
  );
}

function Modal({ title, onClose, children, width = 'max-w-lg' }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(28,25,23,0.45)' }} onClick={onClose}>
      <div
        className={classNames('bg-white rounded-xl shadow-xl w-full overflow-y-auto', width)}
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 sticky top-0 bg-white z-10">
          <h3 className="font-display font-semibold text-stone-800">{title}</h3>
          <IconButton icon={X} onClick={onClose} title="إغلاق" />
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function ConfirmDialog({ title, message, onConfirm, onCancel }) {
  return (
    <Modal title={title} onClose={onCancel} width="max-w-sm">
      <p className="font-body text-sm text-stone-600 mb-5">{message}</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>إلغاء</Button>
        <Button variant="danger" onClick={onConfirm} icon={Trash2}>تأكيد الحذف</Button>
      </div>
    </Modal>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  const isErr = toast.type === 'error';
  return (
    <div className={classNames(
      'fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg font-body text-sm',
      isErr ? 'bg-rose-600 text-white' : 'bg-emerald-700 text-white'
    )}>
      {isErr ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
      {toast.message}
    </div>
  );
}

/* ============================== NAVIGATION ============================== */

const NAV_ITEMS = [
  { key: 'dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
  { key: 'accounts', label: 'دليل الحسابات', icon: BookOpen },
  { key: 'customers', label: 'العملاء', icon: Users },
  { key: 'suppliers', label: 'الموردون', icon: Truck },
  { key: 'products', label: 'المنتجات والمخزون', icon: Package },
  { key: 'sales', label: 'فواتير المبيعات', icon: ShoppingCart },
  { key: 'purchases', label: 'فواتير المشتريات', icon: FileText },
  { key: 'recurring', label: 'الفواتير الدورية', icon: Repeat },
  { key: 'reminders', label: 'تذكيرات التحصيل', icon: Bell },
  { key: 'forecast', label: 'التنبؤ بالطلب', icon: Sparkles },
  { key: 'reps', label: 'المندوبون والعمولات', icon: Award },
  { key: 'expenses', label: 'المصاريف', icon: Wallet },
  { key: 'journal', label: 'القيود اليومية', icon: ClipboardList },
  { key: 'reports', label: 'التقارير المالية', icon: PieChart },
  { key: 'settings', label: 'الإعدادات', icon: SettingsIcon },
];

function Sidebar({ active, onNavigate, companyName, mobileOpen, setMobileOpen }) {
  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-30 md:hidden" style={{ backgroundColor: 'rgba(28,25,23,0.45)' }} onClick={() => setMobileOpen(false)} />
      )}
      <aside className={classNames(
        'text-stone-200 w-64 shrink-0 flex flex-col fixed md:sticky top-0 h-screen z-40 transition-transform',
        mobileOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'
      )} style={{ insetInlineStart: 0, backgroundColor: '#16241D' }}>
        <div className="px-5 py-5 border-b border-stone-700 flex items-center gap-2">
          <span className="p-2 rounded-lg bg-emerald-700"><Banknote size={20} /></span>
          <div className="min-w-0">
            <p className="font-display font-bold text-white text-sm truncate">{companyName}</p>
            <p className="text-xs text-stone-400 font-body">نظام محاسبي متكامل</p>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-0.5">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            const isActive = active === item.key;
            return (
              <button
                key={item.key}
                onClick={() => { onNavigate(item.key); setMobileOpen(false); }}
                className={classNames(
                  'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-body text-right transition-colors',
                  isActive ? 'bg-emerald-700 text-white font-medium' : 'text-stone-300 hover:bg-stone-800'
                )}
              >
                <Icon size={17} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="px-4 py-3 border-t border-stone-700 text-xs text-stone-500 font-body">
          البيانات محفوظة على حسابك تلقائيًا
        </div>
      </aside>
    </>
  );
}

function TopBar({ title, setMobileOpen, right }) {
  return (
    <div className="flex items-center justify-between px-4 md:px-6 py-4 bg-white border-b border-stone-200 sticky top-0 z-20">
      <div className="flex items-center gap-3">
        <button className="md:hidden p-1.5 rounded-md hover:bg-stone-100" onClick={() => setMobileOpen(true)}>
          <Menu size={20} />
        </button>
        <h1 className="font-display font-bold text-lg text-stone-800">{title}</h1>
      </div>
      {right}
    </div>
  );
}

/* ============================== DASHBOARD ============================== */

function DashboardView({ data, currency, onNavigate }) {
  const { accounts, journalEntries, salesInvoices, purchaseInvoices, products, customers, suppliers } = data;

  const cash = getAccountByKind(accounts, 'cash');
  const bank = getAccountByKind(accounts, 'bank');
  const ar = getAccountByKind(accounts, 'ar');
  const ap = getAccountByKind(accounts, 'ap');
  const inventoryAcc = getAccountByKind(accounts, 'inventory');

  const cashBal = cash ? accountBalance(cash, journalEntries).balance : 0;
  const bankBal = bank ? accountBalance(bank, journalEntries).balance : 0;
  const arBal = ar ? accountBalance(ar, journalEntries).balance : 0;
  const apBal = ap ? accountBalance(ap, journalEntries).balance : 0;
  const invBal = inventoryAcc ? accountBalance(inventoryAcc, journalEntries).balance : 0;

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1, 2)}-01`;
  const monthEntries = filterEntriesByDate(journalEntries, monthStart, todayISO());

  let monthRevenue = 0, monthExpense = 0;
  for (const acc of accounts) {
    const bal = accountBalance(acc, monthEntries).balance;
    if (acc.type === 'revenue') monthRevenue += bal;
    if (acc.type === 'expense') monthExpense += bal;
  }
  const monthProfit = monthRevenue - monthExpense;

  const lowStock = products.filter(p => Number(p.qty) <= Number(p.minQty || 5)).slice(0, 6);

  const recentInvoices = [...salesInvoices]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 5);

  // last 6 months trend
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-01`;
    const endD = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const end = `${endD.getFullYear()}-${pad(endD.getMonth() + 1, 2)}-${pad(endD.getDate(), 2)}`;
    const entries = filterEntriesByDate(journalEntries, start, end);
    let rev = 0, exp = 0;
    for (const acc of accounts) {
      const bal = accountBalance(acc, entries).balance;
      if (acc.type === 'revenue') rev += bal;
      if (acc.type === 'expense') exp += bal;
    }
    months.push({ label: d.toLocaleDateString('ar-EG', { month: 'short' }), revenue: Math.round(rev), expense: Math.round(exp) });
  }
  const maxVal = Math.max(1, ...months.map(m => Math.max(m.revenue, m.expense)));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <LedgerStatCard icon={Banknote} label="الصندوق" value={cashBal} currency={currency} tone="pos" />
        <LedgerStatCard icon={Landmark} label="البنك" value={bankBal} currency={currency} tone="pos" />
        <LedgerStatCard icon={Users} label="مستحق من العملاء" value={arBal} currency={currency} tone="neutral" />
        <LedgerStatCard icon={Truck} label="مستحق للموردين" value={apBal} currency={currency} tone="warn" />
        <LedgerStatCard icon={Package} label="قيمة المخزون" value={invBal} currency={currency} tone="neutral" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <LedgerStatCard icon={TrendingUp} label="مبيعات الشهر الحالي" value={monthRevenue} currency={currency} tone="pos" />
        <LedgerStatCard icon={TrendingDown} label="مصاريف الشهر الحالي" value={monthExpense} currency={currency} tone="neg" />
        <LedgerStatCard icon={monthProfit >= 0 ? ArrowUpRight : ArrowDownRight} label="صافي ربح الشهر" value={monthProfit} currency={currency} tone={monthProfit >= 0 ? 'pos' : 'neg'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-4">
          <p className="font-display font-semibold text-stone-700 mb-4 text-sm">الإيرادات والمصاريف - آخر 6 أشهر</p>
          <div className="flex items-end gap-4 h-40">
            {months.map((m, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                <div className="flex items-end gap-1 h-full w-full justify-center">
                  <div className="w-3 bg-emerald-600 rounded-t" style={{ height: `${(m.revenue / maxVal) * 100}%` }} title={`إيرادات: ${fmtNum(m.revenue)}`} />
                  <div className="w-3 bg-rose-400 rounded-t" style={{ height: `${(m.expense / maxVal) * 100}%` }} title={`مصاريف: ${fmtNum(m.expense)}`} />
                </div>
                <span className="text-xs text-stone-400 font-body">{m.label}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-3 text-xs font-body text-stone-500">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-600 inline-block" /> إيرادات</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-rose-400 inline-block" /> مصاريف</span>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="font-display font-semibold text-stone-700 text-sm">تنبيه المخزون المنخفض</p>
            <AlertTriangle size={16} className="text-amber-500" />
          </div>
          {lowStock.length === 0 ? (
            <p className="text-sm text-stone-400 font-body">لا توجد أصناف منخفضة المخزون حاليًا.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {lowStock.map(p => (
                <li key={p.id} className="flex items-center justify-between text-sm font-body">
                  <span className="text-stone-700 truncate">{p.name}</span>
                  <Badge tone={Number(p.qty) === 0 ? 'red' : 'amber'}>{p.qty} {p.unit}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="font-display font-semibold text-stone-700 text-sm">أحدث فواتير المبيعات</p>
          <button onClick={() => onNavigate('sales')} className="text-xs text-emerald-700 font-body hover:underline">عرض الكل</button>
        </div>
        {recentInvoices.length === 0 ? (
          <EmptyState icon={ShoppingCart} title="لا توجد فواتير بعد" hint="أنشئ أول فاتورة مبيعات من قسم فواتير المبيعات." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="text-stone-400 text-xs border-b border-stone-100">
                  <th className="text-right py-2 font-normal">رقم</th>
                  <th className="text-right py-2 font-normal">التاريخ</th>
                  <th className="text-right py-2 font-normal">العميل</th>
                  <th className="text-right py-2 font-normal">الإجمالي</th>
                  <th className="text-right py-2 font-normal">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {recentInvoices.map(inv => {
                  const cust = customers.find(c => c.id === inv.customerId);
                  const remaining = inv.total - inv.paidAmount;
                  return (
                    <tr key={inv.id} className="border-b border-stone-50">
                      <td className="py-2 text-stone-600">#{inv.no}</td>
                      <td className="py-2 text-stone-600">{fmtDate(inv.date)}</td>
                      <td className="py-2 text-stone-700">{cust ? cust.name : 'عميل نقدي'}</td>
                      <td className="py-2"><Figure value={inv.total} currency={currency} /></td>
                      <td className="py-2">
                        {remaining <= 0.005 ? <Badge tone="green">مدفوعة</Badge> : <Badge tone="amber">جزئية/آجلة</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ============================== CHART OF ACCOUNTS ============================== */

function AccountFormModal({ onClose, onSave }) {
  const [form, setForm] = useState({ code: '', name: '', type: 'expense' });
  const canSave = form.code.trim() && form.name.trim();
  return (
    <Modal title="إضافة حساب جديد" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="رمز الحساب" required>
          <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="مثال: 5500" />
        </Field>
        <Field label="اسم الحساب" required>
          <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="مثال: مصاريف صيانة" />
        </Field>
        <Field label="نوع الحساب" required>
          <Select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
            <option value="expense">مصروف</option>
            <option value="revenue">إيراد</option>
          </Select>
        </Field>
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button disabled={!canSave} onClick={() => onSave(form)} icon={Check}>حفظ الحساب</Button>
        </div>
      </div>
    </Modal>
  );
}

function AccountsView({ accounts, journalEntries, currency, onAdd, onDelete }) {
  const [showForm, setShowForm] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);

  const usedAccountIds = useMemo(() => {
    const s = new Set();
    journalEntries.forEach(je => je.lines.forEach(l => s.add(l.accountId)));
    return s;
  }, [journalEntries]);

  const grouped = ACCOUNT_TYPE_ORDER.map(type => ({
    type,
    list: accounts.filter(a => a.type === type),
  }));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <Button icon={Plus} onClick={() => setShowForm(true)}>حساب جديد</Button>
      </div>
      {grouped.map(group => (
        <Card key={group.type} className="p-4">
          <p className="font-display font-semibold text-stone-700 mb-3 text-sm">{ACCOUNT_TYPE_LABELS[group.type]}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="text-stone-400 text-xs border-b border-stone-100">
                  <th className="text-right py-2 font-normal">الرمز</th>
                  <th className="text-right py-2 font-normal">اسم الحساب</th>
                  <th className="text-right py-2 font-normal">النوع</th>
                  <th className="text-right py-2 font-normal">الرصيد الحالي</th>
                  <th className="text-right py-2 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {group.list.map(acc => {
                  const bal = accountBalance(acc, journalEntries).balance;
                  return (
                    <tr key={acc.id} className="border-b border-stone-50 hover:bg-stone-50">
                      <td className="py-2 text-stone-500">{acc.code}</td>
                      <td className="py-2 text-stone-700">{acc.name}</td>
                      <td className="py-2">{acc.system ? <Badge tone="blue">نظامي</Badge> : <Badge>مخصص</Badge>}</td>
                      <td className="py-2"><Figure value={bal} currency={currency} tone={bal >= 0 ? 'pos' : 'neg'} /></td>
                      <td className="py-2">
                        {!acc.system && (
                          <IconButton icon={Trash2} variant="danger" title="حذف" onClick={() => setConfirmDel(acc)} />
                        )}
                      </td>
                    </tr>
                  );
                })}
                {group.list.length === 0 && (
                  <tr><td colSpan={5} className="py-4 text-center text-stone-400 text-xs">لا توجد حسابات في هذا التصنيف</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      {showForm && (
        <AccountFormModal
          onClose={() => setShowForm(false)}
          onSave={(form) => { onAdd(form); setShowForm(false); }}
        />
      )}

      {confirmDel && (
        <ConfirmDialog
          title="حذف الحساب"
          message={usedAccountIds.has(confirmDel.id)
            ? `لا يمكن حذف حساب "${confirmDel.name}" لوجود قيود مرتبطة به.`
            : `هل تريد حذف حساب "${confirmDel.name}"؟`}
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => {
            if (!usedAccountIds.has(confirmDel.id)) onDelete(confirmDel.id);
            setConfirmDel(null);
          }}
        />
      )}
    </div>
  );
}

/* ============================== CONTACTS (Customers/Suppliers) ============================== */

function ContactFormModal({ title, initial, onClose, onSave }) {
  const [form, setForm] = useState(initial || { name: '', phone: '', notes: '' });
  const canSave = form.name.trim();
  return (
    <Modal title={title} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="الاسم" required>
          <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="رقم الهاتف" hint="أدخله مع رمز الدولة بدون + أو أصفار (مثال: 9665xxxxxxxx) لتفعيل تذكيرات واتساب">
          <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} dir="ltr" placeholder="9665xxxxxxxx" />
        </Field>
        <Field label="ملاحظات">
          <Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </Field>
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button disabled={!canSave} onClick={() => onSave(form)} icon={Check}>حفظ</Button>
        </div>
      </div>
    </Modal>
  );
}

function PaymentFormModal({ contact, unpaidInvoices, currency, onClose, onSave }) {
  const [invoiceId, setInvoiceId] = useState(unpaidInvoices[0]?.id || '');
  const invoice = unpaidInvoices.find(i => i.id === invoiceId);
  const remaining = invoice ? invoice.total - invoice.paidAmount : 0;
  const [amount, setAmount] = useState(remaining);
  const [method, setMethod] = useState('cash');
  const [date, setDate] = useState(todayISO());

  useEffect(() => { setAmount(remaining); }, [invoiceId]);

  const canSave = invoice && Number(amount) > 0 && Number(amount) <= remaining + 0.005;

  return (
    <Modal title={`تسجيل دفعة - ${contact.name}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {unpaidInvoices.length === 0 ? (
          <p className="text-sm text-stone-400 font-body">لا توجد فواتير غير مسددة لهذا الطرف.</p>
        ) : (
          <>
            <Field label="الفاتورة" required>
              <Select value={invoiceId} onChange={e => setInvoiceId(e.target.value)}>
                {unpaidInvoices.map(inv => (
                  <option key={inv.id} value={inv.id}>
                    #{inv.no} - {fmtDate(inv.date)} - متبقي {fmtNum(inv.total - inv.paidAmount)} {currency}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="المبلغ" required hint={`الحد الأقصى: ${fmtNum(remaining)} ${currency}`}>
              <Input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} dir="ltr" />
            </Field>
            <Field label="طريقة الدفع" required>
              <Select value={method} onChange={e => setMethod(e.target.value)}>
                <option value="cash">نقدي</option>
                <option value="bank">بنك</option>
              </Select>
            </Field>
            <Field label="التاريخ" required>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="secondary" onClick={onClose}>إلغاء</Button>
              <Button disabled={!canSave} onClick={() => onSave({ invoiceId, amount: Number(amount), method, date })} icon={Check}>
                تسجيل الدفعة
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function ContactsView({ type, contacts, invoices, currency, settings, onAdd, onUpdate, onDelete, onRecordPayment }) {
  const isCustomer = type === 'customer';
  const contactField = isCustomer ? 'customerId' : 'supplierId';
  const today = todayISO();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [payingFor, setPayingFor] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [search, setSearch] = useState('');

  const contactInvoices = (contactId) => invoices.filter(i => i[contactField] === contactId);
  const contactBalance = (contactId) => contactInvoices(contactId).reduce((s, i) => s + (i.total - i.paidAmount), 0);

  const filtered = contacts.filter(c => c.name.includes(search) || (c.phone || '').includes(search));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search size={15} className="absolute top-1/2 -translate-y-1/2 right-3 text-stone-400" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالاسم أو الهاتف" className="pr-9" />
        </div>
        <Button icon={Plus} onClick={() => { setEditing(null); setShowForm(true); }}>
          {isCustomer ? 'عميل جديد' : 'مورد جديد'}
        </Button>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-4">
          <EmptyState
            icon={isCustomer ? Users : Truck}
            title={isCustomer ? 'لا يوجد عملاء بعد' : 'لا يوجد موردون بعد'}
            hint="أضف أول جهة اتصال للبدء في إصدار الفواتير."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map(c => {
            const bal = contactBalance(c.id);
            const unpaid = contactInvoices(c.id).filter(i => i.total - i.paidAmount > 0.005);
            const isOpen = expanded === c.id;
            const tierInfo = isCustomer ? computeCustomerTier(c, invoices, settings, today) : null;
            const riskInfo = isCustomer ? computeCustomerRisk(c, invoices, settings, today) : null;
            return (
              <Card key={c.id} className="overflow-hidden">
                <div className="p-4 flex items-center justify-between gap-3 cursor-pointer" onClick={() => setExpanded(isOpen ? null : c.id)}>
                  <div className="flex items-center gap-3 min-w-0">
                    {isOpen ? <ChevronDown size={16} className="text-stone-400 shrink-0" /> : <ChevronRight size={16} className="text-stone-400 shrink-0" />}
                    <div className="min-w-0">
                      <p className="font-body font-medium text-stone-800 truncate flex items-center gap-1.5">
                        {c.name}
                        {tierInfo && tierInfo.tier === 'vip' && <Badge tone="amber">⭐ VIP</Badge>}
                        {riskInfo && riskInfo.level !== 'excellent' && (
                          <Badge tone={riskInfo.level === 'poor' ? 'red' : 'amber'}>{RISK_LABELS[riskInfo.level]}</Badge>
                        )}
                      </p>
                      <p className="text-xs text-stone-400 font-body" dir="ltr">{c.phone}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Figure value={bal} currency={currency} tone={bal > 0 ? 'neg' : 'pos'} className="text-sm" />
                    <IconButton icon={Pencil} title="تعديل" onClick={(e) => { e.stopPropagation(); setEditing(c); setShowForm(true); }} />
                    <IconButton icon={Trash2} variant="danger" title="حذف" onClick={(e) => { e.stopPropagation(); setConfirmDel(c); }} />
                  </div>
                </div>
                {isOpen && (
                  <div className="border-t border-stone-100 p-4">
                    {unpaid.length === 0 ? (
                      <p className="text-sm text-stone-400 font-body">لا توجد فواتير غير مسددة.</p>
                    ) : (
                      <table className="w-full text-sm font-body">
                        <thead>
                          <tr className="text-stone-400 text-xs">
                            <th className="text-right py-1.5 font-normal">رقم</th>
                            <th className="text-right py-1.5 font-normal">التاريخ</th>
                            <th className="text-right py-1.5 font-normal">الإجمالي</th>
                            <th className="text-right py-1.5 font-normal">المتبقي</th>
                            <th className="text-right py-1.5 font-normal"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {unpaid.map(inv => (
                            <tr key={inv.id} className="border-t border-stone-50">
                              <td className="py-1.5 text-stone-500">#{inv.no}</td>
                              <td className="py-1.5 text-stone-500">{fmtDate(inv.date)}</td>
                              <td className="py-1.5"><Figure value={inv.total} currency={currency} /></td>
                              <td className="py-1.5"><Figure value={inv.total - inv.paidAmount} currency={currency} tone="neg" /></td>
                              <td className="py-1.5">
                                <Button size="sm" variant="outline" onClick={() => setPayingFor(c)}>تسجيل دفعة</Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {showForm && (
        <ContactFormModal
          title={editing ? 'تعديل بيانات' : (isCustomer ? 'عميل جديد' : 'مورد جديد')}
          initial={editing}
          onClose={() => setShowForm(false)}
          onSave={(form) => {
            if (editing) onUpdate({ ...editing, ...form }); else onAdd(form);
            setShowForm(false);
          }}
        />
      )}

      {confirmDel && (
        <ConfirmDialog
          title="حذف"
          message={contactInvoices(confirmDel.id).length > 0
            ? `لا يمكن حذف "${confirmDel.name}" لوجود فواتير مرتبطة به.`
            : `هل تريد حذف "${confirmDel.name}"؟`}
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => {
            if (contactInvoices(confirmDel.id).length === 0) onDelete(confirmDel.id);
            setConfirmDel(null);
          }}
        />
      )}

      {payingFor && (
        <PaymentFormModal
          contact={payingFor}
          unpaidInvoices={contactInvoices(payingFor.id).filter(i => i.total - i.paidAmount > 0.005)}
          currency={currency}
          onClose={() => setPayingFor(null)}
          onSave={(data) => { onRecordPayment(payingFor, data); setPayingFor(null); }}
        />
      )}
    </div>
  );
}

/* ============================== PRODUCTS ============================== */

function ProductFormModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState(initial || { name: '', sku: '', unit: UNITS[0], costPrice: '', salePrice: '', qty: '', minQty: 5 });
  const canSave = form.name.trim() && form.salePrice !== '';
  return (
    <Modal title={initial ? 'تعديل منتج' : 'منتج جديد'} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="اسم المنتج" required>
          <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="رمز الصنف (SKU)">
            <Input value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} dir="ltr" />
          </Field>
          <Field label="وحدة القياس">
            <Select value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="سعر التكلفة">
            <Input type="number" min="0" step="0.01" dir="ltr" value={form.costPrice} onChange={e => setForm(f => ({ ...f, costPrice: e.target.value }))} />
          </Field>
          <Field label="سعر البيع" required>
            <Input type="number" min="0" step="0.01" dir="ltr" value={form.salePrice} onChange={e => setForm(f => ({ ...f, salePrice: e.target.value }))} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="الكمية الحالية">
            <Input type="number" min="0" step="1" dir="ltr" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} />
          </Field>
          <Field label="حد التنبيه للمخزون المنخفض">
            <Input type="number" min="0" step="1" dir="ltr" value={form.minQty} onChange={e => setForm(f => ({ ...f, minQty: e.target.value }))} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button disabled={!canSave} onClick={() => onSave({
            ...form,
            costPrice: Number(form.costPrice) || 0,
            salePrice: Number(form.salePrice) || 0,
            qty: Number(form.qty) || 0,
            minQty: Number(form.minQty) || 0,
          })} icon={Check}>حفظ</Button>
        </div>
      </div>
    </Modal>
  );
}

function ProductsView({ products, currency, onAdd, onUpdate, onDelete, usedProductIds }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [search, setSearch] = useState('');

  const filtered = products.filter(p => p.name.includes(search) || (p.sku || '').includes(search));
  const totalValue = products.reduce((s, p) => s + Number(p.qty) * Number(p.costPrice), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search size={15} className="absolute top-1/2 -translate-y-1/2 right-3 text-stone-400" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالاسم أو الرمز" className="pr-9" />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-body text-stone-500">إجمالي قيمة المخزون: <Figure value={totalValue} currency={currency} className="text-stone-700 font-medium" /></span>
          <Button icon={Plus} onClick={() => { setEditing(null); setShowForm(true); }}>منتج جديد</Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-4">
          <EmptyState icon={Package} title="لا توجد منتجات بعد" hint="أضف منتجاتك لتتمكن من إصدار الفواتير وتتبع المخزون." />
        </Card>
      ) : (
        <Card className="p-4 overflow-x-auto">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="text-stone-400 text-xs border-b border-stone-100">
                <th className="text-right py-2 font-normal">الاسم</th>
                <th className="text-right py-2 font-normal">الرمز</th>
                <th className="text-right py-2 font-normal">الكمية</th>
                <th className="text-right py-2 font-normal">التكلفة</th>
                <th className="text-right py-2 font-normal">سعر البيع</th>
                <th className="text-right py-2 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className="border-b border-stone-50 hover:bg-stone-50">
                  <td className="py-2 text-stone-700">{p.name}</td>
                  <td className="py-2 text-stone-500" dir="ltr">{p.sku}</td>
                  <td className="py-2">
                    <Badge tone={Number(p.qty) <= Number(p.minQty || 5) ? (Number(p.qty) === 0 ? 'red' : 'amber') : 'green'}>
                      {p.qty} {p.unit}
                    </Badge>
                  </td>
                  <td className="py-2"><Figure value={p.costPrice} currency={currency} /></td>
                  <td className="py-2"><Figure value={p.salePrice} currency={currency} /></td>
                  <td className="py-2 flex gap-1">
                    <IconButton icon={Pencil} title="تعديل" onClick={() => { setEditing(p); setShowForm(true); }} />
                    <IconButton icon={Trash2} variant="danger" title="حذف" onClick={() => setConfirmDel(p)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {showForm && (
        <ProductFormModal
          initial={editing}
          onClose={() => setShowForm(false)}
          onSave={(form) => { if (editing) onUpdate({ ...editing, ...form }); else onAdd(form); setShowForm(false); }}
        />
      )}

      {confirmDel && (
        <ConfirmDialog
          title="حذف منتج"
          message={usedProductIds.has(confirmDel.id)
            ? `لا يمكن حذف "${confirmDel.name}" لوجوده ضمن فواتير سابقة.`
            : `هل تريد حذف "${confirmDel.name}"؟`}
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => { if (!usedProductIds.has(confirmDel.id)) onDelete(confirmDel.id); setConfirmDel(null); }}
        />
      )}
    </div>
  );
}

/* ============================== INVOICE LINE ITEMS EDITOR ============================== */

function emptyItem() {
  return { rowId: uid('row'), productId: '', name: '', qty: 1, price: '', cost: 0 };
}

function ItemsEditor({ items, setItems, products, currency, priceLabel }) {
  const updateItem = (rowId, patch) => {
    setItems(items.map(it => it.rowId === rowId ? { ...it, ...patch } : it));
  };
  const removeItem = (rowId) => setItems(items.filter(it => it.rowId !== rowId));
  const addItem = () => setItems([...items, emptyItem()]);

  const onProductChange = (rowId, productId) => {
    if (productId === '__free__') {
      updateItem(rowId, { productId: '', name: '', price: '', cost: 0 });
      return;
    }
    const p = products.find(pr => pr.id === productId);
    if (p) {
      updateItem(rowId, {
        productId,
        name: p.name,
        price: priceLabel === 'سعر الشراء' ? p.costPrice : p.salePrice,
        cost: p.costPrice,
      });
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm font-body" style={{ minWidth: 520 }}>
          <thead>
            <tr className="text-stone-400 text-xs">
              <th className="text-right py-1.5 font-normal px-1">الصنف</th>
              <th className="text-right py-1.5 font-normal px-1 w-20">الكمية</th>
              <th className="text-right py-1.5 font-normal px-1 w-28">{priceLabel}</th>
              <th className="text-right py-1.5 font-normal px-1 w-24">الإجمالي</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {items.map(it => {
              const product = products.find(p => p.id === it.productId);
              const lineTotal = (Number(it.qty) || 0) * (Number(it.price) || 0);
              const overStock = product && priceLabel !== 'سعر الشراء' && Number(it.qty) > Number(product.qty);
              return (
                <tr key={it.rowId} className="align-top">
                  <td className="py-1 px-1">
                    <Select value={it.productId || '__free__'} onChange={e => onProductChange(it.rowId, e.target.value)}>
                      <option value="__free__">بند حر / خدمة</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.qty} {p.unit} متاح)</option>)}
                    </Select>
                    {!it.productId && (
                      <Input className="mt-1" placeholder="اسم البند" value={it.name} onChange={e => updateItem(it.rowId, { name: e.target.value })} />
                    )}
                    {overStock && <p className="text-xs text-amber-600 mt-1">الكمية المطلوبة أكبر من المتاح ({product.qty})</p>}
                  </td>
                  <td className="py-1 px-1">
                    <Input type="number" min="0" step="1" dir="ltr" value={it.qty} onChange={e => updateItem(it.rowId, { qty: e.target.value })} />
                  </td>
                  <td className="py-1 px-1">
                    <Input type="number" min="0" step="0.01" dir="ltr" value={it.price} onChange={e => updateItem(it.rowId, { price: e.target.value })} />
                  </td>
                  <td className="py-1 px-1 pt-3"><Figure value={lineTotal} currency={currency} /></td>
                  <td className="py-1 px-1 pt-2">
                    <IconButton icon={Trash2} variant="danger" title="حذف البند" onClick={() => removeItem(it.rowId)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Button size="sm" variant="outline" icon={Plus} onClick={addItem} className="self-start">إضافة بند</Button>
    </div>
  );
}

function InvoiceTotalsBox({ totals, currency, discount, setDiscount, applyTax, setApplyTax, taxRate }) {
  return (
    <div className="flex flex-col gap-2 bg-stone-50 rounded-lg p-3 mt-2">
      <div className="flex items-center justify-between text-sm font-body">
        <span className="text-stone-500">المجموع الفرعي</span>
        <Figure value={totals.subtotal} currency={currency} />
      </div>
      <div className="flex items-center justify-between text-sm font-body">
        <span className="text-stone-500">الخصم</span>
        <Input type="number" min="0" step="0.01" dir="ltr" value={discount} onChange={e => setDiscount(e.target.value)} className="w-28 py-1" />
      </div>
      <label className="flex items-center justify-between text-sm font-body cursor-pointer">
        <span className="text-stone-500 flex items-center gap-1.5">
          <input type="checkbox" checked={applyTax} onChange={e => setApplyTax(e.target.checked)} />
          ضريبة القيمة المضافة ({taxRate}%)
        </span>
        <Figure value={totals.tax} currency={currency} />
      </label>
      <div className="flex items-center justify-between text-base font-body font-semibold border-t border-stone-200 pt-2">
        <span className="text-stone-700">الإجمالي</span>
        <Figure value={totals.total} currency={currency} className="text-emerald-700" />
      </div>
    </div>
  );
}

/* ============================== SALES INVOICES ============================== */

function SalesInvoiceFormModal({ customers, products, reps, salesInvoices, settings, onClose, onSave }) {
  const today = todayISO();
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState(today);
  const [items, setItems] = useState([emptyItem()]);
  const [discount, setDiscount] = useState(0);
  const [discountTouched, setDiscountTouched] = useState(false);
  const [applyTax, setApplyTax] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [repId, setRepId] = useState('');
  const [overrideBlock, setOverrideBlock] = useState(false);

  const customer = customers.find(c => c.id === customerId) || null;
  const { tier } = computeCustomerTier(customer, salesInvoices, settings, today);
  const risk = computeCustomerRisk(customer, salesInvoices, settings, today);
  const isVip = tier === 'vip';
  const creditBlocked = customer && risk.level === 'poor';

  const validItems = items.filter(it => (it.name || products.find(p => p.id === it.productId)) && Number(it.qty) > 0);
  const rawTotals = computeInvoiceTotals(validItems, 0, applyTax, settings.taxRate);

  // Auto-apply the VIP discount (once, unless the user has manually edited the discount field)
  useEffect(() => {
    if (isVip && !discountTouched && settings.vipDiscountPercent > 0) {
      setDiscount(Number((rawTotals.subtotal * settings.vipDiscountPercent / 100).toFixed(2)));
    }
    if (!isVip && !discountTouched) {
      setDiscount(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVip, rawTotals.subtotal, settings.vipDiscountPercent]);

  const totals = computeInvoiceTotals(validItems, discount, applyTax, settings.taxRate);
  const creditAllowed = paymentMethod !== 'credit' || (!creditBlocked || overrideBlock);
  const canSave = validItems.length > 0 && totals.total > 0 && (paymentMethod !== 'credit' || customerId) && creditAllowed;

  const rep = reps.find(r => r.id === repId) || null;
  const commissionPreview = rep ? totals.afterDiscount * (Number(rep.commissionPercent) || 0) / 100 : 0;

  return (
    <Modal title="فاتورة مبيعات جديدة" onClose={onClose} width="max-w-2xl">
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="العميل" hint={paymentMethod === 'credit' ? 'مطلوب للبيع الآجل' : 'اتركه فارغًا لعميل نقدي'}>
            <Select value={customerId} onChange={e => { setCustomerId(e.target.value); setOverrideBlock(false); }}>
              <option value="">عميل نقدي</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="التاريخ" required>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </Field>
        </div>

        {customer && (
          <div className="flex flex-wrap items-center gap-2">
            {isVip && <Badge tone="amber">⭐ عميل VIP - خصم {settings.vipDiscountPercent}% مُفعّل تلقائيًا</Badge>}
            <Badge tone={risk.level === 'excellent' ? 'green' : risk.level === 'fair' ? 'amber' : 'red'}>
              التصنيف الائتماني: {RISK_LABELS[risk.level]}
            </Badge>
          </div>
        )}

        <Field label="طريقة الدفع" required>
          <Select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
            <option value="cash">نقدي (الصندوق)</option>
            <option value="bank">تحويل بنكي</option>
            <option value="credit">آجل (على حساب العميل)</option>
          </Select>
        </Field>

        {paymentMethod === 'credit' && creditBlocked && (
          <div className="flex flex-col gap-2 bg-rose-50 text-rose-700 rounded-md px-3 py-2.5 text-sm font-body">
            <span className="flex items-center gap-1.5"><AlertTriangle size={15} /> البيع الآجل محظور لهذا العميل ({risk.overdueCount} فاتورة متأخرة بقيمة {fmtNum(risk.overdueAmount)} {settings.currency})</span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={overrideBlock} onChange={e => setOverrideBlock(e.target.checked)} />
              تجاوز الحظر والبيع له آجلاً على مسؤوليتي
            </label>
          </div>
        )}

        {reps.length > 0 && (
          <Field label="المندوب / مصدر البيع" hint="اختياري - لاحتساب العمولة">
            <Select value={repId} onChange={e => setRepId(e.target.value)}>
              <option value="">بدون مندوب</option>
              {reps.map(r => <option key={r.id} value={r.id}>{r.name} (عمولة {r.commissionPercent}%)</option>)}
            </Select>
            {rep && <p className="text-xs text-emerald-700 mt-1">عمولة تقديرية لهذه الفاتورة: {fmtNum(commissionPreview)} {settings.currency}</p>}
          </Field>
        )}

        <div>
          <p className="text-sm font-body text-stone-600 mb-1">بنود الفاتورة</p>
          <ItemsEditor items={items} setItems={setItems} products={products} currency={settings.currency} priceLabel="سعر البيع" />
        </div>

        <InvoiceTotalsBox totals={totals} currency={settings.currency} discount={discount} setDiscount={(v) => { setDiscount(v); setDiscountTouched(true); }} applyTax={applyTax} setApplyTax={setApplyTax} taxRate={settings.taxRate} />

        <div className="flex justify-end gap-2 mt-1">
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button disabled={!canSave} icon={Check} onClick={() => onSave({
            customerId: customerId || null, date, items: validItems.map(it => ({
              productId: it.productId || null,
              name: it.name || (products.find(p => p.id === it.productId)?.name) || 'بند',
              qty: Number(it.qty), price: Number(it.price) || 0, cost: Number(it.cost) || 0,
            })), discount: Number(discount) || 0, applyTax, paymentMethod,
            dueDate: addDays(date, settings.defaultPaymentTermsDays),
            repId: repId || null, isVipSale: isVip,
          })}>حفظ الفاتورة</Button>
        </div>
      </div>
    </Modal>
  );
}

function InvoiceDetailModal({ invoice, contact, contactLabel, currency, accountLabel, onClose }) {
  return (
    <Modal title={`فاتورة رقم #${invoice.no}`} onClose={onClose} width="max-w-xl">
      <div className="print-area">
        <div className="flex justify-between text-sm font-body mb-4">
          <div>
            <p className="text-stone-400">{contactLabel}</p>
            <p className="text-stone-700 font-medium">{contact ? contact.name : 'نقدي'}</p>
          </div>
          <div className="text-left">
            <p className="text-stone-400">التاريخ</p>
            <p className="text-stone-700 font-medium">{fmtDate(invoice.date)}</p>
          </div>
        </div>
        <table className="w-full text-sm font-body mb-3">
          <thead>
            <tr className="text-stone-400 text-xs border-b border-stone-100">
              <th className="text-right py-1.5 font-normal">الصنف</th>
              <th className="text-right py-1.5 font-normal">الكمية</th>
              <th className="text-right py-1.5 font-normal">السعر</th>
              <th className="text-right py-1.5 font-normal">الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((it, i) => (
              <tr key={i} className="border-b border-stone-50">
                <td className="py-1.5">{it.name}</td>
                <td className="py-1.5"><Figure value={it.qty} /></td>
                <td className="py-1.5"><Figure value={it.price} currency={currency} /></td>
                <td className="py-1.5"><Figure value={it.qty * it.price} currency={currency} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-col gap-1 items-end text-sm font-body">
          <p>المجموع الفرعي: <Figure value={invoice.subtotal} currency={currency} /></p>
          {invoice.discount > 0 && <p>الخصم: <Figure value={invoice.discount} currency={currency} /></p>}
          {invoice.tax > 0 && <p>الضريبة: <Figure value={invoice.tax} currency={currency} /></p>}
          <p className="font-semibold text-base">الإجمالي: <Figure value={invoice.total} currency={currency} /></p>
          <p className="text-stone-500">المدفوع: <Figure value={invoice.paidAmount} currency={currency} /></p>
          <p className="text-stone-500">المتبقي: <Figure value={invoice.total - invoice.paidAmount} currency={currency} /></p>
          {invoice.dueDate && invoice.total - invoice.paidAmount > 0.005 && (
            <p className="text-stone-500">تاريخ الاستحقاق: {fmtDate(invoice.dueDate)}</p>
          )}
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4 no-print">
        <Button variant="secondary" onClick={onClose}>إغلاق</Button>
        <Button icon={Printer} onClick={() => window.print()}>طباعة</Button>
      </div>
    </Modal>
  );
}

function SalesInvoicesView({ invoices, customers, products, reps, settings, onAdd }) {
  const [showForm, setShowForm] = useState(false);
  const [viewing, setViewing] = useState(null);
  const sorted = [...invoices].sort((a, b) => (a.date < b.date ? 1 : -1));
  const today = todayISO();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button icon={Plus} onClick={() => setShowForm(true)}>فاتورة مبيعات جديدة</Button>
      </div>
      {sorted.length === 0 ? (
        <Card className="p-4">
          <EmptyState icon={ShoppingCart} title="لا توجد فواتير مبيعات بعد" hint="أنشئ أول فاتورة لتوليد القيد المحاسبي تلقائيًا." />
        </Card>
      ) : (
        <Card className="overflow-x-auto p-4">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="text-stone-400 text-xs border-b border-stone-100">
                <th className="text-right py-2 font-normal">رقم</th>
                <th className="text-right py-2 font-normal">التاريخ</th>
                <th className="text-right py-2 font-normal">العميل</th>
                <th className="text-right py-2 font-normal">طريقة الدفع</th>
                <th className="text-right py-2 font-normal">الإجمالي</th>
                <th className="text-right py-2 font-normal">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(inv => {
                const cust = customers.find(c => c.id === inv.customerId);
                const remaining = inv.total - inv.paidAmount;
                const overdue = remaining > 0.005 && inv.dueDate && inv.dueDate < today;
                return (
                  <tr key={inv.id} className="border-b border-stone-50 hover:bg-stone-50 cursor-pointer" onClick={() => setViewing(inv)}>
                    <td className="py-2 text-stone-600">#{inv.no}</td>
                    <td className="py-2 text-stone-600">{fmtDate(inv.date)}</td>
                    <td className="py-2 text-stone-700">
                      {cust ? cust.name : 'عميل نقدي'}
                      {inv.isVipSale && <span className="text-amber-500"> ⭐</span>}
                    </td>
                    <td className="py-2"><Badge>{PAYMENT_METHOD_LABELS[inv.paymentMethod]}</Badge></td>
                    <td className="py-2"><Figure value={inv.total} currency={settings.currency} /></td>
                    <td className="py-2">
                      {remaining <= 0.005
                        ? <Badge tone="green">مدفوعة</Badge>
                        : overdue
                          ? <Badge tone="red">متأخرة ({fmtNum(remaining)})</Badge>
                          : <Badge tone="amber">متبقي {fmtNum(remaining)}</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {showForm && (
        <SalesInvoiceFormModal
          customers={customers} products={products} reps={reps} salesInvoices={invoices} settings={settings}
          onClose={() => setShowForm(false)}
          onSave={(data) => { onAdd(data); setShowForm(false); }}
        />
      )}

      {viewing && (
        <InvoiceDetailModal
          invoice={viewing}
          contact={customers.find(c => c.id === viewing.customerId)}
          contactLabel="العميل"
          currency={settings.currency}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

/* ============================== PURCHASE INVOICES ============================== */

function PurchaseInvoiceFormModal({ suppliers, products, settings, onClose, onSave }) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || '');
  const [date, setDate] = useState(todayISO());
  const [items, setItems] = useState([emptyItem()]);
  const [discount, setDiscount] = useState(0);
  const [applyTax, setApplyTax] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState('cash');

  const validItems = items.filter(it => (it.name || products.find(p => p.id === it.productId)) && Number(it.qty) > 0);
  const totals = computeInvoiceTotals(validItems, discount, applyTax, settings.taxRate);
  const canSave = validItems.length > 0 && totals.total > 0 && supplierId;

  return (
    <Modal title="فاتورة مشتريات جديدة" onClose={onClose} width="max-w-2xl">
      <div className="flex flex-col gap-3">
        {suppliers.length === 0 ? (
          <p className="text-sm font-body text-rose-600">أضف موردًا واحدًا على الأقل قبل تسجيل فاتورة مشتريات.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="المورد" required>
                <Select value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="التاريخ" required>
                <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
              </Field>
            </div>

            <Field label="طريقة الدفع" required>
              <Select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                <option value="cash">نقدي (الصندوق)</option>
                <option value="bank">تحويل بنكي</option>
                <option value="credit">آجل (على حساب المورد)</option>
              </Select>
            </Field>

            <div>
              <p className="text-sm font-body text-stone-600 mb-1">بنود الفاتورة</p>
              <ItemsEditor items={items} setItems={setItems} products={products} currency={settings.currency} priceLabel="سعر الشراء" />
            </div>

            <InvoiceTotalsBox totals={totals} currency={settings.currency} discount={discount} setDiscount={setDiscount} applyTax={applyTax} setApplyTax={setApplyTax} taxRate={settings.taxRate} />

            <div className="flex justify-end gap-2 mt-1">
              <Button variant="secondary" onClick={onClose}>إلغاء</Button>
              <Button disabled={!canSave} icon={Check} onClick={() => onSave({
                supplierId, date, items: validItems.map(it => ({
                  productId: it.productId || null,
                  name: it.name || (products.find(p => p.id === it.productId)?.name) || 'بند',
                  qty: Number(it.qty), price: Number(it.price) || 0,
                })), discount: Number(discount) || 0, applyTax, paymentMethod,
              })}>حفظ الفاتورة</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function PurchaseInvoicesView({ invoices, suppliers, products, settings, onAdd }) {
  const [showForm, setShowForm] = useState(false);
  const [viewing, setViewing] = useState(null);
  const sorted = [...invoices].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button icon={Plus} onClick={() => setShowForm(true)}>فاتورة مشتريات جديدة</Button>
      </div>
      {sorted.length === 0 ? (
        <Card className="p-4">
          <EmptyState icon={FileText} title="لا توجد فواتير مشتريات بعد" hint="سجل مشترياتك من الموردين لتحديث المخزون تلقائيًا." />
        </Card>
      ) : (
        <Card className="overflow-x-auto p-4">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="text-stone-400 text-xs border-b border-stone-100">
                <th className="text-right py-2 font-normal">رقم</th>
                <th className="text-right py-2 font-normal">التاريخ</th>
                <th className="text-right py-2 font-normal">المورد</th>
                <th className="text-right py-2 font-normal">طريقة الدفع</th>
                <th className="text-right py-2 font-normal">الإجمالي</th>
                <th className="text-right py-2 font-normal">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(inv => {
                const sup = suppliers.find(s => s.id === inv.supplierId);
                const remaining = inv.total - inv.paidAmount;
                return (
                  <tr key={inv.id} className="border-b border-stone-50 hover:bg-stone-50 cursor-pointer" onClick={() => setViewing(inv)}>
                    <td className="py-2 text-stone-600">#{inv.no}</td>
                    <td className="py-2 text-stone-600">{fmtDate(inv.date)}</td>
                    <td className="py-2 text-stone-700">{sup ? sup.name : '-'}</td>
                    <td className="py-2"><Badge>{PAYMENT_METHOD_LABELS[inv.paymentMethod]}</Badge></td>
                    <td className="py-2"><Figure value={inv.total} currency={settings.currency} /></td>
                    <td className="py-2">{remaining <= 0.005 ? <Badge tone="green">مسددة</Badge> : <Badge tone="amber">متبقي {fmtNum(remaining)}</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {showForm && (
        <PurchaseInvoiceFormModal
          suppliers={suppliers} products={products} settings={settings}
          onClose={() => setShowForm(false)}
          onSave={(data) => { onAdd(data); setShowForm(false); }}
        />
      )}

      {viewing && (
        <InvoiceDetailModal
          invoice={viewing}
          contact={suppliers.find(s => s.id === viewing.supplierId)}
          contactLabel="المورد"
          currency={settings.currency}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

/* ============================== EXPENSES ============================== */

function ExpenseFormModal({ expenseAccounts, onClose, onSave }) {
  const [form, setForm] = useState({
    date: todayISO(), accountId: expenseAccounts[0]?.id || '', amount: '', description: '', paymentMethod: 'cash',
  });
  const canSave = form.accountId && Number(form.amount) > 0;
  return (
    <Modal title="مصروف جديد" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="التاريخ" required>
          <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
        </Field>
        <Field label="بند المصروف" required>
          <Select value={form.accountId} onChange={e => setForm(f => ({ ...f, accountId: e.target.value }))}>
            {expenseAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="المبلغ" required>
          <Input type="number" min="0" step="0.01" dir="ltr" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
        </Field>
        <Field label="طريقة الدفع" required>
          <Select value={form.paymentMethod} onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))}>
            <option value="cash">نقدي (الصندوق)</option>
            <option value="bank">بنك</option>
          </Select>
        </Field>
        <Field label="وصف">
          <Textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </Field>
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button disabled={!canSave} icon={Check} onClick={() => onSave({ ...form, amount: Number(form.amount) })}>حفظ المصروف</Button>
        </div>
      </div>
    </Modal>
  );
}

function ExpensesView({ expenses, accounts, settings, onAdd }) {
  const [showForm, setShowForm] = useState(false);
  const expenseAccounts = accounts.filter(a => a.type === 'expense' && a.kind !== 'cogs');
  const sorted = [...expenses].sort((a, b) => (a.date < b.date ? 1 : -1));
  const total = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-body text-stone-500">إجمالي المصاريف المسجلة: <Figure value={total} currency={settings.currency} className="text-stone-700 font-medium" /></span>
        <Button icon={Plus} onClick={() => setShowForm(true)}>مصروف جديد</Button>
      </div>
      {sorted.length === 0 ? (
        <Card className="p-4">
          <EmptyState icon={Wallet} title="لا توجد مصاريف مسجلة" hint="سجل مصاريفك اليومية مثل الإيجار والرواتب والفواتير." />
        </Card>
      ) : (
        <Card className="overflow-x-auto p-4">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="text-stone-400 text-xs border-b border-stone-100">
                <th className="text-right py-2 font-normal">التاريخ</th>
                <th className="text-right py-2 font-normal">البند</th>
                <th className="text-right py-2 font-normal">الوصف</th>
                <th className="text-right py-2 font-normal">طريقة الدفع</th>
                <th className="text-right py-2 font-normal">المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(e => {
                const acc = accounts.find(a => a.id === e.accountId);
                return (
                  <tr key={e.id} className="border-b border-stone-50">
                    <td className="py-2 text-stone-600">{fmtDate(e.date)}</td>
                    <td className="py-2 text-stone-700">{acc ? acc.name : '-'}</td>
                    <td className="py-2 text-stone-500">{e.description || '-'}</td>
                    <td className="py-2"><Badge>{PAYMENT_METHOD_LABELS[e.paymentMethod]}</Badge></td>
                    <td className="py-2"><Figure value={e.amount} currency={settings.currency} tone="neg" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {showForm && (
        <ExpenseFormModal
          expenseAccounts={expenseAccounts}
          onClose={() => setShowForm(false)}
          onSave={(data) => { onAdd(data); setShowForm(false); }}
        />
      )}
    </div>
  );
}

/* ============================== JOURNAL ============================== */

function ManualJournalFormModal({ accounts, onClose, onSave }) {
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState([
    { rowId: uid('l'), accountId: accounts[0]?.id || '', debit: '', credit: '' },
    { rowId: uid('l'), accountId: accounts[0]?.id || '', debit: '', credit: '' },
  ]);

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;

  const updateLine = (rowId, patch) => setLines(lines.map(l => l.rowId === rowId ? { ...l, ...patch } : l));
  const addLine = () => setLines([...lines, { rowId: uid('l'), accountId: accounts[0]?.id || '', debit: '', credit: '' }]);
  const removeLine = (rowId) => setLines(lines.filter(l => l.rowId !== rowId));

  return (
    <Modal title="قيد يومية يدوي" onClose={onClose} width="max-w-2xl">
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="التاريخ" required>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </Field>
          <Field label="البيان" required>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="وصف القيد" />
          </Field>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm font-body" style={{ minWidth: 480 }}>
            <thead>
              <tr className="text-stone-400 text-xs">
                <th className="text-right py-1.5 font-normal">الحساب</th>
                <th className="text-right py-1.5 font-normal w-28">مدين</th>
                <th className="text-right py-1.5 font-normal w-28">دائن</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l => (
                <tr key={l.rowId}>
                  <td className="py-1 px-1">
                    <Select value={l.accountId} onChange={e => updateLine(l.rowId, { accountId: e.target.value })}>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
                    </Select>
                  </td>
                  <td className="py-1 px-1">
                    <Input type="number" min="0" step="0.01" dir="ltr" value={l.debit} onChange={e => updateLine(l.rowId, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} />
                  </td>
                  <td className="py-1 px-1">
                    <Input type="number" min="0" step="0.01" dir="ltr" value={l.credit} onChange={e => updateLine(l.rowId, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} />
                  </td>
                  <td className="py-1 px-1">
                    {lines.length > 2 && <IconButton icon={Trash2} variant="danger" onClick={() => removeLine(l.rowId)} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button size="sm" variant="outline" icon={Plus} onClick={addLine} className="self-start">إضافة سطر</Button>

        <div className={classNames('flex items-center justify-between text-sm font-body rounded-md px-3 py-2', balanced ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600')}>
          <span>إجمالي مدين: {fmtNum(totalDebit)} | إجمالي دائن: {fmtNum(totalCredit)}</span>
          {balanced ? <span className="flex items-center gap-1"><CheckCircle2 size={15} /> متوازن</span> : <span className="flex items-center gap-1"><AlertTriangle size={15} /> غير متوازن</span>}
        </div>

        <div className="flex justify-end gap-2 mt-1">
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button disabled={!balanced || !description.trim()} icon={Check} onClick={() => onSave({
            date, description, lines: lines.map(l => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })),
          })}>حفظ القيد</Button>
        </div>
      </div>
    </Modal>
  );
}

const SOURCE_LABELS = {
  sales: 'فاتورة مبيعات', purchase: 'فاتورة مشتريات', expense: 'مصروف',
  payment_in: 'دفعة من عميل', payment_out: 'دفعة لمورد', manual: 'قيد يدوي',
};

function JournalView({ journalEntries, accounts, currency, onAddManual }) {
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const sorted = [...journalEntries].sort((a, b) => (a.date < b.date ? 1 : -1) || (a.no < b.no ? 1 : -1));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button icon={Plus} onClick={() => setShowForm(true)}>قيد يدوي جديد</Button>
      </div>
      {sorted.length === 0 ? (
        <Card className="p-4">
          <EmptyState icon={ClipboardList} title="لا توجد قيود بعد" hint="ستظهر هنا القيود المولّدة تلقائيًا من الفواتير، ويمكنك أيضًا إضافة قيود يدوية." />
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map(je => {
            const isOpen = expanded === je.id;
            const totalDebit = je.lines.reduce((s, l) => s + l.debit, 0);
            return (
              <Card key={je.id} className="overflow-hidden">
                <div className="p-3.5 flex items-center justify-between gap-3 cursor-pointer" onClick={() => setExpanded(isOpen ? null : je.id)}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    {isOpen ? <ChevronDown size={15} className="text-stone-400 shrink-0" /> : <ChevronRight size={15} className="text-stone-400 shrink-0" />}
                    <span className="text-sm font-body text-stone-500 shrink-0">#{je.no}</span>
                    <span className="text-sm font-body text-stone-700 truncate">{je.description}</span>
                    <Badge>{SOURCE_LABELS[je.sourceType] || je.sourceType}</Badge>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-sm font-body">
                    <span className="text-stone-400 hidden sm:inline">{fmtDate(je.date)}</span>
                    <Figure value={totalDebit} currency={currency} />
                  </div>
                </div>
                {isOpen && (
                  <div className="border-t border-stone-100 p-3.5">
                    <table className="w-full text-sm font-body">
                      <thead>
                        <tr className="text-stone-400 text-xs">
                          <th className="text-right py-1 font-normal">الحساب</th>
                          <th className="text-right py-1 font-normal">مدين</th>
                          <th className="text-right py-1 font-normal">دائن</th>
                        </tr>
                      </thead>
                      <tbody>
                        {je.lines.map((l, i) => {
                          const acc = accounts.find(a => a.id === l.accountId);
                          return (
                            <tr key={i} className="border-t border-stone-50">
                              <td className="py-1 text-stone-600">{acc ? `${acc.code} - ${acc.name}` : '-'}</td>
                              <td className="py-1">{l.debit > 0 ? <Figure value={l.debit} currency={currency} /> : '-'}</td>
                              <td className="py-1">{l.credit > 0 ? <Figure value={l.credit} currency={currency} /> : '-'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {showForm && (
        <ManualJournalFormModal
          accounts={accounts}
          onClose={() => setShowForm(false)}
          onSave={(data) => { onAddManual(data); setShowForm(false); }}
        />
      )}
    </div>
  );
}

/* ============================== DISTRIBUTORS / REPS & COMMISSIONS ============================== */

function RepFormModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState(initial || { name: '', phone: '', commissionPercent: 2 });
  const canSave = form.name.trim() && form.commissionPercent !== '';
  return (
    <Modal title={initial ? 'تعديل مندوب' : 'مندوب جديد'} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="اسم المندوب" required>
          <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="رقم الهاتف">
          <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} dir="ltr" placeholder="9665xxxxxxxx" />
        </Field>
        <Field label="نسبة العمولة (%)" required hint="من صافي كل فاتورة (بعد الخصم، قبل الضريبة) يتم بيعها بواسطته">
          <Input type="number" min="0" step="0.1" dir="ltr" value={form.commissionPercent} onChange={e => setForm(f => ({ ...f, commissionPercent: e.target.value }))} />
        </Field>
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button disabled={!canSave} icon={Check} onClick={() => onSave({ ...form, commissionPercent: Number(form.commissionPercent) })}>حفظ</Button>
        </div>
      </div>
    </Modal>
  );
}

function RepsView({ reps, salesInvoices, currency, onAdd, onUpdate, onDelete }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1, 2)}-01`;

  const repInvoices = (repId) => salesInvoices.filter(inv => inv.repId === repId);
  const repMonthStats = (repId) => {
    const list = repInvoices(repId).filter(inv => inv.date >= monthStart);
    return {
      count: list.length,
      sales: list.reduce((s, inv) => s + inv.total, 0),
      commission: list.reduce((s, inv) => s + (inv.commissionAmount || 0), 0),
    };
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-body text-stone-500">لوحة المندوبين تربط كل عملية بيع بعمولة فورية - أساس نظام "الأداء مقابل الدخل".</p>
        <Button icon={Plus} onClick={() => { setEditing(null); setShowForm(true); }}>مندوب جديد</Button>
      </div>

      {reps.length === 0 ? (
        <Card className="p-4">
          <EmptyState icon={Users} title="لا يوجد مندوبون بعد" hint="أضف مندوبي المبيعات لتفعيل احتساب العمولة التلقائي على كل فاتورة." />
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {reps.map(rep => {
            const stats = repMonthStats(rep.id);
            const isOpen = expanded === rep.id;
            return (
              <Card key={rep.id} className="overflow-hidden">
                <div className="p-4 flex items-center justify-between gap-3 cursor-pointer" onClick={() => setExpanded(isOpen ? null : rep.id)}>
                  <div className="flex items-center gap-3 min-w-0">
                    {isOpen ? <ChevronDown size={16} className="text-stone-400 shrink-0" /> : <ChevronRight size={16} className="text-stone-400 shrink-0" />}
                    <div className="min-w-0">
                      <p className="font-body font-medium text-stone-800">{rep.name}</p>
                      <p className="text-xs text-stone-400 font-body">عمولة {rep.commissionPercent}% لكل فاتورة</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-left">
                      <p className="text-xs text-stone-400 font-body">عمولة هذا الشهر</p>
                      <Figure value={stats.commission} currency={currency} className="text-emerald-700 font-semibold" />
                    </div>
                    <IconButton icon={Pencil} title="تعديل" onClick={(e) => { e.stopPropagation(); setEditing(rep); setShowForm(true); }} />
                    <IconButton icon={Trash2} variant="danger" title="حذف" onClick={(e) => { e.stopPropagation(); setConfirmDel(rep); }} />
                  </div>
                </div>
                {isOpen && (
                  <div className="border-t border-stone-100 p-4">
                    <div className="grid grid-cols-3 gap-3 mb-3">
                      <div><p className="text-xs text-stone-400 font-body">عدد الفواتير</p><p className="font-body font-medium">{stats.count}</p></div>
                      <div><p className="text-xs text-stone-400 font-body">إجمالي المبيعات</p><Figure value={stats.sales} currency={currency} /></div>
                      <div><p className="text-xs text-stone-400 font-body">العمولة المستحقة</p><Figure value={stats.commission} currency={currency} tone="pos" /></div>
                    </div>
                    {repInvoices(rep.id).length === 0 ? (
                      <p className="text-sm text-stone-400 font-body">لا توجد فواتير لهذا المندوب بعد.</p>
                    ) : (
                      <table className="w-full text-sm font-body">
                        <thead>
                          <tr className="text-stone-400 text-xs">
                            <th className="text-right py-1.5 font-normal">رقم</th>
                            <th className="text-right py-1.5 font-normal">التاريخ</th>
                            <th className="text-right py-1.5 font-normal">قيمة الفاتورة</th>
                            <th className="text-right py-1.5 font-normal">العمولة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...repInvoices(rep.id)].sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 20).map(inv => (
                            <tr key={inv.id} className="border-t border-stone-50">
                              <td className="py-1.5 text-stone-500">#{inv.no}</td>
                              <td className="py-1.5 text-stone-500">{fmtDate(inv.date)}</td>
                              <td className="py-1.5"><Figure value={inv.total} currency={currency} /></td>
                              <td className="py-1.5"><Figure value={inv.commissionAmount || 0} currency={currency} tone="pos" /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {showForm && (
        <RepFormModal
          initial={editing}
          onClose={() => setShowForm(false)}
          onSave={(form) => { if (editing) onUpdate({ ...editing, ...form }); else onAdd(form); setShowForm(false); }}
        />
      )}

      {confirmDel && (
        <ConfirmDialog
          title="حذف مندوب"
          message={`هل تريد حذف "${confirmDel.name}"؟ الفواتير السابقة المرتبطة به تبقى محفوظة في السجل.`}
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => { onDelete(confirmDel.id); setConfirmDel(null); }}
        />
      )}
    </div>
  );
}

/* ============================== RECURRING INVOICES ============================== */

function RecurringFormModal({ customers, products, reps, settings, onClose, onSave }) {
  const [name, setName] = useState('');
  const [customerId, setCustomerId] = useState(customers[0]?.id || '');
  const [items, setItems] = useState([emptyItem()]);
  const [discount, setDiscount] = useState(0);
  const [applyTax, setApplyTax] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState('credit');
  const [frequency, setFrequency] = useState('monthly');
  const [startDate, setStartDate] = useState(todayISO());
  const [repId, setRepId] = useState('');

  const validItems = items.filter(it => (it.name || products.find(p => p.id === it.productId)) && Number(it.qty) > 0);
  const totals = computeInvoiceTotals(validItems, discount, applyTax, settings.taxRate);
  const canSave = customerId && validItems.length > 0 && totals.total > 0 && name.trim();

  return (
    <Modal title="فاتورة دورية جديدة" onClose={onClose} width="max-w-2xl">
      <div className="flex flex-col gap-3">
        {customers.length === 0 ? (
          <p className="text-sm font-body text-rose-600">أضف عميلاً واحدًا على الأقل أولاً.</p>
        ) : (
          <>
            <Field label="اسم/وصف الاشتراك" required hint="مثال: اشتراك شهري - صيانة">
              <Input value={name} onChange={e => setName(e.target.value)} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="العميل" required>
                <Select value={customerId} onChange={e => setCustomerId(e.target.value)}>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="التكرار" required>
                <Select value={frequency} onChange={e => setFrequency(e.target.value)}>
                  <option value="weekly">أسبوعي</option>
                  <option value="monthly">شهري</option>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="تاريخ أول إصدار" required>
                <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </Field>
              <Field label="طريقة الدفع" required>
                <Select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                  <option value="credit">آجل (على حساب العميل)</option>
                  <option value="cash">نقدي (الصندوق)</option>
                  <option value="bank">تحويل بنكي</option>
                </Select>
              </Field>
            </div>
            {reps.length > 0 && (
              <Field label="المندوب" hint="اختياري - لاحتساب العمولة تلقائيًا">
                <Select value={repId} onChange={e => setRepId(e.target.value)}>
                  <option value="">بدون مندوب</option>
                  {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              </Field>
            )}
            <div>
              <p className="text-sm font-body text-stone-600 mb-1">بنود الفاتورة (تتكرر كما هي في كل مرة)</p>
              <ItemsEditor items={items} setItems={setItems} products={products} currency={settings.currency} priceLabel="سعر البيع" />
            </div>
            <InvoiceTotalsBox totals={totals} currency={settings.currency} discount={discount} setDiscount={setDiscount} applyTax={applyTax} setApplyTax={setApplyTax} taxRate={settings.taxRate} />
            <div className="flex justify-end gap-2 mt-1">
              <Button variant="secondary" onClick={onClose}>إلغاء</Button>
              <Button disabled={!canSave} icon={Check} onClick={() => onSave({
                name, customerId, frequency, nextRunDate: startDate, paymentMethod, repId: repId || null,
                discount: Number(discount) || 0, applyTax,
                items: validItems.map(it => ({
                  productId: it.productId || null,
                  name: it.name || (products.find(p => p.id === it.productId)?.name) || 'بند',
                  qty: Number(it.qty), price: Number(it.price) || 0, cost: Number(it.cost) || 0,
                })),
              })}>حفظ الفاتورة الدورية</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function RecurringInvoicesView({ templates, customers, products, reps, settings, onAdd, onToggle, onDelete }) {
  const [showForm, setShowForm] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-body text-stone-500">تُصدر هذه الفواتير نفسها تلقائيًا في موعدها في كل مرة تفتح فيها النظام.</p>
        <Button icon={Plus} onClick={() => setShowForm(true)}>فاتورة دورية جديدة</Button>
      </div>

      {templates.length === 0 ? (
        <Card className="p-4">
          <EmptyState icon={FileText} title="لا توجد فواتير دورية بعد" hint="أنشئ اشتراكًا متكررًا لعميل ثابت (شهري أو أسبوعي) ليصدر تلقائيًا." />
        </Card>
      ) : (
        <Card className="overflow-x-auto p-4">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="text-stone-400 text-xs border-b border-stone-100">
                <th className="text-right py-2 font-normal">الاسم</th>
                <th className="text-right py-2 font-normal">العميل</th>
                <th className="text-right py-2 font-normal">التكرار</th>
                <th className="text-right py-2 font-normal">الإصدار القادم</th>
                <th className="text-right py-2 font-normal">الحالة</th>
                <th className="text-right py-2 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {templates.map(t => {
                const cust = customers.find(c => c.id === t.customerId);
                return (
                  <tr key={t.id} className="border-b border-stone-50">
                    <td className="py-2 text-stone-700">{t.name}</td>
                    <td className="py-2 text-stone-600">{cust ? cust.name : '-'}</td>
                    <td className="py-2">{t.frequency === 'monthly' ? 'شهري' : 'أسبوعي'}</td>
                    <td className="py-2 text-stone-600">{fmtDate(t.nextRunDate)}</td>
                    <td className="py-2">
                      <button onClick={() => onToggle(t.id)}>
                        <Badge tone={t.active ? 'green' : 'neutral'}>{t.active ? 'مفعّلة' : 'موقوفة'}</Badge>
                      </button>
                    </td>
                    <td className="py-2"><IconButton icon={Trash2} variant="danger" title="حذف" onClick={() => setConfirmDel(t)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {showForm && (
        <RecurringFormModal
          customers={customers} products={products} reps={reps} settings={settings}
          onClose={() => setShowForm(false)}
          onSave={(data) => { onAdd(data); setShowForm(false); }}
        />
      )}

      {confirmDel && (
        <ConfirmDialog
          title="حذف فاتورة دورية"
          message={`هل تريد إيقاف وحذف "${confirmDel.name}"؟ الفواتير الصادرة سابقًا منها تبقى محفوظة.`}
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => { onDelete(confirmDel.id); setConfirmDel(null); }}
        />
      )}
    </div>
  );
}

/* ============================== COLLECTIONS REMINDERS (WhatsApp) ============================== */

function ReminderCard({ item, settings, onCopy }) {
  const { invoice, customer, stage } = item;
  const message = composeReminderMessage(stage, invoice, customer, settings.companyName, settings.currency);
  const tone = stage.stage === 'overdue' ? 'red' : stage.stage === 'due_today' ? 'amber' : 'blue';
  const label = stage.stage === 'overdue' ? `متأخرة ${stage.daysOverdue} يوم` : stage.stage === 'due_today' ? 'مستحقة اليوم' : `مستحقة خلال ${stage.daysToDue} يوم`;
  const hasPhone = !!(customer && customer.phone);

  return (
    <Card className="p-4 flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <p className="font-body font-medium text-stone-800">{customer ? customer.name : 'عميل نقدي'}</p>
        <Badge tone={tone}>{label}</Badge>
      </div>
      <div className="flex items-center justify-between text-sm font-body text-stone-500">
        <span>فاتورة #{invoice.no}</span>
        <Figure value={invoice.total - invoice.paidAmount} currency={settings.currency} tone="neg" />
      </div>
      <p className="text-sm font-body text-stone-600 bg-stone-50 rounded-md p-2.5 leading-relaxed">{message}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" icon={Check} onClick={() => onCopy(message)}>نسخ الرسالة</Button>
        {hasPhone ? (
          <a href={buildWhatsAppLink(customer.phone, message)} target="_blank" rel="noreferrer" className="flex-1">
            <Button size="sm" className="w-full">إرسال عبر واتساب</Button>
          </a>
        ) : (
          <span className="text-xs text-stone-400 font-body self-center">لا يوجد رقم هاتف محفوظ لهذا العميل</span>
        )}
      </div>
    </Card>
  );
}

function RemindersView({ salesInvoices, customers, settings, showToast }) {
  const today = todayISO();
  const items = salesInvoices
    .map(invoice => {
      const stage = reminderStage(invoice, settings, today);
      if (!stage) return null;
      const customer = customers.find(c => c.id === invoice.customerId);
      return { invoice, customer, stage };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const order = { overdue: 0, due_today: 1, upcoming: 2 };
      return order[a.stage.stage] - order[b.stage.stage];
    });

  const overdue = items.filter(i => i.stage.stage === 'overdue');
  const dueToday = items.filter(i => i.stage.stage === 'due_today');
  const upcoming = items.filter(i => i.stage.stage === 'upcoming');

  function copy(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => showToast('تم نسخ الرسالة'));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm font-body text-stone-500">
        النظام يجهّز الرسالة المناسبة تلقائيًا حسب المرحلة، وتبقى لك خطوة أخيرة بضغطة واحدة لإرسالها عبر واتساب.
      </p>

      {items.length === 0 ? (
        <Card className="p-4"><EmptyState icon={Users} title="لا توجد تذكيرات مستحقة الآن" hint="ستظهر هنا تلقائيًا فواتير العملاء القريبة من الاستحقاق أو المتأخرة." /></Card>
      ) : (
        <>
          {overdue.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="font-display font-semibold text-rose-700 text-sm flex items-center gap-1.5"><AlertTriangle size={15} /> متأخرة السداد ({overdue.length})</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {overdue.map(item => <ReminderCard key={item.invoice.id} item={item} settings={settings} onCopy={copy} />)}
              </div>
            </div>
          )}
          {dueToday.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="font-display font-semibold text-amber-700 text-sm">مستحقة اليوم ({dueToday.length})</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {dueToday.map(item => <ReminderCard key={item.invoice.id} item={item} settings={settings} onCopy={copy} />)}
              </div>
            </div>
          )}
          {upcoming.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="font-display font-semibold text-sky-700 text-sm">تذكير مبكر ({upcoming.length})</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {upcoming.map(item => <ReminderCard key={item.invoice.id} item={item} settings={settings} onCopy={copy} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ============================== DEMAND FORECAST ============================== */

function ForecastView({ products, salesInvoices, currency }) {
  const today = todayISO();
  const forecast = computeForecast(products, salesInvoices, today, 90);
  const urgent = forecast.filter(f => f.coverageWeeks < 2);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-body text-stone-500">
        يحلل النظام معدل بيع كل منتج خلال آخر 3 أشهر ويقترح كمية إعادة الطلب لتغطية أسبوعين قادمين، لتجنب نفاد المخزون.
      </p>

      {urgent.length > 0 && (
        <Card className="p-4 border-amber-300">
          <p className="font-display font-semibold text-amber-700 text-sm mb-2 flex items-center gap-1.5"><AlertTriangle size={15} /> يُنصح بالطلب قريبًا</p>
          <ul className="flex flex-col gap-1.5 font-body text-sm text-stone-700">
            {urgent.map(f => (
              <li key={f.product.id}>
                بناءً على مبيعاتك خلال آخر 3 أشهر، يُنصح بطلب <strong>{f.suggestedOrder}</strong> {f.product.unit} من <strong>{f.product.name}</strong> خلال الأسبوع القادم لتجنب انقطاعه (المخزون الحالي يغطي تقريبًا {f.coverageWeeks.toFixed(1)} أسبوع فقط).
              </li>
            ))}
          </ul>
        </Card>
      )}

      {forecast.length === 0 ? (
        <Card className="p-4"><EmptyState icon={Package} title="لا توجد بيانات مبيعات كافية بعد" hint="بعد تسجيل بعض فواتير المبيعات، ستظهر هنا توقعات الطلب لكل منتج." /></Card>
      ) : (
        <Card className="overflow-x-auto p-4">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="text-stone-400 text-xs border-b border-stone-100">
                <th className="text-right py-2 font-normal">المنتج</th>
                <th className="text-right py-2 font-normal">مبيعات آخر 3 أشهر</th>
                <th className="text-right py-2 font-normal">متوسط أسبوعي</th>
                <th className="text-right py-2 font-normal">المخزون الحالي</th>
                <th className="text-right py-2 font-normal">مدة التغطية</th>
                <th className="text-right py-2 font-normal">كمية مقترح طلبها</th>
              </tr>
            </thead>
            <tbody>
              {forecast.map(f => (
                <tr key={f.product.id} className="border-b border-stone-50">
                  <td className="py-2 text-stone-700">{f.product.name}</td>
                  <td className="py-2"><Figure value={f.totalSold} /></td>
                  <td className="py-2"><Figure value={f.weeklyAvg} /></td>
                  <td className="py-2">{f.product.qty} {f.product.unit}</td>
                  <td className="py-2">
                    <Badge tone={f.coverageWeeks < 2 ? 'red' : f.coverageWeeks < 4 ? 'amber' : 'green'}>
                      {f.coverageWeeks === Infinity ? '-' : `${f.coverageWeeks.toFixed(1)} أسبوع`}
                    </Badge>
                  </td>
                  <td className="py-2">{f.suggestedOrder > 0 ? <span className="font-medium text-emerald-700">{f.suggestedOrder} {f.product.unit}</span> : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

/* ============================== REPORTS ============================== */

function TrialBalanceReport({ accounts, journalEntries, currency, from, to }) {
  const entries = filterEntriesByDate(journalEntries, from, to);
  const rows = accounts.map(acc => {
    const { debit, credit } = accountBalance(acc, entries);
    return { acc, debit, credit };
  }).filter(r => r.debit !== 0 || r.credit !== 0);
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005;

  return (
    <Card className="p-4 overflow-x-auto">
      <table className="w-full text-sm font-body">
        <thead>
          <tr className="text-stone-400 text-xs border-b border-stone-100">
            <th className="text-right py-2 font-normal">الرمز</th>
            <th className="text-right py-2 font-normal">الحساب</th>
            <th className="text-right py-2 font-normal">مدين</th>
            <th className="text-right py-2 font-normal">دائن</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.acc.id} className="border-b border-stone-50">
              <td className="py-2 text-stone-500">{r.acc.code}</td>
              <td className="py-2 text-stone-700">{r.acc.name}</td>
              <td className="py-2"><Figure value={r.debit} currency={currency} /></td>
              <td className="py-2"><Figure value={r.credit} currency={currency} /></td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={4} className="py-6 text-center text-stone-400 text-xs">لا توجد حركات في هذه الفترة</td></tr>
          )}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-stone-200 font-semibold">
              <td className="py-2" colSpan={2}>الإجمالي</td>
              <td className="py-2"><Figure value={totalDebit} currency={currency} /></td>
              <td className="py-2"><Figure value={totalCredit} currency={currency} /></td>
            </tr>
          </tfoot>
        )}
      </table>
      {rows.length > 0 && (
        <div className={classNames('mt-3 flex items-center gap-1.5 text-xs font-body px-3 py-1.5 rounded-md w-fit', balanced ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600')}>
          {balanced ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          {balanced ? 'ميزان المراجعة متوازن' : 'ميزان المراجعة غير متوازن - تحقق من القيود'}
        </div>
      )}
    </Card>
  );
}

function IncomeStatementReport({ accounts, journalEntries, currency, from, to }) {
  const entries = filterEntriesByDate(journalEntries, from, to);
  const revenues = accounts.filter(a => a.type === 'revenue').map(a => ({ acc: a, bal: accountBalance(a, entries).balance })).filter(r => r.bal !== 0);
  const expenses = accounts.filter(a => a.type === 'expense').map(a => ({ acc: a, bal: accountBalance(a, entries).balance })).filter(r => r.bal !== 0);
  const totalRev = revenues.reduce((s, r) => s + r.bal, 0);
  const totalExp = expenses.reduce((s, r) => s + r.bal, 0);
  const net = totalRev - totalExp;

  return (
    <Card className="p-4">
      <p className="font-display font-semibold text-stone-700 mb-3 text-sm">الإيرادات</p>
      <table className="w-full text-sm font-body mb-4">
        <tbody>
          {revenues.map(r => (
            <tr key={r.acc.id} className="border-b border-stone-50">
              <td className="py-1.5 text-stone-600">{r.acc.name}</td>
              <td className="py-1.5 text-left"><Figure value={r.bal} currency={currency} /></td>
            </tr>
          ))}
          {revenues.length === 0 && <tr><td className="py-2 text-stone-400 text-xs">لا توجد إيرادات في هذه الفترة</td></tr>}
        </tbody>
        <tfoot><tr className="font-semibold border-t border-stone-200"><td className="py-1.5">إجمالي الإيرادات</td><td className="py-1.5 text-left"><Figure value={totalRev} currency={currency} tone="pos" /></td></tr></tfoot>
      </table>

      <p className="font-display font-semibold text-stone-700 mb-3 text-sm">المصاريف</p>
      <table className="w-full text-sm font-body mb-4">
        <tbody>
          {expenses.map(r => (
            <tr key={r.acc.id} className="border-b border-stone-50">
              <td className="py-1.5 text-stone-600">{r.acc.name}</td>
              <td className="py-1.5 text-left"><Figure value={r.bal} currency={currency} /></td>
            </tr>
          ))}
          {expenses.length === 0 && <tr><td className="py-2 text-stone-400 text-xs">لا توجد مصاريف في هذه الفترة</td></tr>}
        </tbody>
        <tfoot><tr className="font-semibold border-t border-stone-200"><td className="py-1.5">إجمالي المصاريف</td><td className="py-1.5 text-left"><Figure value={totalExp} currency={currency} tone="neg" /></td></tr></tfoot>
      </table>

      <div className={classNames('flex items-center justify-between text-base font-body font-semibold px-3 py-2.5 rounded-md', net >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600')}>
        <span>{net >= 0 ? 'صافي الربح' : 'صافي الخسارة'}</span>
        <Figure value={Math.abs(net)} currency={currency} />
      </div>
    </Card>
  );
}

function BalanceSheetReport({ accounts, journalEntries, currency, to }) {
  const entries = filterEntriesByDate(journalEntries, '', to);
  const assets = accounts.filter(a => a.type === 'asset').map(a => ({ acc: a, bal: accountBalance(a, entries).balance })).filter(r => r.bal !== 0);
  const liabilities = accounts.filter(a => a.type === 'liability').map(a => ({ acc: a, bal: accountBalance(a, entries).balance })).filter(r => r.bal !== 0);
  const equity = accounts.filter(a => a.type === 'equity').map(a => ({ acc: a, bal: accountBalance(a, entries).balance })).filter(r => r.bal !== 0);

  let revTotal = 0, expTotal = 0;
  accounts.forEach(a => {
    const bal = accountBalance(a, entries).balance;
    if (a.type === 'revenue') revTotal += bal;
    if (a.type === 'expense') expTotal += bal;
  });
  const currentProfit = revTotal - expTotal;

  const totalAssets = assets.reduce((s, r) => s + r.bal, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.bal, 0);
  const totalEquity = equity.reduce((s, r) => s + r.bal, 0) + currentProfit;
  const balanced = Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.005;

  const Section = ({ title, rows, extra, total }) => (
    <div className="mb-4">
      <p className="font-display font-semibold text-stone-700 mb-2 text-sm">{title}</p>
      <table className="w-full text-sm font-body">
        <tbody>
          {rows.map(r => (
            <tr key={r.acc.id} className="border-b border-stone-50">
              <td className="py-1.5 text-stone-600">{r.acc.name}</td>
              <td className="py-1.5 text-left"><Figure value={r.bal} currency={currency} /></td>
            </tr>
          ))}
          {extra && (
            <tr className="border-b border-stone-50">
              <td className="py-1.5 text-stone-600">{extra.label}</td>
              <td className="py-1.5 text-left"><Figure value={extra.value} currency={currency} /></td>
            </tr>
          )}
        </tbody>
        <tfoot><tr className="font-semibold border-t border-stone-200"><td className="py-1.5">الإجمالي</td><td className="py-1.5 text-left"><Figure value={total} currency={currency} /></td></tr></tfoot>
      </table>
    </div>
  );

  return (
    <Card className="p-4">
      <Section title="الأصول" rows={assets} total={totalAssets} />
      <Section title="الخصوم" rows={liabilities} total={totalLiabilities} />
      <Section title="حقوق الملكية" rows={equity} extra={{ label: 'أرباح الفترة الحالية (غير مرحّلة)', value: currentProfit }} total={totalEquity} />
      <div className={classNames('flex items-center justify-between text-sm font-body px-3 py-2 rounded-md', balanced ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600')}>
        <span>الأصول: {fmtNum(totalAssets)} {currency} | الخصوم + حقوق الملكية: {fmtNum(totalLiabilities + totalEquity)} {currency}</span>
        {balanced ? <span className="flex items-center gap-1"><CheckCircle2 size={14} /> متوازنة</span> : <span className="flex items-center gap-1"><AlertTriangle size={14} /> غير متوازنة</span>}
      </div>
    </Card>
  );
}

function ReportsView({ accounts, journalEntries, currency }) {
  const [tab, setTab] = useState('trial');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(todayISO());

  const tabs = [
    { key: 'trial', label: 'ميزان المراجعة' },
    { key: 'income', label: 'قائمة الدخل' },
    { key: 'balance', label: 'الميزانية العمومية' },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={classNames(
            'px-3.5 py-1.5 rounded-full text-sm font-body transition-colors',
            tab === t.key ? 'bg-emerald-700 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
          )}>{t.label}</button>
        ))}
        <div className="flex items-center gap-2 ms-auto">
          {tab !== 'balance' && (
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-auto" />
          )}
          <span className="text-xs text-stone-400 font-body">إلى</span>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-auto" />
        </div>
      </div>

      {tab === 'trial' && <TrialBalanceReport accounts={accounts} journalEntries={journalEntries} currency={currency} from={from} to={to} />}
      {tab === 'income' && <IncomeStatementReport accounts={accounts} journalEntries={journalEntries} currency={currency} from={from} to={to} />}
      {tab === 'balance' && <BalanceSheetReport accounts={accounts} journalEntries={journalEntries} currency={currency} to={to} />}
    </div>
  );
}

/* ============================== SETTINGS ============================== */

function SettingsView({ settings, onSave, onResetAll }) {
  const [form, setForm] = useState(settings);
  const [confirmReset, setConfirmReset] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(settings);

  return (
    <div className="flex flex-col gap-4 max-w-lg">
      <Card className="p-4 flex flex-col gap-3">
        <p className="font-display font-semibold text-stone-700 text-sm">بيانات عامة</p>
        <Field label="اسم المنشأة" required>
          <Input value={form.companyName} onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))} />
        </Field>
        <Field label="رمز العملة" required>
          <Input value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} />
        </Field>
        <Field label="نسبة ضريبة القيمة المضافة الافتراضية (%)" required>
          <Input type="number" min="0" step="0.1" dir="ltr" value={form.taxRate} onChange={e => setForm(f => ({ ...f, taxRate: Number(e.target.value) }))} />
        </Field>
      </Card>

      <Card className="p-4 flex flex-col gap-3">
        <label className="flex items-center justify-between">
          <p className="font-display font-semibold text-stone-700 text-sm">برنامج عملاء VIP التلقائي</p>
          <input type="checkbox" checked={form.vipEnabled} onChange={e => setForm(f => ({ ...f, vipEnabled: e.target.checked }))} />
        </label>
        <p className="text-xs text-stone-400 font-body -mt-2">عندما تتجاوز مشتريات العميل خلال آخر 30 يومًا هذا المبلغ، يُصنَّف VIP تلقائيًا ويُفعَّل له خصم في فواتيره القادمة دون تدخل بشري.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`الحد الشهري (${form.currency})`}>
            <Input type="number" min="0" step="1000" dir="ltr" value={form.vipMonthlyThreshold} onChange={e => setForm(f => ({ ...f, vipMonthlyThreshold: Number(e.target.value) }))} />
          </Field>
          <Field label="نسبة الخصم التلقائي (%)">
            <Input type="number" min="0" step="0.1" dir="ltr" value={form.vipDiscountPercent} onChange={e => setForm(f => ({ ...f, vipDiscountPercent: Number(e.target.value) }))} />
          </Field>
        </div>
      </Card>

      <Card className="p-4 flex flex-col gap-3">
        <p className="font-display font-semibold text-stone-700 text-sm">الآجل والتحصيل والجدارة الائتمانية</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="مهلة السداد الافتراضية (أيام)" hint="تُستخدم لحساب تاريخ استحقاق كل فاتورة آجلة">
            <Input type="number" min="1" step="1" dir="ltr" value={form.defaultPaymentTermsDays} onChange={e => setForm(f => ({ ...f, defaultPaymentTermsDays: Number(e.target.value) }))} />
          </Field>
          <Field label="التذكير المبكر قبل الاستحقاق بـ (أيام)">
            <Input type="number" min="1" step="1" dir="ltr" value={form.reminderBeforeDays} onChange={e => setForm(f => ({ ...f, reminderBeforeDays: Number(e.target.value) }))} />
          </Field>
          <Field label="عدد الفواتير المتأخرة لحظر الآجل" hint="إذا وصل عدد فواتير العميل المتأخرة لهذا الرقم يُمنع البيع له آجلاً">
            <Input type="number" min="1" step="1" dir="ltr" value={form.overdueBlockCount} onChange={e => setForm(f => ({ ...f, overdueBlockCount: Number(e.target.value) }))} />
          </Field>
          <Field label="أيام التأخر لحظر الآجل" hint="أو إذا تجاوز تأخر أي فاتورة هذا العدد من الأيام">
            <Input type="number" min="1" step="1" dir="ltr" value={form.overdueBlockThresholdDays} onChange={e => setForm(f => ({ ...f, overdueBlockThresholdDays: Number(e.target.value) }))} />
          </Field>
        </div>
      </Card>

      <Card className="p-4 flex flex-col gap-3">
        <p className="font-display font-semibold text-stone-700 text-sm">المندوبون والعمولات</p>
        <Field label="نسبة العمولة الافتراضية للمندوب الجديد (%)">
          <Input type="number" min="0" step="0.1" dir="ltr" value={form.defaultCommissionPercent} onChange={e => setForm(f => ({ ...f, defaultCommissionPercent: Number(e.target.value) }))} />
        </Field>
      </Card>

      <Button disabled={!dirty} icon={Check} onClick={() => onSave(form)} className="self-start">حفظ الإعدادات</Button>

      <Card className="p-4 flex flex-col gap-2 border-rose-200">
        <p className="font-display font-semibold text-rose-700 text-sm">منطقة الخطر</p>
        <p className="text-sm font-body text-stone-500">حذف جميع البيانات المسجلة (الحسابات، الفواتير، القيود، المنتجات) بشكل نهائي.</p>
        <Button variant="danger" icon={Trash2} className="self-start" onClick={() => setConfirmReset(true)}>حذف جميع البيانات</Button>
      </Card>

      {confirmReset && (
        <ConfirmDialog
          title="حذف جميع البيانات"
          message="هذا الإجراء سيحذف كل البيانات المسجلة نهائيًا ولا يمكن التراجع عنه. هل أنت متأكد؟"
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => { onResetAll(); setConfirmReset(false); }}
        />
      )}
    </div>
  );
}

/* ============================== MAIN APP ============================== */

const VIEW_TITLES = {
  dashboard: 'لوحة التحكم', accounts: 'دليل الحسابات', customers: 'العملاء', suppliers: 'الموردون',
  products: 'المنتجات والمخزون', sales: 'فواتير المبيعات', purchases: 'فواتير المشتريات',
  recurring: 'الفواتير الدورية', reminders: 'تذكيرات التحصيل', forecast: 'التنبؤ بالطلب', reps: 'المندوبون والعمولات',
  expenses: 'المصاريف', journal: 'القيود اليومية', reports: 'التقارير المالية', settings: 'الإعدادات',
};

export default function AccountingApp() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [accounts, setAccounts] = useState(DEFAULT_ACCOUNTS);
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [salesInvoices, setSalesInvoices] = useState([]);
  const [purchaseInvoices, setPurchaseInvoices] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [journalEntries, setJournalEntries] = useState([]);
  const [reps, setReps] = useState([]);
  const [recurringTemplates, setRecurringTemplates] = useState([]);

  useEffect(() => {
    (async () => {
      const [s, acc, cust, sup, prod, sales, purch, exp, jour, repsData, recurData] = await Promise.all([
        loadKey(STORAGE_KEYS.settings, null),
        loadKey(STORAGE_KEYS.accounts, null),
        loadKey(STORAGE_KEYS.customers, []),
        loadKey(STORAGE_KEYS.suppliers, []),
        loadKey(STORAGE_KEYS.products, []),
        loadKey(STORAGE_KEYS.sales, []),
        loadKey(STORAGE_KEYS.purchases, []),
        loadKey(STORAGE_KEYS.expenses, []),
        loadKey(STORAGE_KEYS.journal, []),
        loadKey(STORAGE_KEYS.reps, []),
        loadKey(STORAGE_KEYS.recurring, []),
      ]);
      // Merge with defaults so upgrading from an older saved version still has the new fields.
      const finalSettings = { ...DEFAULT_SETTINGS, ...(s || {}) };
      const finalAccounts = acc || DEFAULT_ACCOUNTS.map(a => ({ ...a }));
      const finalReps = repsData || [];
      const finalRecurring = recurData || [];
      const finalSalesRaw = sales || [];
      const finalProductsRaw = prod || [];

      const today = todayISO();
      const result = runRecurringInvoices({
        recurringTemplates: finalRecurring, salesInvoices: finalSalesRaw, products: finalProductsRaw,
        accounts: finalAccounts, journalEntries: jour || [], settings: finalSettings, reps: finalReps, today,
      });

      setSettings(result.settings);
      setAccounts(finalAccounts);
      setCustomers(cust || []);
      setSuppliers(sup || []);
      setProducts(result.products);
      setSalesInvoices(result.salesInvoices);
      setPurchaseInvoices(purch || []);
      setExpenses(exp || []);
      setJournalEntries(result.journalEntries);
      setReps(finalReps);
      setRecurringTemplates(result.recurringTemplates);

      if (!s) saveKey(STORAGE_KEYS.settings, result.settings);
      if (!acc) saveKey(STORAGE_KEYS.accounts, finalAccounts);
      if (result.generatedCount > 0) {
        saveKey(STORAGE_KEYS.settings, result.settings);
        saveKey(STORAGE_KEYS.sales, result.salesInvoices);
        saveKey(STORAGE_KEYS.products, result.products);
        saveKey(STORAGE_KEYS.journal, result.journalEntries);
        saveKey(STORAGE_KEYS.recurring, result.recurringTemplates);
      }
      setLoading(false);
      if (result.generatedCount > 0) {
        setTimeout(() => showToast(`تم إصدار ${result.generatedCount} فاتورة دورية مستحقة تلقائيًا`), 300);
      }
    })();
  }, []);

  function showToast(message, type = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2800);
  }

  async function persist(key, value) {
    const ok = await saveKey(key, value);
    if (!ok) showToast('تعذر حفظ البيانات، حاول مرة أخرى', 'error');
  }

  /* ---------- Accounts ---------- */
  function addAccount(form) {
    const acc = { id: uid('acc'), code: form.code.trim(), name: form.name.trim(), type: form.type, kind: form.type, system: false };
    const next = [...accounts, acc];
    setAccounts(next); persist(STORAGE_KEYS.accounts, next);
    showToast('تمت إضافة الحساب بنجاح');
  }
  function deleteAccount(id) {
    const next = accounts.filter(a => a.id !== id);
    setAccounts(next); persist(STORAGE_KEYS.accounts, next);
    showToast('تم حذف الحساب');
  }

  /* ---------- Customers / Suppliers ---------- */
  function addContact(type, form) {
    const contact = { id: uid(type === 'customer' ? 'cust' : 'sup'), name: form.name.trim(), phone: form.phone || '', notes: form.notes || '' };
    if (type === 'customer') { const next = [...customers, contact]; setCustomers(next); persist(STORAGE_KEYS.customers, next); }
    else { const next = [...suppliers, contact]; setSuppliers(next); persist(STORAGE_KEYS.suppliers, next); }
    showToast('تمت الإضافة بنجاح');
  }
  function updateContact(type, updated) {
    if (type === 'customer') { const next = customers.map(c => c.id === updated.id ? updated : c); setCustomers(next); persist(STORAGE_KEYS.customers, next); }
    else { const next = suppliers.map(c => c.id === updated.id ? updated : c); setSuppliers(next); persist(STORAGE_KEYS.suppliers, next); }
    showToast('تم تحديث البيانات');
  }
  function deleteContact(type, id) {
    if (type === 'customer') { const next = customers.filter(c => c.id !== id); setCustomers(next); persist(STORAGE_KEYS.customers, next); }
    else { const next = suppliers.filter(c => c.id !== id); setSuppliers(next); persist(STORAGE_KEYS.suppliers, next); }
    showToast('تم الحذف');
  }

  /* ---------- Products ---------- */
  function addProduct(form) {
    const p = { id: uid('prod'), ...form };
    const next = [...products, p];
    setProducts(next); persist(STORAGE_KEYS.products, next);
    showToast('تمت إضافة المنتج');
  }
  function updateProduct(updated) {
    const next = products.map(p => p.id === updated.id ? updated : p);
    setProducts(next); persist(STORAGE_KEYS.products, next);
    showToast('تم تحديث المنتج');
  }
  function deleteProduct(id) {
    const next = products.filter(p => p.id !== id);
    setProducts(next); persist(STORAGE_KEYS.products, next);
    showToast('تم حذف المنتج');
  }
  const usedProductIds = useMemo(() => {
    const s = new Set();
    salesInvoices.forEach(inv => inv.items.forEach(it => it.productId && s.add(it.productId)));
    purchaseInvoices.forEach(inv => inv.items.forEach(it => it.productId && s.add(it.productId)));
    return s;
  }, [salesInvoices, purchaseInvoices]);

  /* ---------- Sales Invoice ---------- */
  function addSalesInvoice(data) {
    const totals = computeInvoiceTotals(data.items, data.discount, data.applyTax, settings.taxRate);
    const no = settings.nextSalesNo;
    const invId = uid('sinv');
    const jeNo = settings.nextJournalNo;

    const lines = [];
    if (data.paymentMethod === 'credit') {
      lines.push({ accountId: getAccountByKind(accounts, 'ar').id, debit: totals.total, credit: 0 });
    } else {
      const cashAcc = getCashLikeAccountId(accounts, data.paymentMethod);
      lines.push({ accountId: cashAcc, debit: totals.total, credit: 0 });
    }
    lines.push({ accountId: getAccountByKind(accounts, 'sales_revenue').id, debit: 0, credit: totals.afterDiscount });
    if (totals.tax > 0) lines.push({ accountId: getAccountByKind(accounts, 'vat_out').id, debit: 0, credit: totals.tax });
    if (totals.cost > 0) {
      lines.push({ accountId: getAccountByKind(accounts, 'cogs').id, debit: totals.cost, credit: 0 });
      lines.push({ accountId: getAccountByKind(accounts, 'inventory').id, debit: 0, credit: totals.cost });
    }
    const je = makeEntry(jeNo, data.date, `فاتورة مبيعات #${no}`, lines, 'sales', invId);

    const rep = data.repId ? reps.find(r => r.id === data.repId) : null;
    const commissionAmount = rep ? totals.afterDiscount * (Number(rep.commissionPercent) || 0) / 100 : 0;

    const invoice = {
      id: invId, no, date: data.date, customerId: data.customerId, items: data.items,
      discount: data.discount, subtotal: totals.subtotal, tax: totals.tax, total: totals.total,
      paymentMethod: data.paymentMethod, paidAmount: data.paymentMethod === 'credit' ? 0 : totals.total,
      journalId: je.id, dueDate: data.dueDate || addDays(data.date, settings.defaultPaymentTermsDays),
      repId: data.repId || null, commissionAmount, isVipSale: !!data.isVipSale,
    };

    const nextProducts = products.map(p => {
      const item = data.items.find(it => it.productId === p.id);
      return item ? { ...p, qty: Number(p.qty) - Number(item.qty) } : p;
    });
    const nextSettings = { ...settings, nextSalesNo: no + 1, nextJournalNo: jeNo + 1 };
    const nextJournal = [...journalEntries, je];
    const nextSales = [...salesInvoices, invoice];

    setSalesInvoices(nextSales); setProducts(nextProducts); setJournalEntries(nextJournal); setSettings(nextSettings);
    persist(STORAGE_KEYS.sales, nextSales);
    persist(STORAGE_KEYS.products, nextProducts);
    persist(STORAGE_KEYS.journal, nextJournal);
    persist(STORAGE_KEYS.settings, nextSettings);
    showToast(`تم حفظ فاتورة المبيعات #${no}`);
  }

  /* ---------- Purchase Invoice ---------- */
  function addPurchaseInvoice(data) {
    const totals = computeInvoiceTotals(data.items, data.discount, data.applyTax, settings.taxRate);
    const no = settings.nextPurchaseNo;
    const invId = uid('pinv');
    const jeNo = settings.nextJournalNo;

    const lines = [];
    lines.push({ accountId: getAccountByKind(accounts, 'inventory').id, debit: totals.afterDiscount, credit: 0 });
    if (totals.tax > 0) lines.push({ accountId: getAccountByKind(accounts, 'vat_in').id, debit: totals.tax, credit: 0 });
    if (data.paymentMethod === 'credit') {
      lines.push({ accountId: getAccountByKind(accounts, 'ap').id, debit: 0, credit: totals.total });
    } else {
      const cashAcc = getCashLikeAccountId(accounts, data.paymentMethod);
      lines.push({ accountId: cashAcc, debit: 0, credit: totals.total });
    }
    const je = makeEntry(jeNo, data.date, `فاتورة مشتريات #${no}`, lines, 'purchase', invId);

    const invoice = {
      id: invId, no, date: data.date, supplierId: data.supplierId, items: data.items,
      discount: data.discount, subtotal: totals.subtotal, tax: totals.tax, total: totals.total,
      paymentMethod: data.paymentMethod, paidAmount: data.paymentMethod === 'credit' ? 0 : totals.total,
      journalId: je.id,
    };

    const nextProducts = products.map(p => {
      const item = data.items.find(it => it.productId === p.id);
      return item ? { ...p, qty: Number(p.qty) + Number(item.qty), costPrice: Number(item.price) } : p;
    });
    const nextSettings = { ...settings, nextPurchaseNo: no + 1, nextJournalNo: jeNo + 1 };
    const nextJournal = [...journalEntries, je];
    const nextPurchases = [...purchaseInvoices, invoice];

    setPurchaseInvoices(nextPurchases); setProducts(nextProducts); setJournalEntries(nextJournal); setSettings(nextSettings);
    persist(STORAGE_KEYS.purchases, nextPurchases);
    persist(STORAGE_KEYS.products, nextProducts);
    persist(STORAGE_KEYS.journal, nextJournal);
    persist(STORAGE_KEYS.settings, nextSettings);
    showToast(`تم حفظ فاتورة المشتريات #${no}`);
  }

  /* ---------- Expenses ---------- */
  function addExpense(data) {
    const jeNo = settings.nextJournalNo;
    const cashAcc = getCashLikeAccountId(accounts, data.paymentMethod);
    const lines = [
      { accountId: data.accountId, debit: data.amount, credit: 0 },
      { accountId: cashAcc, debit: 0, credit: data.amount },
    ];
    const je = makeEntry(jeNo, data.date, data.description || 'مصروف', lines, 'expense', null);
    const expense = { id: uid('exp'), ...data, journalId: je.id };

    const nextSettings = { ...settings, nextJournalNo: jeNo + 1 };
    const nextJournal = [...journalEntries, je];
    const nextExpenses = [...expenses, expense];

    setExpenses(nextExpenses); setJournalEntries(nextJournal); setSettings(nextSettings);
    persist(STORAGE_KEYS.expenses, nextExpenses);
    persist(STORAGE_KEYS.journal, nextJournal);
    persist(STORAGE_KEYS.settings, nextSettings);
    showToast('تم حفظ المصروف');
  }

  /* ---------- Payments ---------- */
  function recordPayment(type, contact, data) {
    const jeNo = settings.nextJournalNo;
    const cashAcc = getCashLikeAccountId(accounts, data.method);
    let lines, je, nextSettings, nextJournal;

    if (type === 'customer') {
      lines = [
        { accountId: cashAcc, debit: data.amount, credit: 0 },
        { accountId: getAccountByKind(accounts, 'ar').id, debit: 0, credit: data.amount },
      ];
      je = makeEntry(jeNo, data.date, `تحصيل دفعة من ${contact.name}`, lines, 'payment_in', data.invoiceId);
      const nextSales = salesInvoices.map(inv => inv.id === data.invoiceId ? { ...inv, paidAmount: inv.paidAmount + data.amount } : inv);
      setSalesInvoices(nextSales); persist(STORAGE_KEYS.sales, nextSales);
    } else {
      lines = [
        { accountId: getAccountByKind(accounts, 'ap').id, debit: data.amount, credit: 0 },
        { accountId: cashAcc, debit: 0, credit: data.amount },
      ];
      je = makeEntry(jeNo, data.date, `سداد دفعة إلى ${contact.name}`, lines, 'payment_out', data.invoiceId);
      const nextPurchases = purchaseInvoices.map(inv => inv.id === data.invoiceId ? { ...inv, paidAmount: inv.paidAmount + data.amount } : inv);
      setPurchaseInvoices(nextPurchases); persist(STORAGE_KEYS.purchases, nextPurchases);
    }
    nextSettings = { ...settings, nextJournalNo: jeNo + 1 };
    nextJournal = [...journalEntries, je];
    setJournalEntries(nextJournal); setSettings(nextSettings);
    persist(STORAGE_KEYS.journal, nextJournal);
    persist(STORAGE_KEYS.settings, nextSettings);
    showToast('تم تسجيل الدفعة بنجاح');
  }

  /* ---------- Reps (Distributors) ---------- */
  function addRep(form) {
    const rep = { id: uid('rep'), no: settings.nextRepNo, name: form.name.trim(), phone: form.phone || '', commissionPercent: Number(form.commissionPercent) };
    const next = [...reps, rep];
    const nextSettings = { ...settings, nextRepNo: settings.nextRepNo + 1 };
    setReps(next); setSettings(nextSettings);
    persist(STORAGE_KEYS.reps, next); persist(STORAGE_KEYS.settings, nextSettings);
    showToast('تمت إضافة المندوب');
  }
  function updateRep(updated) {
    const next = reps.map(r => r.id === updated.id ? updated : r);
    setReps(next); persist(STORAGE_KEYS.reps, next);
    showToast('تم تحديث بيانات المندوب');
  }
  function deleteRep(id) {
    const next = reps.filter(r => r.id !== id);
    setReps(next); persist(STORAGE_KEYS.reps, next);
    showToast('تم حذف المندوب');
  }

  /* ---------- Recurring Invoice Templates ---------- */
  function addRecurringTemplate(form) {
    const tpl = { id: uid('rec'), ...form, active: true };
    const next = [...recurringTemplates, tpl];
    setRecurringTemplates(next); persist(STORAGE_KEYS.recurring, next);
    showToast('تم إنشاء الفاتورة الدورية');
  }
  function toggleRecurringTemplate(id) {
    const next = recurringTemplates.map(t => t.id === id ? { ...t, active: !t.active } : t);
    setRecurringTemplates(next); persist(STORAGE_KEYS.recurring, next);
  }
  function deleteRecurringTemplate(id) {
    const next = recurringTemplates.filter(t => t.id !== id);
    setRecurringTemplates(next); persist(STORAGE_KEYS.recurring, next);
    showToast('تم حذف الفاتورة الدورية');
  }

  /* ---------- Manual Journal ---------- */
  function addManualJournal(data) {
    const jeNo = settings.nextJournalNo;
    const je = makeEntry(jeNo, data.date, data.description, data.lines, 'manual', null);
    const nextJournal = [...journalEntries, je];
    const nextSettings = { ...settings, nextJournalNo: jeNo + 1 };
    setJournalEntries(nextJournal); setSettings(nextSettings);
    persist(STORAGE_KEYS.journal, nextJournal);
    persist(STORAGE_KEYS.settings, nextSettings);
    showToast('تم حفظ القيد');
  }

  /* ---------- Settings / Reset ---------- */
  function saveSettings(form) {
    setSettings(form); persist(STORAGE_KEYS.settings, form);
    showToast('تم حفظ الإعدادات');
  }
  async function resetAll() {
    const freshAccounts = DEFAULT_ACCOUNTS.map(a => ({ ...a }));
    setSettings(DEFAULT_SETTINGS); setAccounts(freshAccounts); setCustomers([]); setSuppliers([]);
    setProducts([]); setSalesInvoices([]); setPurchaseInvoices([]); setExpenses([]); setJournalEntries([]);
    setReps([]); setRecurringTemplates([]);
    await Promise.all([
      saveKey(STORAGE_KEYS.settings, DEFAULT_SETTINGS),
      saveKey(STORAGE_KEYS.accounts, freshAccounts),
      saveKey(STORAGE_KEYS.customers, []),
      saveKey(STORAGE_KEYS.suppliers, []),
      saveKey(STORAGE_KEYS.products, []),
      saveKey(STORAGE_KEYS.sales, []),
      saveKey(STORAGE_KEYS.purchases, []),
      saveKey(STORAGE_KEYS.expenses, []),
      saveKey(STORAGE_KEYS.journal, []),
      saveKey(STORAGE_KEYS.reps, []),
      saveKey(STORAGE_KEYS.recurring, []),
    ]);
    setActiveTab('dashboard');
    showToast('تم حذف جميع البيانات');
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50 font-body" dir="rtl">
        <div className="flex flex-col items-center gap-3 text-stone-500">
          <Loader2 size={28} className="animate-spin" />
          <p className="text-sm">جارِ تحميل النظام المحاسبي...</p>
        </div>
      </div>
    );
  }

  const expenseAccounts = accounts.filter(a => a.type === 'expense' && a.kind !== 'cogs');

  return (
    <div className="min-h-screen bg-stone-50 font-body flex" dir="rtl">
      <Sidebar active={activeTab} onNavigate={setActiveTab} companyName={settings.companyName} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />
      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar title={VIEW_TITLES[activeTab]} setMobileOpen={setMobileOpen} />
        <main className="flex-1 p-4 md:p-6">
          {activeTab === 'dashboard' && (
            <DashboardView
              data={{ accounts, journalEntries, salesInvoices, purchaseInvoices, products, customers, suppliers }}
              currency={settings.currency}
              onNavigate={setActiveTab}
            />
          )}
          {activeTab === 'accounts' && (
            <AccountsView accounts={accounts} journalEntries={journalEntries} currency={settings.currency} onAdd={addAccount} onDelete={deleteAccount} />
          )}
          {activeTab === 'customers' && (
            <ContactsView
              type="customer" contacts={customers} invoices={salesInvoices} currency={settings.currency} settings={settings}
              onAdd={(f) => addContact('customer', f)} onUpdate={(c) => updateContact('customer', c)} onDelete={(id) => deleteContact('customer', id)}
              onRecordPayment={(contact, data) => recordPayment('customer', contact, data)}
            />
          )}
          {activeTab === 'suppliers' && (
            <ContactsView
              type="supplier" contacts={suppliers} invoices={purchaseInvoices} currency={settings.currency}
              onAdd={(f) => addContact('supplier', f)} onUpdate={(c) => updateContact('supplier', c)} onDelete={(id) => deleteContact('supplier', id)}
              onRecordPayment={(contact, data) => recordPayment('supplier', contact, data)}
            />
          )}
          {activeTab === 'products' && (
            <ProductsView products={products} currency={settings.currency} onAdd={addProduct} onUpdate={updateProduct} onDelete={deleteProduct} usedProductIds={usedProductIds} />
          )}
          {activeTab === 'sales' && (
            <SalesInvoicesView invoices={salesInvoices} customers={customers} products={products} reps={reps} settings={settings} onAdd={addSalesInvoice} />
          )}
          {activeTab === 'purchases' && (
            <PurchaseInvoicesView invoices={purchaseInvoices} suppliers={suppliers} products={products} settings={settings} onAdd={addPurchaseInvoice} />
          )}
          {activeTab === 'recurring' && (
            <RecurringInvoicesView
              templates={recurringTemplates} customers={customers} products={products} reps={reps} settings={settings}
              onAdd={addRecurringTemplate} onToggle={toggleRecurringTemplate} onDelete={deleteRecurringTemplate}
            />
          )}
          {activeTab === 'reminders' && (
            <RemindersView salesInvoices={salesInvoices} customers={customers} settings={settings} showToast={showToast} />
          )}
          {activeTab === 'forecast' && (
            <ForecastView products={products} salesInvoices={salesInvoices} currency={settings.currency} />
          )}
          {activeTab === 'reps' && (
            <RepsView reps={reps} salesInvoices={salesInvoices} currency={settings.currency} onAdd={addRep} onUpdate={updateRep} onDelete={deleteRep} />
          )}
          {activeTab === 'expenses' && (
            <ExpensesView expenses={expenses} accounts={accounts} settings={settings} onAdd={addExpense} />
          )}
          {activeTab === 'journal' && (
            <JournalView journalEntries={journalEntries} accounts={accounts} currency={settings.currency} onAddManual={addManualJournal} />
          )}
          {activeTab === 'reports' && (
            <ReportsView accounts={accounts} journalEntries={journalEntries} currency={settings.currency} />
          )}
          {activeTab === 'settings' && (
            <SettingsView settings={settings} onSave={saveSettings} onResetAll={resetAll} />
          )}
        </main>
      </div>
      <Toast toast={toast} />
    </div>
  );
}
