import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { db } from './firebase';
import { doc, setDoc } from 'firebase/firestore';

// ─────────────────────────────────────────────
// 2026 TAX CONSTANTS
// ─────────────────────────────────────────────
const STANDARD_DEDUCTION_MFJ = 30000;
const QBI_RATE = 0.20;
const QBI_THRESHOLD_MFJ = 394600;
const MFJ_BRACKETS = [
  { rate: 0.10, max: 23200 },
  { rate: 0.12, max: 94300 },
  { rate: 0.22, max: 201050 },
  { rate: 0.24, max: 383900 },
  { rate: 0.32, max: 487450 },
  { rate: 0.35, max: 731200 },
  { rate: 0.37, max: Infinity },
];
function calcFederalTax(ti) {
  let tax = 0, prev = 0;
  for (const { rate, max } of MFJ_BRACKETS) {
    if (ti <= prev) break;
    tax += rate * (Math.min(ti, max) - prev);
    prev = max;
  }
  return Math.max(0, tax);
}
function marginalRate(ti) {
  for (const { rate, max } of MFJ_BRACKETS) { if (ti <= max) return rate; }
  return 0.37;
}

// ─────────────────────────────────────────────
// IRS EXPENSE LIBRARY — static, pre-built
// deductPct = IRS-allowed deduction percentage
// bizOnly   = true means only deductible if business-use; user sets their own bizPct
// notes     = plain-english IRS rule
// ─────────────────────────────────────────────
const IRS_LIBRARY = {
  "Housing & Real Estate": [
    { name: "Mortgage interest", deductPct: 1.00, bizOnly: false, irsCode: "Sch A / Sch C", notes: "100% deductible (Sch A personal) or home-office % (Sch C). Cap: $750K loan." },
    { name: "Home office rent", deductPct: 1.00, bizOnly: true, irsCode: "Sch C / Form 8829", notes: "Deduct % of rent equal to office sq ft ÷ total home sq ft." },
    { name: "Property taxes", deductPct: 1.00, bizOnly: false, irsCode: "Sch A", notes: "Deductible up to $10,000 SALT cap (combined state income + property taxes)." },
    { name: "HOA fees (home office)", deductPct: 1.00, bizOnly: true, irsCode: "Form 8829", notes: "Home-office % of HOA fees is deductible as a business expense." },
    { name: "Homeowner's insurance", deductPct: 1.00, bizOnly: true, irsCode: "Form 8829", notes: "Only the home-office % is deductible. Personal portion is not." },
    { name: "Repairs & maintenance", deductPct: 1.00, bizOnly: true, irsCode: "Form 8829 / Sch C", notes: "Repairs to home-office area: 100% deductible. Whole-home: office % only." },
  ],
  "Utilities": [
    { name: "Electricity", deductPct: 1.00, bizOnly: true, irsCode: "Form 8829", notes: "Deduct home-office % (typically 5–15% of sq ft). Keep bills." },
    { name: "Gas / heating", deductPct: 1.00, bizOnly: true, irsCode: "Form 8829", notes: "Home-office % deductible. Same allocation method as electricity." },
    { name: "Water & sewer", deductPct: 1.00, bizOnly: true, irsCode: "Form 8829", notes: "Home-office % deductible. Typically small but legitimate." },
    { name: "Internet / WiFi", deductPct: 1.00, bizOnly: true, irsCode: "Sch C", notes: "Business-use % deductible. Keep records if also used personally." },
    { name: "Phone (mobile)", deductPct: 1.00, bizOnly: true, irsCode: "Sch C", notes: "Business-use % only. IRS expects 50–80% for most professionals." },
    { name: "Landline (dedicated biz)", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible if the line is used exclusively for business." },
  ],
  "Software & Subscriptions": [
    { name: "AI tools (ChatGPT/Claude)", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible as ordinary and necessary business expense." },
    { name: "SaaS / productivity apps", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible. Includes project management, CRM, design tools." },
    { name: "Cloud storage", deductPct: 1.00, bizOnly: true, irsCode: "Sch C", notes: "Business-use % if personal files also stored. Document allocation." },
    { name: "Domain & hosting", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible. Includes DNS, SSL, CDN, and server costs." },
    { name: "Security software", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible. Includes antivirus, VPN, password managers." },
    { name: "Video conferencing", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible (Zoom, Teams, etc.) when used for business." },
  ],
  "Meals & Entertainment": [
    { name: "Client meals", deductPct: 0.50, bizOnly: false, irsCode: "Sch C §274(n)", notes: "50% deductible. Must have business purpose + document client name." },
    { name: "Business travel meals", deductPct: 0.50, bizOnly: false, irsCode: "Sch C §274(n)", notes: "50% deductible while traveling overnight for business." },
    { name: "Office snacks / coffee", deductPct: 0.50, bizOnly: false, irsCode: "Sch C §274(n)", notes: "50% deductible if provided for business meetings or staff." },
    { name: "Entertainment (pre-2018)", deductPct: 0.00, bizOnly: false, irsCode: "TCJA 2017", notes: "0% — entertainment expenses eliminated by Tax Cuts and Jobs Act." },
  ],
  "Travel & Transportation": [
    { name: "Mileage (standard rate)", deductPct: 1.00, bizOnly: false, irsCode: "Sch C Rev. Proc.", notes: "$0.70/mile in 2026. Log date, destination, business purpose. Cannot combine with actual expenses." },
    { name: "Actual vehicle expenses", deductPct: 1.00, bizOnly: true, irsCode: "Sch C", notes: "Business-use % of gas, insurance, depreciation. Cannot combine with mileage method." },
    { name: "Airfare (business)", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible for business trips. Mixed trips: allocate business days." },
    { name: "Hotel / lodging", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible for business nights. Document business purpose." },
    { name: "Rideshare (Uber/Lyft)", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible for business trips. Keep receipts; note purpose." },
    { name: "Parking & tolls", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible for business travel. Even with standard mileage." },
    { name: "Public transit (business)", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible when traveling for business purposes." },
  ],
  "Professional Services": [
    { name: "Accounting / CPA fees", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible for business portion. Personal tax prep on Sch A." },
    { name: "Legal fees (business)", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible for business-related legal services." },
    { name: "Consulting fees paid out", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible. Issue 1099-NEC if $600+ to any single contractor." },
    { name: "Business coaching", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible if directly related to your business operations." },
    { name: "Recruiting fees", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible. Includes background check and staffing agency fees." },
  ],
  "Education & Development": [
    { name: "Courses & certifications", deductPct: 1.00, bizOnly: false, irsCode: "Sch C §162", notes: "100% deductible if maintains or improves current business skills. Not for new career." },
    { name: "Books & publications", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible if related to your trade or profession." },
    { name: "Conference / events", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible (registration, travel). 50% on meals at conference." },
    { name: "Professional memberships", deductPct: 1.00, bizOnly: false, irsCode: "Sch C §162(e)", notes: "100% deductible for trade/professional orgs. Civic clubs are not." },
  ],
  "Marketing & Advertising": [
    { name: "Advertising (digital)", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible. Includes Google Ads, LinkedIn, Meta campaigns." },
    { name: "Website design", deductPct: 1.00, bizOnly: false, irsCode: "Sch C / §179", notes: "100% deductible or Section 179 if treated as asset. Amortize if capitalized." },
    { name: "Business cards & print", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible as ordinary marketing expense." },
    { name: "Branding & logo design", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible in the year incurred if under $5,000." },
    { name: "PR / media outreach", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible as business promotion expense." },
  ],
  "Equipment & Hardware": [
    { name: "Computer / laptop", deductPct: 1.00, bizOnly: true, irsCode: "§179 / Sch C", notes: "100% deductible via Section 179 if under $1M limit. Business-use % if mixed-use." },
    { name: "Monitor / display", deductPct: 1.00, bizOnly: true, irsCode: "§179 / Sch C", notes: "100% deductible via Section 179 if used for business." },
    { name: "Keyboard / mouse / desk", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible as ordinary office supplies or equipment." },
    { name: "Camera / recording gear", deductPct: 1.00, bizOnly: true, irsCode: "§179 / Sch C", notes: "Business-use % deductible. Full Section 179 if exclusively for biz." },
    { name: "Office furniture", deductPct: 1.00, bizOnly: true, irsCode: "§179 / Sch C", notes: "100% if in dedicated home office. Otherwise home-office % only." },
    { name: "Smartphone (business)", deductPct: 1.00, bizOnly: true, irsCode: "Sch C", notes: "Business-use % deductible. Document personal vs. business split." },
  ],
  "Insurance": [
    { name: "Self-employed health ins.", deductPct: 1.00, bizOnly: false, irsCode: "§162(l)", notes: "100% above-the-line deduction. Cannot exceed net SE income. Not if eligible for employer plan." },
    { name: "Dental & vision ins.", deductPct: 1.00, bizOnly: false, irsCode: "§162(l)", notes: "100% deductible under self-employed health insurance if not employer-covered." },
    { name: "Business liability ins.", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible. Includes E&O, general liability, cyber coverage." },
    { name: "Life ins. (business key)", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "Deductible only if business is the beneficiary (key-person policy)." },
    { name: "Disability insurance", deductPct: 0.00, bizOnly: false, irsCode: "IRS Pub. 535", notes: "Not deductible as business expense — but benefits received are tax-free." },
  ],
  "Retirement & Benefits": [
    { name: "SEP-IRA contribution", deductPct: 1.00, bizOnly: false, irsCode: "§404(h)", notes: "Up to 25% of net SE income, max $69,000 (2026). Above-the-line AGI deduction." },
    { name: "Solo 401(k) — employee", deductPct: 1.00, bizOnly: false, irsCode: "§402(g)", notes: "Up to $23,000 employee deferral ($30,500 if 50+). Reduces AGI directly." },
    { name: "Solo 401(k) — employer", deductPct: 1.00, bizOnly: false, irsCode: "§404", notes: "Up to 25% of net SE income as employer contribution. Combined cap $69,000." },
    { name: "SIMPLE IRA", deductPct: 1.00, bizOnly: false, irsCode: "§408(p)", notes: "Up to $16,000 ($19,500 if 50+). Must have no other qualified plan." },
    { name: "Health Savings Account", deductPct: 1.00, bizOnly: false, irsCode: "§223", notes: "$4,300 single / $8,550 family (2026). Must have HDHP. Triple tax advantage." },
  ],
  "Office & Supplies": [
    { name: "Office supplies", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible. Pens, paper, toner, postage, staples, etc." },
    { name: "Postage & shipping", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible for business shipments and correspondence." },
    { name: "Printed materials", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible. Proposals, contracts, presentations." },
    { name: "Bank / payment fees", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible. Includes merchant fees, wire fees, Stripe processing." },
    { name: "Coworking / office rent", deductPct: 1.00, bizOnly: false, irsCode: "Sch C", notes: "100% deductible. Dedicated desk or private office lease." },
  ],
};

const ALL_CATEGORY_NAMES = Object.keys(IRS_LIBRARY);

// ─────────────────────────────────────────────
// INITIAL DATA
// ─────────────────────────────────────────────
const INITIAL_EXPENSES = [
  { id: 1, vendor: "Anthropic", category: "Software & Subscriptions", amount: 20, bizPct: 1.00 },
  { id: 2, vendor: "YouTube Premium", category: "Software & Subscriptions", amount: 20, bizPct: 1.00 },
  { id: 3, vendor: "Gemini", category: "Software & Subscriptions", amount: 20, bizPct: 1.00 },
  { id: 4, vendor: "ChatGPT", category: "Software & Subscriptions", amount: 20, bizPct: 1.00 },
  { id: 5, vendor: "Apple iCloud", category: "Software & Subscriptions", amount: 32, bizPct: 1.00 },
  { id: 6, vendor: "Cursor", category: "Software & Subscriptions", amount: 40, bizPct: 1.00 },
  { id: 7, vendor: "WiFi", category: "Utilities", amount: 70, bizPct: 0.70 },
  { id: 8, vendor: "Google Hosting", category: "Software & Subscriptions", amount: 30, bizPct: 1.00 },
  { id: 9, vendor: "GoDaddy", category: "Software & Subscriptions", amount: 50, bizPct: 1.00 },
  { id: 10, vendor: "Phone", category: "Utilities", amount: 120, bizPct: 0.80 },
  { id: 11, vendor: "Electricity", category: "Utilities", amount: 300, bizPct: 0.05 },
  { id: 12, vendor: "Water", category: "Utilities", amount: 400, bizPct: 0.05 },
  { id: 13, vendor: "Client Meals", category: "Meals & Entertainment", amount: 5000, bizPct: 0.50 },
  { id: 14, vendor: "Uber", category: "Travel & Transportation", amount: 200, bizPct: 1.00 },
  { id: 15, vendor: "OpenRouter", category: "Software & Subscriptions", amount: 42, bizPct: 1.00 },
];
const INITIAL_ASSETS = [
  { id: 1, item: "MacBook Pro", cost: 1200, method: "Section 179" },
  { id: 2, item: "Keyboard", cost: 50, method: "Expense" },
];

function getIrsRule(category, vendor) {
  const group = IRS_LIBRARY[category];
  if (!group) return null;
  return group.find(r => vendor && r.name.toLowerCase().includes(vendor.toLowerCase())) || null;
}

function getDefaultBizPct(category) {
  const pcts = {
    "Meals & Entertainment": 0.50,
    "Utilities": 0.70,
    "Housing & Real Estate": 0.10,
    "Equipment & Hardware": 1.00,
  };
  return pcts[category] ?? 1.00;
}

function calcDeductible(e) {
  // Meals always 50% IRS rule
  if (e.category === "Meals & Entertainment") return e.amount * 0.50;
  return e.amount * e.bizPct;
}

const fmt = (n) => "$" + Math.round(Math.abs(n)).toLocaleString();
const fmtK = (n) => {
  const abs = Math.round(Math.abs(n));
  if (abs >= 1000000) return "$" + (abs / 1000000).toFixed(1) + "M";
  if (abs >= 10000) return "$" + (abs / 1000).toFixed(0) + "K";
  return "$" + abs.toLocaleString();
};
const pct = (n) => (n * 100).toFixed(0) + "%";
let nextId = 100;

// ─────────────────────────────────────────────
// THEMES
// ─────────────────────────────────────────────
const DARK = {
  bg: "#0a0a0f", surface: "#111827", surface2: "#0f172a",
  border: "#1e293b", border2: "#334155",
  text: "#e2e8f0", textMuted: "#94a3b8", textDim: "#64748b", textFaint: "#475569",
  inputBg: "#0f172a", inputBorder: "#334155", inputText: "#60a5fa",
  headerBg: "linear-gradient(135deg,#0f172a 0%,#0a0a0f 100%)",
  green: "#34d399", greenMid: "#6ee7b7",
  red: "#f87171", redMid: "#fca5a5",
  blue: "#60a5fa", purple: "#a78bfa", orange: "#fb923c",
  tfoot: "#0f172a",
  uploadBg: "#111827", uploadBorder: "#334155",
  uploadDragBg: "#0f2744", uploadDragBorder: "#3b82f6",
  effectiveBg: "#0f2a1e", effectiveBorder: "#10b98133",
  effectiveLabel: "#6ee7b7", effectiveNum: "#34d399",
  modalBg: "#111827", modalOverlay: "rgba(0,0,0,0.7)",
  irsTagBg: "#1a2a1a", irsTagText: "#86efac", irsTagBorder: "#22c55e33",
  catColors: {
    "Housing & Real Estate": { bg: "#1a1a0f", accent: "#f59e0b", text: "#fcd34d" },
    "Utilities": { bg: "#1a1f2a", accent: "#06b6d4", text: "#67e8f9" },
    "Software & Subscriptions": { bg: "#0f2744", accent: "#3b82f6", text: "#93c5fd" },
    "Meals & Entertainment": { bg: "#2a1212", accent: "#ef4444", text: "#fca5a5" },
    "Travel & Transportation": { bg: "#1a2a1a", accent: "#22c55e", text: "#86efac" },
    "Professional Services": { bg: "#1e1a2e", accent: "#8b5cf6", text: "#c4b5fd" },
    "Education & Development": { bg: "#0f2a1e", accent: "#10b981", text: "#6ee7b7" },
    "Marketing & Advertising": { bg: "#2a1a0f", accent: "#f97316", text: "#fdba74" },
    "Equipment & Hardware": { bg: "#1a2a1a", accent: "#22c55e", text: "#86efac" },
    "Insurance": { bg: "#1a1a2a", accent: "#818cf8", text: "#c7d2fe" },
    "Retirement & Benefits": { bg: "#0f2744", accent: "#3b82f6", text: "#93c5fd" },
    "Office & Supplies": { bg: "#1a1a0f", accent: "#f59e0b", text: "#fcd34d" },
  },
  optColors: {
    high: { bg: "#0f2a1e", accent: "#10b981" },
    medium: { bg: "#0f2744", accent: "#3b82f6" },
    low: { bg: "#1e1a2e", accent: "#8b5cf6" },
  },
};
const LIGHT = {
  bg: "#f8fafc", surface: "#ffffff", surface2: "#f1f5f9",
  border: "#e2e8f0", border2: "#cbd5e1",
  text: "#0f172a", textMuted: "#475569", textDim: "#64748b", textFaint: "#94a3b8",
  inputBg: "#f8fafc", inputBorder: "#cbd5e1", inputText: "#1d4ed8",
  headerBg: "linear-gradient(135deg,#f1f5f9 0%,#e2e8f0 100%)",
  green: "#16a34a", greenMid: "#15803d",
  red: "#dc2626", redMid: "#b91c1c",
  blue: "#2563eb", purple: "#7c3aed", orange: "#ea580c",
  tfoot: "#f1f5f9",
  uploadBg: "#f8fafc", uploadBorder: "#cbd5e1",
  uploadDragBg: "#eff6ff", uploadDragBorder: "#2563eb",
  effectiveBg: "#f0fdf4", effectiveBorder: "#16a34a33",
  effectiveLabel: "#15803d", effectiveNum: "#16a34a",
  modalBg: "#ffffff", modalOverlay: "rgba(0,0,0,0.4)",
  irsTagBg: "#f0fdf4", irsTagText: "#15803d", irsTagBorder: "#16a34a33",
  catColors: {
    "Housing & Real Estate": { bg: "#fffbeb", accent: "#d97706", text: "#b45309" },
    "Utilities": { bg: "#ecfeff", accent: "#0891b2", text: "#0e7490" },
    "Software & Subscriptions": { bg: "#eff6ff", accent: "#2563eb", text: "#1d4ed8" },
    "Meals & Entertainment": { bg: "#fef2f2", accent: "#dc2626", text: "#b91c1c" },
    "Travel & Transportation": { bg: "#f0fdf4", accent: "#15803d", text: "#166534" },
    "Professional Services": { bg: "#faf5ff", accent: "#7c3aed", text: "#6d28d9" },
    "Education & Development": { bg: "#f0fdf4", accent: "#16a34a", text: "#15803d" },
    "Marketing & Advertising": { bg: "#fff7ed", accent: "#ea580c", text: "#c2410c" },
    "Equipment & Hardware": { bg: "#f0fdf4", accent: "#15803d", text: "#166534" },
    "Insurance": { bg: "#eef2ff", accent: "#4f46e5", text: "#4338ca" },
    "Retirement & Benefits": { bg: "#eff6ff", accent: "#2563eb", text: "#1d4ed8" },
    "Office & Supplies": { bg: "#fffbeb", accent: "#d97706", text: "#b45309" },
  },
  optColors: {
    high: { bg: "#f0fdf4", accent: "#16a34a" },
    medium: { bg: "#eff6ff", accent: "#2563eb" },
    low: { bg: "#faf5ff", accent: "#7c3aed" },
  },
};

// ─────────────────────────────────────────────
// ADD EXPENSE MODAL
// ─────────────────────────────────────────────
function AddExpenseModal({ onAdd, onClose, t }) {
  const [selectedGroup, setSelectedGroup] = useState(ALL_CATEGORY_NAMES[0]);
  const [selectedRule, setSelectedRule] = useState(null);
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [bizPct, setBizPct] = useState(1.00);

  const group = IRS_LIBRARY[selectedGroup] || [];

  const selectRule = (rule) => {
    setSelectedRule(rule);
    setBizPct(rule.deductPct === 0.50 ? 0.50 :
      selectedGroup === "Utilities" ? 0.70 :
        selectedGroup === "Housing & Real Estate" ? 0.10 : 1.00);
    if (!vendor) setVendor(rule.name);
  };

  const effectivePct = selectedRule?.deductPct === 0 ? 0 :
    (selectedGroup === "Meals & Entertainment" ? 0.50 : bizPct);
  const deductible = parseFloat(amount || 0) * effectivePct;

  const canAdd = vendor.trim() && parseFloat(amount) > 0 && selectedRule;

  const handleAdd = () => {
    if (!canAdd) return;
    onAdd({
      id: nextId++,
      vendor: vendor.trim(),
      category: selectedGroup,
      amount: parseFloat(amount),
      bizPct: selectedGroup === "Meals & Entertainment" ? 0.50 : bizPct,
      irsRule: selectedRule,
    });
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: t.modalOverlay, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: t.modalBg, border: `1px solid ${t.border2}`, borderRadius: "16px", width: "100%", maxWidth: "640px", maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>

        {/* Modal header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: "16px", fontWeight: "600", color: t.text }}>Add expense</div>
            <div style={{ fontSize: "12px", color: t.textDim, marginTop: "2px" }}>IRS deduction rules pre-loaded by category</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${t.border2}`, borderRadius: "8px", color: t.textDim, width: "32px", height: "32px", cursor: "pointer", fontSize: "16px", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>

        <div style={{ overflowY: "auto", padding: "20px 24px", flex: 1 }}>

          {/* Step 1: Category */}
          <div style={{ marginBottom: "18px" }}>
            <div style={{ fontSize: "11px", fontWeight: "600", color: t.textDim, marginBottom: "8px", letterSpacing: "0.5px" }}>1 — SELECT CATEGORY</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {ALL_CATEGORY_NAMES.map(name => {
                const c = t.catColors[name] || t.catColors["Office & Supplies"];
                const active = selectedGroup === name;
                return (
                  <button key={name} onClick={() => { setSelectedGroup(name); setSelectedRule(null); setVendor(""); }}
                    style={{ background: active ? c.bg : "transparent", border: `1px solid ${active ? c.accent : t.border}`, borderRadius: "6px", color: active ? c.accent : t.textDim, padding: "5px 10px", fontSize: "11px", cursor: "pointer", fontWeight: active ? "600" : "400", transition: "all 0.12s", fontFamily: "inherit" }}>
                    {name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2: Expense type */}
          <div style={{ marginBottom: "18px" }}>
            <div style={{ fontSize: "11px", fontWeight: "600", color: t.textDim, marginBottom: "8px", letterSpacing: "0.5px" }}>2 — SELECT EXPENSE TYPE</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
              {group.map(rule => {
                const active = selectedRule?.name === rule.name;
                return (
                  <div key={rule.name} onClick={() => selectRule(rule)}
                    style={{ background: active ? t.effectiveBg : t.surface2, border: `1px solid ${active ? t.green + "66" : t.border}`, borderLeft: active ? `3px solid ${t.green}` : `3px solid transparent`, borderRadius: "8px", padding: "10px 12px", cursor: "pointer", transition: "all 0.12s" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "13px", fontWeight: "500", color: t.text }}>{rule.name}</div>
                        <div style={{ fontSize: "11px", color: t.textDim, marginTop: "2px", lineHeight: "1.4" }}>{rule.notes}</div>
                      </div>
                      <div style={{ flexShrink: 0, textAlign: "right" }}>
                        <div style={{ background: t.irsTagBg, color: t.irsTagText, border: `1px solid ${t.irsTagBorder}`, borderRadius: "4px", padding: "2px 7px", fontSize: "10px", fontWeight: "600" }}>
                          {rule.deductPct === 0 ? "0%" : rule.deductPct === 0.50 ? "50%" : rule.bizOnly ? "Biz %" : "100%"}
                        </div>
                        <div style={{ fontSize: "10px", color: t.textFaint, marginTop: "2px" }}>{rule.irsCode}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Step 3: Details */}
          {selectedRule && (
            <div style={{ marginBottom: "4px" }}>
              <div style={{ fontSize: "11px", fontWeight: "600", color: t.textDim, marginBottom: "8px", letterSpacing: "0.5px" }}>3 — ENTER DETAILS</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div>
                  <div style={{ fontSize: "11px", color: t.textDim, marginBottom: "5px" }}>VENDOR / DESCRIPTION</div>
                  <input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="e.g. Chase mortgage"
                    style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: "7px", color: t.text, padding: "9px 12px", width: "100%", fontSize: "13px", boxSizing: "border-box", fontFamily: "inherit", outline: "none" }} />
                </div>
                <div>
                  <div style={{ fontSize: "11px", color: t.textDim, marginBottom: "5px" }}>ANNUAL AMOUNT ($)</div>
                  <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0"
                    style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: "7px", color: t.inputText, padding: "9px 12px", width: "100%", fontSize: "13px", fontFamily: "'DM Mono',monospace", boxSizing: "border-box", outline: "none" }} />
                </div>
              </div>

              {/* Business % slider — only shown when relevant */}
              {selectedRule.bizOnly && selectedGroup !== "Meals & Entertainment" && (
                <div style={{ marginTop: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
                    <div style={{ fontSize: "11px", color: t.textDim }}>BUSINESS-USE %</div>
                    <div style={{ fontSize: "12px", fontWeight: "600", color: t.blue, fontFamily: "'DM Mono',monospace" }}>{Math.round(bizPct * 100)}%</div>
                  </div>
                  <input type="range" min="0" max="1" step="0.05" value={bizPct} onChange={e => setBizPct(parseFloat(e.target.value))}
                    style={{ width: "100%" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: t.textFaint, marginTop: "2px" }}>
                    <span>0% personal</span><span>100% business</span>
                  </div>
                </div>
              )}

              {/* Preview */}
              {parseFloat(amount) > 0 && (
                <div style={{ marginTop: "12px", background: t.effectiveBg, border: `1px solid ${t.effectiveBorder}`, borderRadius: "8px", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "11px", color: t.effectiveLabel }}>DEDUCTIBLE AMOUNT</div>
                    <div style={{ fontSize: "20px", fontFamily: "'DM Mono',monospace", fontWeight: "600", color: t.effectiveNum }}>{fmt(deductible)}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "11px", color: t.textDim }}>IRS basis</div>
                    <div style={{ fontSize: "13px", fontWeight: "500", color: t.textMuted }}>{selectedRule.irsCode}</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 24px", borderTop: `1px solid ${t.border}`, display: "flex", justifyContent: "flex-end", gap: "10px" }}>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${t.border2}`, borderRadius: "8px", color: t.textMuted, padding: "8px 18px", fontSize: "13px", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          <button onClick={handleAdd} disabled={!canAdd}
            style={{ background: canAdd ? t.green : t.border, border: "none", borderRadius: "8px", color: canAdd ? "#022c22" : t.textFaint, padding: "8px 22px", fontSize: "13px", fontWeight: "600", cursor: canAdd ? "pointer" : "default", fontFamily: "inherit", transition: "all 0.15s" }}>
            Add expense
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// IRS RULES REFERENCE PANEL
// ─────────────────────────────────────────────
function DeductionPlaybook({ t }) {
  const [openGroup, setOpenGroup] = useState(null);

  const playbookMeta = {
    "Housing & Real Estate": { qualifies: "Exclusive home office space", notQualifies: "Mixed use space (e.g. dining table)", records: "Floor plan, rent/mortgage statements", mistakes: "Claiming an inappropriately large percentage of the home" },
    "Meals & Entertainment": { qualifies: "Meals while traveling or with clients discussing business", notQualifies: "Personal meals, coffee alone, or concert/golf tickets", records: "Itemized receipts + note of attendees and business purpose", mistakes: "Deducting 100% instead of 50%, or claiming entertainment items" },
    "Travel & Transportation": { qualifies: "Trips primarily for business purposes", notQualifies: "Daily commuting to your regular office", records: "Mileage log, detailed travel receipts", mistakes: "Mixing standard mileage rate with actual expenses in the same year" },
    "Utilities": { qualifies: "Business % of phone/internet used strictly for work", notQualifies: "100% deduction for personal lines", records: "Bills with business % noted", mistakes: "Deducting 100% of a mixed-use cell phone without documentation" },
    "Software & Subscriptions": { qualifies: "Tools used strictly for business operations", notQualifies: "Personal Netflix/Spotify accounts", records: "Invoices, credit card statements", mistakes: "Failing to separate personal digital subscriptions" },
    "default": { qualifies: "Ordinary and necessary business expenses", notQualifies: "Personal or capital expenses over $2,500 without capitalizing", records: "Itemized receipts, invoices, bank statements", mistakes: "Lacking documentation or mixing personal and business funds" }
  };

  return (
    <div>
      <div style={{ fontSize: "16px", fontWeight: "600", color: t.text, marginBottom: "8px" }}>Deduction Playbook</div>
      <div style={{ fontSize: "13px", color: t.textDim, marginBottom: "16px" }}>
        Actionable guidance on how the IRS treats categories, common mistakes to avoid, and the required records needed to survive an audit.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {ALL_CATEGORY_NAMES.map(name => {
          const c = t.catColors[name] || t.catColors["Office & Supplies"];
          const open = openGroup === name;
          const rules = IRS_LIBRARY[name];
          const meta = playbookMeta[name] || playbookMeta["default"];
          return (
            <div key={name} style={{ background: t.surface, border: `1px solid ${open ? c.accent + "66" : t.border}`, borderRadius: "10px", overflow: "hidden", transition: "border-color 0.15s" }}>
              <div onClick={() => setOpenGroup(open ? null : name)}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", cursor: "pointer", background: open ? c.bg : "transparent" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "13px", fontWeight: "600", color: open ? c.accent : t.text }}>{name}</span>
                  <span style={{ fontSize: "10px", color: t.textFaint }}>{rules.length} items</span>
                </div>
                <span style={{ color: t.textDim, fontSize: "14px" }}>{open ? "▲" : "▼"}</span>
              </div>
              {open && (
                <div style={{ borderTop: `1px solid ${t.border}` }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", padding: "16px", background: t.surface2 }}>
                    <div style={{ background: t.bg, border: `1px solid ${t.border}`, borderRadius: "8px", padding: "12px" }}>
                      <div style={{ fontSize: "11px", fontWeight: "700", color: t.greenMid, marginBottom: "6px", letterSpacing: "0.5px" }}>GENERALLY QUALIFIES</div>
                      <div style={{ fontSize: "12px", color: t.textDim, lineHeight: "1.4" }}>{meta.qualifies}</div>
                    </div>
                    <div style={{ background: t.bg, border: `1px solid ${t.border}`, borderRadius: "8px", padding: "12px" }}>
                      <div style={{ fontSize: "11px", fontWeight: "700", color: t.redMid, marginBottom: "6px", letterSpacing: "0.5px" }}>DOES NOT QUALIFY</div>
                      <div style={{ fontSize: "12px", color: t.textDim, lineHeight: "1.4" }}>{meta.notQualifies}</div>
                    </div>
                    <div style={{ background: t.bg, border: `1px solid ${t.border}`, borderRadius: "8px", padding: "12px" }}>
                      <div style={{ fontSize: "11px", fontWeight: "700", color: t.orange, marginBottom: "6px", letterSpacing: "0.5px" }}>COMMON MISTAKES</div>
                      <div style={{ fontSize: "12px", color: t.textDim, lineHeight: "1.4" }}>{meta.mistakes}</div>
                    </div>
                    <div style={{ background: t.bg, border: `1px solid ${t.border}`, borderRadius: "8px", padding: "12px" }}>
                      <div style={{ fontSize: "11px", fontWeight: "700", color: t.blue, marginBottom: "6px", letterSpacing: "0.5px" }}>REQUIRED RECORDS</div>
                      <div style={{ fontSize: "12px", color: t.textDim, lineHeight: "1.4" }}>{meta.records}</div>
                    </div>
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                    <thead>
                      <tr style={{ background: t.surface, borderTop: `1px solid ${t.border2}`, borderBottom: `1px solid ${t.border2}` }}>
                        <th style={{ padding: "8px 14px", textAlign: "left", color: t.textFaint, fontWeight: "500", fontSize: "10px" }}>EXPENSE</th>
                        <th style={{ padding: "8px 14px", textAlign: "center", color: t.textFaint, fontWeight: "500", fontSize: "10px" }}>DEDUCT</th>
                        <th style={{ padding: "8px 14px", textAlign: "left", color: t.textFaint, fontWeight: "500", fontSize: "10px" }}>RULE CODE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rules.map((rule, i) => (
                        <tr key={rule.name} style={{ borderBottom: i === rules.length - 1 ? "none" : `1px solid ${t.border}`, background: t.surface }}>
                          <td style={{ padding: "9px 14px" }}>
                            <div style={{ color: t.text, fontWeight: "500", marginBottom: "3px" }}>{rule.name}</div>
                            <div style={{ color: t.textMuted, lineHeight: "1.3", fontSize: "11px" }}>{rule.notes}</div>
                          </td>
                          <td style={{ padding: "9px 14px", textAlign: "center" }}>
                            <span style={{ background: rule.deductPct === 0 ? (t.bg === "#0a0a0f" ? "#2a1212" : "#fef2f2") : t.irsTagBg, color: rule.deductPct === 0 ? t.red : t.irsTagText, border: `1px solid ${rule.deductPct === 0 ? t.red + "33" : t.irsTagBorder}`, borderRadius: "4px", padding: "2px 8px", fontSize: "11px", fontWeight: "600", fontFamily: "'DM Mono',monospace" }}>
                              {rule.deductPct === 0 ? "0%" : rule.deductPct === 0.50 ? "50%" : rule.bizOnly ? "Biz %" : "100%"}
                            </span>
                          </td>
                          <td style={{ padding: "9px 14px", color: t.textDim, fontFamily: "'DM Mono',monospace", fontSize: "11px" }}>{rule.irsCode}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// W-2 UPLOADER
// ─────────────────────────────────────────────
function W2Uploader({ onParsed, t }) {
  const [status, setStatus] = useState("idle");
  const [parsed, setParsed] = useState(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef();

  const parseW2 = async (file) => {
    setStatus("loading");
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const isPDF = file.type === "application/pdf";
      const isImage = file.type.startsWith("image/");
      if (!isPDF && !isImage) throw new Error("Use PDF or image");
      const content = [
        { type: isPDF ? "document" : "image", source: { type: "base64", media_type: isPDF ? "application/pdf" : file.type, data: base64 } },
        { type: "text", text: `Parse this W-2. Return ONLY valid JSON no markdown:{"employerName":null,"employeeName":null,"box1_wages":null,"box2_federalWithheld":null,"box4_socialSecurityWithheld":null,"box6_medicareWithheld":null,"box16_stateWages":null,"box17_stateTax":null,"taxYear":null}` },
      ];

      const key = import.meta.env.VITE_OPENROUTER_API_KEY;
      let result;

      if (key) {
        // Direct OpenRouter call for Vercel/Static deployments
        const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
          body: JSON.stringify({
            model: "anthropic/claude-3.5-sonnet",
            messages: [{
              role: "user",
              content: content.map(c => {
                if (c.type === "image" || c.type === "document") {
                  return { type: "image_url", image_url: { url: `data:${c.source.media_type};base64,${c.source.data}` } };
                }
                return c;
              })
            }]
          }),
        });
        const data = await resp.json();
        const raw = data.choices?.[0]?.message?.content || "";
        result = JSON.parse(raw.replace(/```json|```/g, "").trim());
      } else {
        // Fallback to local server proxy
        const resp = await fetch("/api/parse-w2", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "openai/gpt-5.4-nano", messages: [{ role: "user", content }] }),
        });
        const data = await resp.json();
        const raw = typeof data.content === "string" ? data.content : (Array.isArray(data.content) ? data.content.find(b => b.type === "text")?.text : "") || "";
        result = JSON.parse(raw.replace(/```json|```/g, "").trim());
      }

      setParsed(result); onParsed(result); setStatus("done");
    } catch (err) { console.error(err); setStatus("error"); }
  };

  const borderColor = dragging ? t.uploadDragBorder : status === "done" ? t.green : status === "error" ? t.red : t.uploadBorder;

  return (
    <div style={{ marginTop: "16px" }}>
      <div style={{ fontSize: "11px", color: t.textDim, marginBottom: "8px", letterSpacing: "0.5px", fontWeight: "600" }}>SPOUSE W-2 — AI UPLOAD</div>
      {status !== "done" && (
        <div onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); parseW2(e.dataTransfer.files[0]); }}
          style={{ background: dragging ? t.uploadDragBg : t.uploadBg, border: `2px dashed ${borderColor}`, borderRadius: "10px", padding: "24px 20px", textAlign: "center", cursor: "pointer", transition: "all 0.15s" }}>
          <input ref={fileRef} type="file" accept=".pdf,image/*" style={{ display: "none" }} onChange={e => parseW2(e.target.files[0])} />
          {status === "idle" && (<><div style={{ fontSize: "24px", marginBottom: "6px" }}>📄</div><div style={{ fontSize: "13px", fontWeight: "600", color: t.text, marginBottom: "3px" }}>Drop W-2 or click to browse</div><div style={{ fontSize: "12px", color: t.textDim }}>PDF or image · Box 1 & 2 auto-extracted</div></>)}
          {status === "loading" && (<><style>{`@keyframes ks{to{transform:rotate(360deg)}}`}</style><div style={{ fontSize: "22px", display: "inline-block", animation: "ks 0.9s linear infinite", marginBottom: "6px" }}>⟳</div><div style={{ fontSize: "13px", color: t.textMuted }}>Reading W-2…</div></>)}
          {status === "error" && (<><div style={{ fontSize: "22px", marginBottom: "6px" }}>⚠️</div><div style={{ fontSize: "13px", color: t.red }}>Parse failed — try a clearer file</div><div style={{ fontSize: "12px", color: t.textDim, marginTop: "3px" }}>Click to retry</div></>)}
        </div>
      )}
      {status === "done" && parsed && (
        <div style={{ background: t.surface, border: `1px solid ${t.green}44`, borderLeft: `4px solid ${t.green}`, borderRadius: "10px", padding: "14px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <div style={{ fontSize: "13px", fontWeight: "600", color: t.green }}>✓ W-2 extracted</div>
            <button onClick={() => { setStatus("idle"); setParsed(null); }} style={{ background: "none", border: `1px solid ${t.border2}`, borderRadius: "5px", color: t.textDim, padding: "3px 10px", fontSize: "11px", cursor: "pointer", fontFamily: "inherit" }}>Replace</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "7px" }}>
            {[["Employee", parsed.employeeName], ["Employer", parsed.employerName], ["Tax year", parsed.taxYear], ["Box 1 wages", parsed.box1_wages != null ? fmt(parsed.box1_wages) : null], ["Box 2 withheld", parsed.box2_federalWithheld != null ? fmt(parsed.box2_federalWithheld) : null], ["Box 6 medicare", parsed.box6_medicareWithheld != null ? fmt(parsed.box6_medicareWithheld) : null]].map(([label, val]) => (
              <div key={label} style={{ background: t.surface2, borderRadius: "6px", padding: "7px 9px" }}>
                <div style={{ fontSize: "10px", color: t.textDim, marginBottom: "2px" }}>{label.toUpperCase()}</div>
                <div style={{ fontSize: "12px", fontWeight: "600", color: t.text, fontFamily: "'DM Mono',monospace" }}>{val ?? "—"}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────
export default function WrytoffTaxOptimizer({ userProfile, onLogout }) {
  const companyName = userProfile?.companyName || "WRYTOFF";
  const [isDark, setIsDark] = useState(false);
  const t = isDark ? DARK : LIGHT;

  const td = userProfile?.taxData || {};
  const [expenses, setExpenses] = useState(td.expenses || []);
  const [w2Income, setW2Income] = useState(td.w2Income || 0);
  const [spouseIncome, setSpouseIncome] = useState(td.spouseIncome || 0);
  const [w2Withheld, setW2Withheld] = useState(td.w2Withheld || 0);
  const [spouseWithheld, setSpouseWithheld] = useState(td.spouseWithheld || 0);
  const [bizIncome, setBizIncome] = useState(td.bizIncome || 0);
  const [homeOfficeDed, setHomeOfficeDed] = useState(td.homeOfficeDed || 0);
  const [activeTab, setActiveTab] = useState("summary");
  const [showAddModal, setShowAddModal] = useState(false);
  const [expandedRow, setExpandedRow] = useState(null);
  const [flashFields, setFlashFields] = useState({});
  const [scenario, setScenario] = useState(td.scenario || { posture: "Standard", sepIra: 0, healthIns: 0, mileage: 0 });

  // Native cloud serialization layer
  useEffect(() => {
    if (!userProfile?.uid) return;
    const saveToCloud = async () => {
      try {
        await setDoc(doc(db, 'users', userProfile.uid), {
          taxData: { expenses, w2Income, spouseIncome, w2Withheld, spouseWithheld, bizIncome, homeOfficeDed, scenario }
        }, { merge: true });
      } catch (e) {
        console.error("Cloud auto-save failure:", e);
      }
    };
    const syncTimer = setTimeout(saveToCloud, 2000);
    return () => clearTimeout(syncTimer);
  }, [expenses, w2Income, spouseIncome, w2Withheld, spouseWithheld, bizIncome, homeOfficeDed, scenario, userProfile?.uid]);

  const flash = (fields) => {
    setFlashFields(fields);
    setTimeout(() => setFlashFields({}), 2200);
  };

  // ── Central dispatch — called by TaxBot to mutate app state ──
  const dispatch = useCallback((actions) => {
    const fieldsChanged = {};
    actions.forEach(action => {
      switch (action.type) {
        case "SET_W2_INCOME": setW2Income(action.value); fieldsChanged.w2Income = true; break;
        case "SET_SPOUSE_INCOME": setSpouseIncome(action.value); fieldsChanged.spouseIncome = true; break;
        case "SET_W2_WITHHELD": setW2Withheld(action.value); fieldsChanged.w2Withheld = true; break;
        case "SET_SPOUSE_WITHHELD": setSpouseWithheld(action.value); fieldsChanged.spouseWithheld = true; break;
        case "SET_BIZ_INCOME": setBizIncome(action.value); fieldsChanged.bizIncome = true; break;
        case "SET_HOME_OFFICE": setHomeOfficeDed(action.value); fieldsChanged.homeOfficeDed = true; break;
        case "ADD_EXPENSE":
          setExpenses(prev => [...prev, { id: nextId++, status: action.expense.status || "Likely Deductible", ...action.expense }]);
          fieldsChanged.expenses = true;
          break;
        case "REMOVE_EXPENSE":
          setExpenses(prev => prev.filter(e => e.vendor !== action.vendor));
          break;
        case "NAVIGATE":
          setActiveTab(action.tab);
          break;
        default: break;
      }
    });
    if (Object.keys(fieldsChanged).length) flash(fieldsChanged);
  }, []);

  const handleSpouseW2 = useCallback((p) => {
    if (p.box1_wages != null) setSpouseIncome(p.box1_wages);
    if (p.box2_federalWithheld != null) setSpouseWithheld(p.box2_federalWithheld);
  }, []);

  const handleMyW2 = useCallback((p) => {
    if (p.box1_wages != null) setW2Income(p.box1_wages);
    if (p.box2_federalWithheld != null) setW2Withheld(p.box2_federalWithheld);
  }, []);

  const addExpense = useCallback((exp) => {
    setExpenses(prev => [...prev, exp]);
  }, []);

  const removeExpense = useCallback((id) => {
    setExpenses(prev => prev.filter(e => e.id !== id));
  }, []);

  const updateExp = useCallback((id, field, val) => {
    setExpenses(prev => prev.map(e => e.id === id
      ? { ...e, [field]: (field === "bizPct" || field === "amount") ? parseFloat(val) || 0 : val }
      : e));
  }, []);

  const computeCalc = (extraOpts = {}) => {
    const expensesToUse = extraOpts.expenses || expenses;
    const homeOfficeToUse = extraOpts.homeOfficeDed ?? homeOfficeDed;
    const extraBizDed = extraOpts.extraBizDed || 0;
    const extraAGIDed = extraOpts.extraAGIDed || 0;

    const expDed = expensesToUse.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + calcDeductible(e);
      return acc;
    }, {});
    const equipDed = INITIAL_ASSETS.reduce((s, a) => s + a.cost, 0);
    const totalBizDed = Object.values(expDed).reduce((a, b) => a + b, 0) + homeOfficeToUse + extraBizDed;
    const netSE = Math.max(0, bizIncome - totalBizDed);
    const seTax = netSE * 0.9235 * 0.153;
    const seDed = seTax * 0.5;
    const totalIncome = w2Income + spouseIncome + bizIncome;
    const agi = totalIncome - seDed - extraAGIDed;
    const qbiDed = (agi <= QBI_THRESHOLD_MFJ && netSE > 0) ? netSE * QBI_RATE : 0;
    const stdDed = STANDARD_DEDUCTION_MFJ;
    const taxable = Math.max(0, agi - stdDed - qbiDed);
    const fedTax = calcFederalTax(taxable);
    const marginal = marginalRate(taxable);
    const withheld = w2Withheld + spouseWithheld;
    const liability = fedTax + seTax;
    const position = withheld - liability;

    const opts = [
      { title: "SEP-IRA contribution", tag: "Retirement", priority: "high", max: Math.min(netSE * 0.25, 69000) },
    ];
    return { expDed, equipDed, totalBizDed, netSE, seTax, seDed, totalIncome, agi, qbiDed, stdDed, taxable, fedTax, marginal, withheld, liability, position, opts };
  };

  const calc = useMemo(() => computeCalc(), [expenses, w2Income, spouseIncome, w2Withheld, spouseWithheld, bizIncome, homeOfficeDed]);
  const scenarioCalc = useMemo(() => computeCalc({
    extraBizDed: (scenario.mileage || 0) * 0.70,
    extraAGIDed: (scenario.sepIra || 0) + (scenario.healthIns || 0),
  }), [expenses, w2Income, spouseIncome, w2Withheld, spouseWithheld, bizIncome, homeOfficeDed, scenario]);

  const isRefund = calc.position >= 0;

  const catTotals = useMemo(() => {
    const totals = {};
    for (const e of expenses) totals[e.category] = (totals[e.category] || 0) + calcDeductible(e);
    totals["Equipment"] = INITIAL_ASSETS.reduce((s, a) => s + a.cost, 0);
    totals["Home Office Mortgage"] = homeOfficeDed;
    return totals;
  }, [expenses, homeOfficeDed]);

  const inp = (extra = {}) => ({ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: "6px", color: t.inputText, fontFamily: "'DM Mono',monospace", fontSize: "13px", padding: "7px 10px", outline: "none", ...extra });
  const bigInp = (extra = {}) => inp({ fontSize: "18px", fontWeight: "600", padding: "9px 12px", width: "100%", boxSizing: "border-box", ...extra });

  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState(false);

  const handleSendCPA = async () => {
    const targetEmail = prompt("Enter CPA email address:", "dferdows@gmail.com");
    if (!targetEmail) return;

    setSendingEmail(true);
    try {
      const html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #111;">
          <h2 style="color: #047857;">Wrytoff 2026 Tax Hand-off</h2>
          <p>Here is the finalized tax state for ${companyName} exported directly from the platform.</p>
          
          <h3>1. Income Overview</h3>
          <ul>
            <li><strong>W-2 Income (Darius):</strong> $${w2Income.toLocaleString()} (Withheld: $${w2Withheld.toLocaleString()})</li>
            <li><strong>W-2 Income (Spouse):</strong> $${spouseIncome.toLocaleString()} (Withheld: $${spouseWithheld.toLocaleString()})</li>
            <li><strong>${companyName} Revenue:</strong> $${bizIncome.toLocaleString()}</li>
          </ul>

          <h3>2. Final Estimates</h3>
          <ul>
            <li><strong>Estimated AGI:</strong> $${Math.round(calc.agi).toLocaleString()}</li>
            <li><strong>Effective Tax Rate:</strong> ${((calc.liability / Math.max(calc.totalIncome, 1)) * 100).toFixed(1)}%</li>
            <li><strong>Estimated Position:</strong> ${isRefund ? "Refund" : "Owed"} of $${Math.floor(Math.abs(calc.position)).toLocaleString()}</li>
          </ul>

          <h3>3. Business Expenses Captured</h3>
          <table border="1" cellpadding="8" style="border-collapse: collapse; width: 100%; border: 1px solid #ddd; font-size: 14px;">
            <thead>
              <tr style="background: #f1f5f9; text-align: left;">
                <th>Vendor</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Biz Use %</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${expenses.map(e => `
                <tr>
                  <td>${e.vendor}</td>
                  <td>${e.category}</td>
                  <td>$${e.amount}</td>
                  <td>${Math.round(e.bizPct * 100)}%</td>
                  <td>${e.status || "Likely Deductible"}</td>
                </tr>
              `).join('')}
              <tr>
                <td><strong>Home Office</strong></td>
                <td>Housing & Real Estate</td>
                <td>$${homeOfficeDed}</td>
                <td>100%</td>
                <td>Calculated manually</td>
              </tr>
            </tbody>
          </table>

          <h3>4. Assumptions / Safe Harbor</h3>
          <p>This report includes the standard deduction ($${calc.stdDed.toLocaleString()}), and applies half SE-tax deductibility automatically. QBI applied: $${Math.round(calc.qbiDed).toLocaleString()}.</p>
        </div>
      `;

      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, to: targetEmail })
      });
      const data = await res.json();
      if (res.ok) {
        setEmailSuccess(true);
        setTimeout(() => setEmailSuccess(false), 3000);
      } else {
        alert("Failed to send: " + data.error);
      }
    } catch (err) {
      alert("Error sending email: " + err.message);
    } finally {
      setSendingEmail(false);
    }
  };

  const exportCSV = () => {
    const headers = ["Vendor", "Category", "Amount", "Biz %", "Deductible", "Estimated Savings", "Status"];
    const rows = expenses.map(e => [
      `"${e.vendor.replace(/"/g, '""')}"`,
      `"${e.category}"`,
      e.amount,
      e.bizPct,
      calcDeductible(e),
      calcDeductible(e) * calc.marginal,
      `"${(e.category === "Meals & Entertainment" ? "50% Limit" : e.status) || "Likely Deductible"}"`
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "wrytoff_expenses_2026.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const fileInputRef = useRef(null);
  const handleImportCSV = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result;
      const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
      if (lines.length < 2) return alert("CSV needs headers and at least one row.");

      const headers = lines[0].toLowerCase().split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(h => h.trim().replace(/^"|"$/g, ''));
      const vendorIdx = headers.findIndex(h => h.includes("vendor"));
      const categoryIdx = headers.findIndex(h => h.includes("category"));
      const amountIdx = headers.findIndex(h => h.includes("amount"));
      const bizIdx = headers.findIndex(h => h.includes("biz") || h.includes("%"));

      if (vendorIdx === -1 || categoryIdx === -1 || amountIdx === -1) {
        return alert("CSV must contain 'Vendor', 'Category', and 'Amount' headers.");
      }

      const actions = [];
      for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(cell => cell.trim().replace(/^"|"$/g, ''));
        const vendor = row[vendorIdx];
        const category = row[categoryIdx];
        const amount = parseFloat((row[amountIdx] || "").replace(/[^0-9.-]+/g, ""));

        if (!vendor || !category || isNaN(amount)) continue;

        let bizPct = 1.0;
        if (bizIdx !== -1 && row[bizIdx]) {
          const pb = parseFloat((row[bizIdx] || "").replace(/[^0-9.-]+/g, ""));
          if (!isNaN(pb)) bizPct = pb > 1 ? pb / 100 : pb;
        }

        actions.push({
          type: "ADD_EXPENSE",
          expense: { vendor, category, amount, bizPct, status: "Likely Deductible" }
        });
      }

      if (actions.length > 0) {
        dispatch(actions);
        alert(`Successfully imported ${actions.length} expenses!`);
      } else {
        alert("No valid expense rows found.");
      }
    };
    reader.readAsText(file);
    e.target.value = null; // reset input
  };

  return (
    <div style={{ fontFamily: "'DM Sans','Segoe UI',sans-serif", background: t.bg, color: t.text, minHeight: "100vh", overflowX: "hidden", width: "100%", boxSizing: "border-box" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {showAddModal && <AddExpenseModal onAdd={addExpense} onClose={() => setShowAddModal(false)} t={t} />}

      {/* Header */}
      <div style={{ background: t.headerBg, borderBottom: `1px solid ${t.border}`, padding: "18px 20px 0", boxSizing: "border-box", width: "100%" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "18px", gap: "12px", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "10px", letterSpacing: "3px", color: t.textDim, fontFamily: "'DM Mono',monospace", marginBottom: "4px" }}>{companyName.toUpperCase()} · TAX YEAR 2026 · MFJ</div>
            <div style={{ fontSize: "22px", fontWeight: "600", color: t.text, letterSpacing: "-0.5px" }}>Tax Refund Optimizer</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", flexShrink: 0 }}>
            {activeTab === "summary" && (
              <button
                onClick={handleSendCPA}
                disabled={sendingEmail}
                style={{ background: emailSuccess ? t.green : t.blue, border: "none", borderRadius: "20px", padding: "6px 14px", cursor: sendingEmail ? "wait" : "pointer", fontSize: "12px", color: emailSuccess ? "#022c22" : "#fff", fontWeight: "600", display: "flex", alignItems: "center", gap: "6px", fontFamily: "inherit", transition: "background 0.2s" }}
              >
                <span>{emailSuccess ? "✓ Sent" : sendingEmail ? "Sending..." : "📤 Send to CPA"}</span>
              </button>
            )}
            <button onClick={() => setIsDark(d => !d)} style={{ background: t.surface, border: `1px solid ${t.border2}`, borderRadius: "20px", padding: "6px 14px", cursor: "pointer", fontSize: "12px", color: t.textMuted, display: "flex", alignItems: "center", gap: "6px", fontFamily: "inherit" }}>
              <span style={{ fontSize: "14px" }}>{isDark ? "☀️" : "🌙"}</span><span>{isDark ? "Light" : "Dark"}</span>
            </button>
            {onLogout && (
              <button onClick={onLogout} style={{ background: "transparent", border: `1px solid ${t.border2}`, borderRadius: "20px", padding: "6px 14px", cursor: "pointer", fontSize: "12px", color: t.redMid, display: "flex", alignItems: "center", fontFamily: "inherit", fontWeight: "500" }}>
                Log Out
              </button>
            )}
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "10px", color: t.textDim, marginBottom: "2px", fontFamily: "'DM Mono',monospace" }}>EST. POSITION</div>
              <div style={{ fontSize: "28px", fontWeight: "600", color: isRefund ? t.green : t.red, fontFamily: "'DM Mono',monospace", letterSpacing: "-1px" }}>
                {isRefund ? "+" : "−"}{fmt(calc.position)}
              </div>
              <div style={{ fontSize: "11px", color: isRefund ? t.greenMid : t.redMid }}>{isRefund ? "estimated refund" : "estimated owed"}</div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", overflowX: "auto", scrollbarWidth: "none" }}>
          {["summary", "expenses", "income", "optimizations", "playbook"].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{ background: "none", border: "none", borderBottom: activeTab === tab ? `2px solid ${t.blue}` : "2px solid transparent", color: activeTab === tab ? t.blue : t.textDim, padding: "9px 16px", fontSize: "13px", fontWeight: "500", cursor: "pointer", textTransform: "capitalize", transition: "all 0.15s", fontFamily: "inherit", whiteSpace: "nowrap" }}>{tab}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: "20px 20px 120px", boxSizing: "border-box", width: "100%", maxWidth: "100%" }}>

        {/* ── SUMMARY ── */}
        {activeTab === "summary" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px", marginBottom: "22px" }}>
              {[
                { label: "Total Income", value: fmtK(calc.totalIncome), sub: "W-2 + spouse + biz", color: t.blue, fl: flashFields.w2Income || flashFields.spouseIncome || flashFields.bizIncome },
                { label: "AGI", value: fmtK(calc.agi), sub: "after SE deduction", color: t.purple, fl: false },
                { label: "Total Deductions", value: fmtK(calc.totalBizDed + calc.stdDed), sub: "biz + standard", color: t.green, fl: flashFields.expenses || flashFields.homeOfficeDed },
                { label: "Taxable Income", value: fmtK(calc.taxable), sub: `${pct(calc.marginal)} marginal`, color: t.orange, fl: false },
              ].map(m => (
                <div key={m.label} style={{
                  background: m.fl ? (isDark ? "#0f2a1e" : "#f0fdf4") : t.surface,
                  border: `1px solid ${m.fl ? t.green + "99" : t.border}`,
                  borderRadius: "10px", padding: "14px 14px", minWidth: 0,
                  transition: "background 0.5s, border-color 0.5s",
                }}>
                  <div style={{ fontSize: "10px", color: t.textDim, marginBottom: "5px", letterSpacing: "0.5px", lineHeight: "1.3" }}>{m.label.toUpperCase()}</div>
                  <div style={{ fontSize: "22px", fontWeight: "600", color: m.fl ? t.green : m.color, fontFamily: "'DM Mono',monospace", lineHeight: "1.2", transition: "color 0.5s" }}>{m.value}</div>
                  <div style={{ fontSize: "11px", color: t.textFaint, marginTop: "4px" }}>{m.sub}</div>
                </div>
              ))}
            </div>

            <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "12px", padding: "20px 24px", marginBottom: "18px" }}>
              <div style={{ fontSize: "11px", fontWeight: "600", color: t.textMuted, marginBottom: "14px", letterSpacing: "0.5px" }}>TAX WATERFALL</div>
              {[
                { label: "Gross business income", value: fmt(bizIncome), color: t.blue },
                { label: "Business deductions", value: "− " + fmt(calc.totalBizDed), color: t.red, indent: 1 },
                { label: "Net SE income / (loss)", value: fmt(calc.netSE), color: t.text, bold: true, divider: true },
                { label: "Self-employment tax (15.3%)", value: fmt(calc.seTax), color: t.red, indent: 1 },
                { label: "½ SE tax deduction", value: "− " + fmt(calc.seDed), color: t.redMid, indent: 2, small: true },
                { label: "Your W-2 income", value: fmt(w2Income), color: t.blue },
                { label: "Spouse W-2 income", value: fmt(spouseIncome), color: t.blue },
                { label: "Adjusted Gross Income", value: fmt(calc.agi), color: t.text, bold: true, divider: true },
                { label: "Standard deduction (MFJ)", value: "− " + fmt(calc.stdDed), color: t.red, indent: 1 },
                { label: "QBI deduction", value: calc.qbiDed > 0 ? "− " + fmt(calc.qbiDed) : "—", color: t.red, indent: 1, small: true },
                { label: "Taxable Income", value: fmt(calc.taxable), color: t.text, bold: true, divider: true },
                { label: "Federal income tax", value: fmt(calc.fedTax), color: t.red, indent: 1 },
                { label: "Self-employment tax", value: fmt(calc.seTax), color: t.red, indent: 1 },
                { label: "Total Tax Liability", value: fmt(calc.liability), color: t.red, bold: true, divider: true },
                { label: "Your withholding", value: fmt(w2Withheld), color: t.green, indent: 1 },
                { label: "Spouse withholding", value: fmt(spouseWithheld), color: t.green, indent: 1 },
                { label: "Total Withheld", value: fmt(calc.withheld), color: t.green, bold: true },
              ].map((row, i) => (
                <div key={i}>
                  {row.divider && <div style={{ borderTop: `1px solid ${t.border}`, margin: "5px 0" }} />}
                  <div style={{ display: "flex", justifyContent: "space-between", padding: `${row.small ? "2px" : "5px"} 0 ${row.small ? "2px" : "5px"} ${(row.indent || 0) * 18}px` }}>
                    <span style={{ fontSize: row.bold ? "13px" : row.small ? "11px" : "12px", color: row.bold ? t.text : t.textMuted, fontWeight: row.bold ? "600" : "400" }}>{row.label}</span>
                    <span style={{ fontSize: row.bold ? "14px" : "13px", fontFamily: "'DM Mono',monospace", color: row.color, fontWeight: row.bold ? "600" : "400" }}>{row.value}</span>
                  </div>
                </div>
              ))}
              <div style={{ borderTop: `2px solid ${t.border2}`, marginTop: "8px", paddingTop: "12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "14px", fontWeight: "600", color: t.text }}>{isRefund ? "Estimated Refund" : "Estimated Amount Owed"}</span>
                <span style={{ fontSize: "22px", fontFamily: "'DM Mono',monospace", fontWeight: "600", color: isRefund ? t.green : t.red }}>{isRefund ? "+" : "−"}{fmt(calc.position)}</span>
              </div>
            </div>

            <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "12px", padding: "20px 24px" }}>
              <div style={{ fontSize: "11px", fontWeight: "600", color: t.textMuted, marginBottom: "12px", letterSpacing: "0.5px" }}>DEDUCTION BREAKDOWN</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: "9px" }}>
                {Object.entries(catTotals).map(([cat, val]) => {
                  const c = t.catColors[cat] || t.catColors["Office & Supplies"];
                  return (
                    <div key={cat} style={{ background: c.bg, borderLeft: `3px solid ${c.accent}`, borderRadius: "7px", padding: "10px 12px" }}>
                      <div style={{ fontSize: "10px", color: c.text, opacity: 0.8, marginBottom: "3px" }}>{cat.toUpperCase()}</div>
                      <div style={{ fontSize: "17px", fontWeight: "600", fontFamily: "'DM Mono',monospace", color: c.accent }}>{fmt(val)}</div>
                      <div style={{ fontSize: "10px", color: t.textFaint, marginTop: "2px" }}>~{fmt(val * calc.marginal)} saved</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── EXPENSES ── */}
        {activeTab === "expenses" && (() => {
          const missing = [];
          if (!expenses.some(e => e.category === "Travel & Transportation")) missing.push({ title: "Business Mileage", desc: "No vehicle expenses found. Do you drive to see clients?" });
          if (!expenses.some(e => e.vendor.toLowerCase().includes("internet") || e.vendor.toLowerCase().includes("wifi"))) missing.push({ title: "Internet / WiFi", desc: `You likely use internet for ${companyName}. The business-use percentage is deductible.` });
          if (homeOfficeDed === 0 && !expenses.some(e => e.category === "Housing & Real Estate")) missing.push({ title: "Home Office", desc: "Most consultants qualify for a home office deduction. Are you missing out?" });

          return (
            <div>
              {missing.length > 0 && (
                <div style={{ background: isDark ? "#0f2744" : "#eff6ff", border: `1px solid ${t.blue}44`, borderLeft: `4px solid ${t.blue}`, borderRadius: "10px", padding: "14px 18px", marginBottom: "16px" }}>
                  <div style={{ fontSize: "11px", fontWeight: "600", color: t.blue, marginBottom: "10px", letterSpacing: "0.5px" }}>💡 PROACTIVE ALERTS: MISSING DEDUCTIONS</div>
                  {missing.map((m, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: i < missing.length - 1 ? "12px" : "0" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "13px", fontWeight: "600", color: t.text }}>Missing: {m.title}?</div>
                        <div style={{ fontSize: "12px", color: t.textDim, marginTop: "2px" }}>{m.desc}</div>
                      </div>
                      <div style={{ fontSize: "11px", color: t.textFaint, fontStyle: "italic" }}>Ask Wrytoff AI</div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "10px" }}>
                <div style={{ fontSize: "13px", color: t.textDim }}>
                  At your {pct(calc.marginal)} bracket, every $1K deducted saves ~{fmt(calc.marginal * 1000)}.
                </div>
                <div style={{ display: "flex", gap: "10px" }}>
                  <input type="file" accept=".csv" ref={fileInputRef} style={{ display: "none" }} onChange={handleImportCSV} />
                  <button onClick={() => fileInputRef.current?.click()} style={{ background: t.surface, border: `1px solid ${t.border2}`, borderRadius: "8px", color: t.text, padding: "8px 14px", fontSize: "13px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit" }}>
                    Import CSV
                  </button>
                  <button onClick={exportCSV} style={{ background: t.surface, border: `1px solid ${t.border2}`, borderRadius: "8px", color: t.text, padding: "8px 14px", fontSize: "13px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit" }}>
                    Export CSV
                  </button>
                  <button onClick={() => setShowAddModal(true)} style={{ background: t.green, border: "none", borderRadius: "8px", color: "#022c22", padding: "8px 18px", fontSize: "13px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "16px" }}>+</span> Add expense
                  </button>
                </div>
              </div>

              <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "12px", overflow: "hidden" }}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", minWidth: "600px", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ background: t.surface2, borderBottom: `1px solid ${t.border}` }}>
                        {["Vendor", "Category", "Amount", "Biz %", "Deductible", "Saves", "Confidence", ""].map(h => (
                          <th key={h} style={{ padding: "10px 13px", textAlign: "left", fontSize: "10px", color: t.textFaint, fontWeight: "500", letterSpacing: "0.5px" }}>{h.toUpperCase()}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {expenses.map((e, i) => {
                        const ded = calcDeductible(e);
                        const c = t.catColors[e.category] || t.catColors["Office & Supplies"];
                        const rule = e.irsRule;
                        const expanded = expandedRow === e.id;
                        return (
                          <>
                            <tr key={e.id} style={{ borderBottom: `1px solid ${t.border}`, background: i % 2 === 0 ? "transparent" : t.surface2 + "88" }}>
                              <td style={{ padding: "8px 13px", color: t.text }}>{e.vendor}</td>
                              <td style={{ padding: "8px 13px" }}>
                                <span style={{ background: c.bg, color: c.text, border: `1px solid ${c.accent}33`, borderRadius: "4px", padding: "2px 7px", fontSize: "10px" }}>{e.category}</span>
                              </td>
                              <td style={{ padding: "8px 13px" }}>
                                <input type="number" value={e.amount === 0 ? "" : e.amount} onChange={ev => updateExp(e.id, "amount", ev.target.value)} style={inp({ width: "74px" })} />
                              </td>
                              <td style={{ padding: "8px 13px" }}>
                                {e.category === "Meals & Entertainment"
                                  ? <span style={{ color: t.textFaint, fontFamily: "'DM Mono',monospace", fontSize: "12px" }}>50% IRS</span>
                                  : <input type="number" min="0" max="1" step="0.05" value={e.bizPct === 0 ? "" : e.bizPct} onChange={ev => updateExp(e.id, "bizPct", ev.target.value)} style={inp({ width: "64px" })} />
                                }
                              </td>
                              <td style={{ padding: "8px 13px", fontFamily: "'DM Mono',monospace", color: t.green, fontWeight: "500" }}>{fmt(ded)}</td>
                              <td style={{ padding: "8px 13px", fontFamily: "'DM Mono',monospace", color: t.greenMid, fontSize: "12px" }}>~{fmt(ded * calc.marginal)}</td>
                              <td style={{ padding: "8px 13px" }}>
                                <span style={{
                                  background: e.category === "Meals & Entertainment" ? (isDark ? "#422006" : "#fefce8") : e.status === "High Scrutiny" ? (isDark ? "#422006" : "#fefce8") : e.status === "Needs Facts" ? (isDark ? "#1e293b" : "#f1f5f9") : (isDark ? "#064e3b" : "#f0fdf4"),
                                  color: e.category === "Meals & Entertainment" ? "#ca8a04" : e.status === "High Scrutiny" ? "#ca8a04" : e.status === "Needs Facts" ? "#64748b" : t.green,
                                  fontSize: "10px", padding: "3px 6px", borderRadius: "12px", border: `1px solid ${e.category === "Meals & Entertainment" ? "#ca8a0455" : e.status === "High Scrutiny" ? "#ca8a0455" : e.status === "Needs Facts" ? "#64748b55" : t.green + "55"}`, whiteSpace: "nowrap"
                                }}>
                                  {e.category === "Meals & Entertainment" ? "50% Limit" : (e.status || "Likely Deductible")}
                                </span>
                              </td>
                              <td style={{ padding: "8px 8px", whiteSpace: "nowrap" }}>
                                {rule && (
                                  <button onClick={() => setExpandedRow(expanded ? null : e.id)}
                                    style={{ background: "none", border: `1px solid ${t.border}`, borderRadius: "5px", color: t.textDim, padding: "3px 8px", fontSize: "10px", cursor: "pointer", fontFamily: "inherit", marginRight: "4px" }}>
                                    {expanded ? "▲" : "IRS"}
                                  </button>
                                )}
                                {e.id >= 100 && (
                                  <button onClick={() => removeExpense(e.id)}
                                    style={{ background: "none", border: `1px solid ${t.red}44`, borderRadius: "5px", color: t.red, padding: "3px 8px", fontSize: "10px", cursor: "pointer", fontFamily: "inherit" }}>
                                    ✕
                                  </button>
                                )}
                              </td>
                            </tr>
                            {expanded && rule && (
                              <tr key={`${e.id}-irs`} style={{ background: t.irsTagBg }}>
                                <td colSpan="7" style={{ padding: "10px 16px" }}>
                                  <div style={{ display: "flex", gap: "16px", alignItems: "flex-start", flexWrap: "wrap" }}>
                                    <div><span style={{ fontSize: "10px", color: t.textDim }}>IRS CODE</span><div style={{ fontSize: "12px", fontFamily: "'DM Mono',monospace", color: t.irsTagText, marginTop: "2px" }}>{rule.irsCode}</div></div>
                                    <div style={{ flex: 1 }}><span style={{ fontSize: "10px", color: t.textDim }}>RULE</span><div style={{ fontSize: "12px", color: t.textMuted, marginTop: "2px", lineHeight: "1.4" }}>{rule.notes}</div></div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: t.tfoot, borderTop: `1px solid ${t.border2}` }}>
                        <td colSpan="4" style={{ padding: "10px 13px", fontWeight: "600", color: t.textMuted, fontSize: "12px" }}>TOTAL EXPENSES</td>
                        <td style={{ padding: "10px 13px", fontFamily: "'DM Mono',monospace", color: t.green, fontWeight: "600", fontSize: "14px" }}>
                          {fmt(expenses.reduce((s, e) => s + calcDeductible(e), 0))}
                        </td>
                        <td style={{ padding: "10px 13px", fontFamily: "'DM Mono',monospace", color: t.greenMid, fontSize: "12px" }}>
                          ~{fmt(expenses.reduce((s, e) => s + calcDeductible(e), 0) * calc.marginal)}
                        </td>
                        <td colSpan="2" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "12px", padding: "16px 20px", marginTop: "12px" }}>
                <div style={{ fontSize: "11px", fontWeight: "600", color: t.textMuted, marginBottom: "10px", letterSpacing: "0.5px" }}>EQUIPMENT (SECTION 179 / EXPENSED)</div>
                {INITIAL_ASSETS.map(a => (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "7px" }}>
                    <span style={{ color: t.text, flex: 1, fontSize: "13px" }}>{a.item}</span>
                    <span style={{ background: t.irsTagBg, color: t.irsTagText, border: `1px solid ${t.irsTagBorder}`, borderRadius: "4px", padding: "2px 8px", fontSize: "10px" }}>{a.method}</span>
                    <span style={{ fontFamily: "'DM Mono',monospace", color: t.green, fontSize: "13px" }}>{fmt(a.cost)}</span>
                    <span style={{ fontFamily: "'DM Mono',monospace", color: t.greenMid, fontSize: "12px" }}>~{fmt(a.cost * calc.marginal)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* ── INCOME ── */}
        {activeTab === "income" && (
          <div>
            <div style={{ fontSize: "13px", color: t.textDim, marginBottom: "18px" }}>All figures flow into your joint 1040. Upload your wife's W-2 to auto-fill Box 1 & Box 2.</div>
            <div style={{ fontSize: "11px", fontWeight: "600", color: t.textMuted, marginBottom: "10px", letterSpacing: "0.5px" }}>YOUR W-2</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "12px", marginBottom: "20px" }}>
              {[{ label: "Wages (Box 1)", value: w2Income, set: setW2Income, desc: "Gross wages from your employer" }, { label: "Federal withheld (Box 2)", value: w2Withheld, set: setW2Withheld, desc: "From Box 2 of your W-2" }].map(f => (
                <div key={f.label} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "10px", padding: "14px 16px" }}>
                  <div style={{ fontSize: "10px", color: t.textDim, marginBottom: "6px", letterSpacing: "0.5px" }}>{f.label.toUpperCase()}</div>
                  <input type="number" value={f.value === 0 ? "" : f.value} onChange={e => f.set(parseFloat(e.target.value) || 0)} style={bigInp()} />
                  <div style={{ fontSize: "11px", color: t.textFaint, marginTop: "6px" }}>{f.desc}</div>
                </div>
              ))}
            </div>
            <W2Uploader onParsed={handleMyW2} t={t} />
            <div style={{ fontSize: "11px", fontWeight: "600", color: t.textMuted, marginBottom: "10px", letterSpacing: "0.5px" }}>SPOUSE W-2</div>
            <div style={{ fontSize: "11px", fontWeight: "600", color: t.textMuted, marginBottom: "10px", letterSpacing: "0.5px", marginTop: "24px" }}>SPOUSE W-2</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "12px", marginBottom: "20px" }}>
              {[{ label: "Spouse wages (Box 1)", value: spouseIncome, set: setSpouseIncome, desc: "Auto-filled from W-2 upload below" }, { label: "Spouse withheld (Box 2)", value: spouseWithheld, set: setSpouseWithheld, desc: "Auto-filled from W-2 upload below" }].map(f => (
                <div key={f.label} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "10px", padding: "14px 16px" }}>
                  <div style={{ fontSize: "10px", color: t.textDim, marginBottom: "6px", letterSpacing: "0.5px" }}>{f.label.toUpperCase()}</div>
                  <input type="number" value={f.value === 0 ? "" : f.value} onChange={e => f.set(parseFloat(e.target.value) || 0)} style={bigInp()} />
                  <div style={{ fontSize: "11px", color: t.textFaint, marginTop: "6px" }}>{f.desc}</div>
                </div>
              ))}
            </div>
            <W2Uploader onParsed={handleSpouseW2} t={t} />
            <div style={{ fontSize: "11px", fontWeight: "600", color: t.textMuted, margin: "20px 0 10px", letterSpacing: "0.5px" }}>{companyName.toUpperCase()} REVENUE</div>
            <div style={{ fontSize: "11px", fontWeight: "600", color: t.textMuted, margin: "24px 0 10px", letterSpacing: "0.5px" }}>{companyName.toUpperCase()} REVENUE</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "12px" }}>
              {[{ label: `${companyName} gross revenue`, value: bizIncome, set: setBizIncome, desc: "Total gross receipts/sales" }, { label: "Home office deduction", value: homeOfficeDed, set: setHomeOfficeDed, desc: "Mortgage/rent portion for home office" }].map(f => (
                <div key={f.label} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "10px", padding: "14px 16px" }}>
                  <div style={{ fontSize: "10px", color: t.textDim, marginBottom: "6px", letterSpacing: "0.5px" }}>{f.label.toUpperCase()}</div>
                  <input type="number" value={f.value === 0 ? "" : f.value} onChange={e => f.set(parseFloat(e.target.value) || 0)} style={bigInp()} />
                  <div style={{ fontSize: "11px", color: t.textFaint, marginTop: "6px" }}>{f.desc}</div>
                </div>
              ))}
            </div>
            <div style={{ background: t.effectiveBg, border: `1px solid ${t.effectiveBorder}`, borderRadius: "10px", padding: "14px 18px", marginTop: "14px" }}>
              <div style={{ fontSize: "10px", color: t.effectiveLabel, marginBottom: "3px", letterSpacing: "0.5px" }}>EFFECTIVE TAX RATE</div>
              <div style={{ fontSize: "22px", fontFamily: "'DM Mono',monospace", color: t.effectiveNum, fontWeight: "600" }}>{((calc.liability / Math.max(calc.totalIncome, 1)) * 100).toFixed(1)}%</div>
              <div style={{ fontSize: "11px", color: t.textFaint, marginTop: "3px" }}>{fmt(calc.liability)} liability ÷ {fmt(calc.totalIncome)} total income · marginal: {pct(calc.marginal)}</div>
            </div>
          </div>
        )}

        {/* ── SCENARIO PLANNER ── */}
        {activeTab === "optimizations" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px", flexWrap: "wrap", gap: "10px", background: t.surface, border: `1px solid ${t.border}`, borderRadius: "10px", padding: "16px 20px" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "11px", fontWeight: "600", color: t.textDim, letterSpacing: "0.5px", marginBottom: "4px" }}>CURRENT ESTIMATE</div>
                <div style={{ fontSize: "20px", fontFamily: "'DM Mono',monospace", color: isRefund ? t.green : t.red, fontWeight: "600" }}>{isRefund ? "+" : "−"}{fmt(calc.position)}</div>
              </div>
              <div style={{ flex: 1, textAlign: "right", borderLeft: `1px solid ${t.border}`, paddingLeft: "20px" }}>
                <div style={{ fontSize: "11px", fontWeight: "600", color: t.blue, letterSpacing: "0.5px", marginBottom: "4px" }}>SCENARIO PLANNED</div>
                <div style={{ fontSize: "28px", fontFamily: "'DM Mono',monospace", color: scenarioCalc.position >= 0 ? t.blue : t.red, fontWeight: "600", letterSpacing: "-1px" }}>{scenarioCalc.position >= 0 ? "+" : "−"}{fmt(scenarioCalc.position)}</div>
              </div>
            </div>

            <div style={{ fontSize: "13px", color: t.textDim, marginBottom: "16px" }}>Move the sliders to model exactly how different actions impact your tax bill before year end.</div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "10px", padding: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: t.text }}>SEP-IRA Contribution</div>
                  <div style={{ fontSize: "14px", fontFamily: "'DM Mono',monospace", color: t.blue, fontWeight: "600" }}>{fmt(scenario.sepIra)}</div>
                </div>
                <div style={{ fontSize: "11px", color: t.textMuted, marginBottom: "10px" }}>
                  Contribute up to 25% of net profit (max {fmt(calc.opts[0].max)}). Reduces AGI dollar-for-dollar.
                  {calc.opts[0].max === 0 && <span style={{ color: t.redMid, marginLeft: "4px" }}>(Requires net business profit to contribute)</span>}
                </div>
                <input type="range" min="0" max={Math.max(1000, Math.round(calc.opts[0].max))} step="1000" disabled={calc.opts[0].max === 0} value={scenario.sepIra} onChange={e => setScenario({ ...scenario, sepIra: parseInt(e.target.value) || 0 })} style={{ width: "100%", cursor: calc.opts[0].max === 0 ? "not-allowed" : "pointer", opacity: calc.opts[0].max === 0 ? 0.5 : 1 }} />
              </div>

              <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "10px", padding: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: t.text }}>Self-Employed Health Insurance</div>
                  <div style={{ fontSize: "14px", fontFamily: "'DM Mono',monospace", color: t.blue, fontWeight: "600" }}>{fmt(scenario.healthIns)}</div>
                </div>
                <div style={{ fontSize: "11px", color: t.textMuted, marginBottom: "10px" }}>100% deductible if you pay premiums for medical/dental out of pocket.</div>
                <input type="range" min="0" max="25000" step="500" value={scenario.healthIns} onChange={e => setScenario({ ...scenario, healthIns: parseInt(e.target.value) || 0 })} style={{ width: "100%", cursor: "pointer" }} />
              </div>

              <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "10px", padding: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: t.text }}>Log Business Mileage</div>
                  <div style={{ fontSize: "14px", fontFamily: "'DM Mono',monospace", color: t.blue, fontWeight: "600" }}>{scenario.mileage} miles</div>
                </div>
                <div style={{ fontSize: "11px", color: t.textMuted, marginBottom: "10px" }}>Deduct $0.70 per business mile driven.</div>
                <input type="range" min="0" max="15000" step="100" value={scenario.mileage} onChange={e => setScenario({ ...scenario, mileage: parseInt(e.target.value) || 0 })} style={{ width: "100%", cursor: "pointer" }} />
              </div>
            </div>

            <div style={{ background: t.effectiveBg, border: `1px solid ${t.effectiveBorder}`, borderRadius: "10px", padding: "13px 16px", marginTop: "16px" }}>
              <div style={{ fontSize: "10px", color: t.effectiveLabel, marginBottom: "4px", letterSpacing: "0.5px", fontWeight: "600" }}>ASSUMPTIONS USED</div>
              <div style={{ fontSize: "12px", color: t.textMuted, lineHeight: "1.6" }}>These optimizations compute dynamically using your current {pct(calc.marginal)} marginal bracket. They accurately factor in interactions with self-employment tax and the standard deduction. Does not include State tax.</div>
            </div>
          </div>
        )}

        {/* ── DEDUCTION PLAYBOOK ── */}
        {activeTab === "playbook" && <DeductionPlaybook t={t} />}

      </div>

      {/* ── TAX BOT ── */}
      <TaxBot
        t={t} isDark={isDark} calc={calc} expenses={expenses}
        w2Income={w2Income} spouseIncome={spouseIncome} bizIncome={bizIncome}
        homeOfficeDed={homeOfficeDed} w2Withheld={w2Withheld} spouseWithheld={spouseWithheld}
        dispatch={dispatch} setActiveTab={setActiveTab} companyName={companyName}
      />
    </div>
  );
}

// ─────────────────────────────────────────────
// TAXBOT — agentic floating pill chatbot
// ─────────────────────────────────────────────
function TaxBot({ t, isDark, calc, expenses, w2Income, spouseIncome, bizIncome, homeOfficeDed, w2Withheld, spouseWithheld, dispatch, setActiveTab, companyName }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", content: `Hi! I'm Wrytoff AI. I can answer questions AND update your tax data directly — just tell me things like your home square footage, mortgage interest paid, or any new expenses and I'll calculate and apply them for you.` }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [applied, setApplied] = useState(null); // { summary: string }
  const bottomRef = useRef();
  const inputRef = useRef();

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 120);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
    }
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const buildSystemPrompt = () => {
    const expSummary = expenses.map(e =>
      `• ${e.vendor} (${e.category}): $${e.amount}/yr, ${Math.round(e.bizPct * 100)}% biz → $${Math.round(calcDeductible(e))} deductible`
    ).join("\n");

    const missing = [];
    if (!expenses.some(e => e.category === "Travel & Transportation")) missing.push("Business Mileage");
    if (!expenses.some(e => e.vendor.toLowerCase().includes("internet") || e.vendor.toLowerCase().includes("wifi"))) missing.push("Internet / WiFi");
    if (homeOfficeDed === 0 && !expenses.some(e => e.category === "Housing & Real Estate")) missing.push("Home Office (deduct % of rent or mortgage)");
    const missingText = missing.length > 0 ? `Likely Missing Deductions: ${missing.join(", ")}` : "No obvious missing deductions identified.";

    const irsRulesText = Object.entries(IRS_LIBRARY).map(([group, rules]) =>
      `${group}:\n` + rules.map(r =>
        `  - ${r.name}: ${r.deductPct === 0 ? "NOT deductible" : r.deductPct === 0.50 ? "50% deductible" : r.bizOnly ? "Business-use % deductible" : "100% deductible"} (${r.irsCode}) — ${r.notes}`
      ).join("\n")
    ).join("\n\n");

    return `You are Wrytoff AI, an agentic US tax assistant for ${companyName} (single-member LLC, 2026). You can both ANSWER questions and TAKE ACTIONS that update the tax calculator in real time.

CURRENT STATE:
- W-2 income (Darius): $${w2Income.toLocaleString()}
- Spouse W-2: $${spouseIncome.toLocaleString()}
- W-2 withheld: $${w2Withheld.toLocaleString()}
- Spouse withheld: $${spouseWithheld.toLocaleString()}
- ${companyName} revenue: $${bizIncome.toLocaleString()}
- Home office deduction: $${homeOfficeDed.toLocaleString()}
- Total biz deductions: $${Math.round(calc.totalBizDed).toLocaleString()}
- AGI: $${Math.round(calc.agi).toLocaleString()}
- Marginal rate: ${Math.round(calc.marginal * 100)}%
- Est. position: ${calc.position >= 0 ? "+" : ""}$${Math.round(calc.position).toLocaleString()} (${calc.position >= 0 ? "refund" : "owed"})
- ${missingText}

CURRENT EXPENSES:
${expSummary}

PLATFORM NAVIGATION / HELP:
If user asks how to use this platform, explain the tabs:
- Summary: Fast visualization of your total tax liability, effective rate, and refund/owed status.
- Expenses (Deduction Center): Log your business expenses. We auto-flag missing deductions based on your business type.
- Income: Input W-2s and business revenue. You can upload W-2s to autofill.
- Optimizations (Scenario Planner): Use sliders to "what-if" test strategies like SEP-IRA or Health Insurance before year-end.
- Playbook (Deduction Playbook): Read exactly what qualifies, common mistakes, and what records you need for an audit (very important for answering questions about "what can I deduct").

IRS RULES:
${irsRulesText}

ACTION PROTOCOL:
When the user provides data you can act on (home sq footage, mortgage interest, new expenses, income changes, etc.), you MUST include a JSON block in your response to update the calculator. Format:

\`\`\`actions
[
  { "type": "SET_HOME_OFFICE", "value": 4500, "reason": "Home office % of mortgage interest" },
  { "type": "ADD_EXPENSE", "expense": { "vendor": "Chase Mortgage", "category": "Housing & Real Estate", "amount": 24000, "bizPct": 0.12, "status": "Likely Deductible" }, "reason": "12% home office allocation" },
  { "type": "SET_W2_INCOME", "value": 240000 },
  { "type": "NAVIGATE", "tab": "expenses" }
]
\`\`\`

Available action types:
- SET_W2_INCOME / SET_SPOUSE_INCOME / SET_W2_WITHHELD / SET_SPOUSE_WITHHELD / SET_BIZ_INCOME — value: number
- SET_HOME_OFFICE — value: number (dollar amount deductible)
- ADD_EXPENSE — expense: { vendor, category, amount, bizPct, status } where category must be one of: "Housing & Real Estate", "Utilities", "Software & Subscriptions", "Meals & Entertainment", "Travel & Transportation", "Professional Services", "Education & Development", "Marketing & Advertising", "Equipment & Hardware", "Insurance", "Retirement & Benefits", "Office & Supplies". status MUST be one of: "Likely Deductible", "Partially Deductible", "Needs Facts", "High Scrutiny", "Not Deductible".
- NAVIGATE — tab: "summary" | "expenses" | "income" | "optimizations" | "playbook"

RESPONSE FORMAT:
When a user asks about an expense deductibility, structure your natural language response exactly like this (use bold markdown):
**Deductibility:** [Likely Yes / Partially / No / Needs Facts / High Scrutiny]
**Amount:** [Full / Limited / Percentage Based]
**Why:** [1-2 sentences plain English]
**Dependencies:** [e.g. Requires exclusive business use]
**Required Records:** [e.g. Receipts, mileage log]
**Risk Posture:** [Standard / Aggressive / Conservative]

RULES:
- Always include the actions block when you have data to apply — never just describe what SHOULD happen.
- Use the structured response format for ALL questions about specific expenses or deductions.
- If you need more info before acting, ask exactly what's missing.
- Keep explanations under 150 words.
- Always show the estimated tax savings from any new deduction you add.`;
  };

  // Parse actions from AI reply and execute them
  const executeActions = (reply) => {
    const match = reply.match(/```actions\s*([\s\S]*?)```/);
    if (!match) return null;
    try {
      const actions = JSON.parse(match[1].trim());
      if (!Array.isArray(actions) || actions.length === 0) return null;
      dispatch(actions);
      const summary = actions.map(a => {
        if (a.type === "ADD_EXPENSE") return `Added "${a.expense.vendor}"`;
        if (a.type === "SET_HOME_OFFICE") return `Home office → $${a.value.toLocaleString()}`;
        if (a.type === "SET_W2_INCOME") return `Your W-2 → $${a.value.toLocaleString()}`;
        if (a.type === "SET_SPOUSE_INCOME") return `Spouse income → $${a.value.toLocaleString()}`;
        if (a.type === "SET_BIZ_INCOME") return `${companyName} revenue → $${a.value.toLocaleString()}`;
        if (a.type === "SET_W2_WITHHELD") return `Your withholding → $${a.value.toLocaleString()}`;
        if (a.type === "SET_SPOUSE_WITHHELD") return `Spouse withholding → $${a.value.toLocaleString()}`;
        if (a.type === "NAVIGATE") return `Navigated to ${a.tab}`;
        return null;
      }).filter(Boolean).join(" · ");
      return summary || "Fields updated";
    } catch {
      return null;
    }
  };

  // Strip the actions block from the displayed message
  const cleanReply = (reply) => reply.replace(/```actions[\s\S]*?```/g, "").trim();

  const callAI = async (msgs) => {
    const key = import.meta.env.VITE_OPENROUTER_API_KEY;
    if (key) {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({
          model: "anthropic/claude-3.5-sonnet",
          messages: [
            { role: "system", content: buildSystemPrompt() },
            ...msgs.map(m => ({ role: m.role, content: m.content }))
          ]
        })
      });
      const data = await resp.json();
      return data.choices?.[0]?.message?.content || "Sorry, I couldn't get a response.";
    }

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-5.4-nano",
        system: buildSystemPrompt(),
        messages: msgs.map(m => ({ role: m.role, content: m.content })),
      }),
    });
    const data = await response.json();
    return typeof data.content === "string"
      ? data.content
      : (Array.isArray(data.content) ? data.content.find(b => b.type === "text")?.text : "Sorry, I couldn't get a response.");
  };

  const processReply = (rawReply) => {
    const actionSummary = executeActions(rawReply);
    const clean = cleanReply(rawReply);
    if (actionSummary) {
      setApplied({ summary: actionSummary });
      setTimeout(() => setApplied(null), 4000);
    }
    return clean;
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const userMsg = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setLoading(true);
    try {
      const raw = await callAI(newMessages);
      const clean = processReply(raw);
      setMessages(prev => [...prev, { role: "assistant", content: clean }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Connection error — please try again." }]);
    }
    setLoading(false);
  };

  const sendQuick = async (q) => {
    if (loading) return;
    const userMsg = { role: "user", content: q };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    setLoading(true);
    try {
      const raw = await callAI(newMsgs);
      const clean = processReply(raw);
      setMessages(prev => [...prev, { role: "assistant", content: clean }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Connection error." }]);
    }
    setLoading(false);
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const pillBg = isDark ? "rgba(17,24,39,0.96)" : "rgba(255,255,255,0.98)";
  const chatBg = isDark ? "#0f172a" : "#f8fafc";
  const userBubble = isDark ? "#1d4ed8" : "#2563eb";
  const asstBubble = isDark ? "#1e293b" : "#f1f5f9";
  const borderClr = isDark ? "#334155" : "#e2e8f0";
  const glowColor = isDark ? "rgba(52,211,153,0.4)" : "rgba(37,99,235,0.22)";
  const pillAccent = isDark ? t.green : t.blue;

  const QUICK_PROMPTS = [
    "What's my home office deduction?",
    "Add my mortgage interest",
    "What am I missing?",
    "How do I maximize my refund?",
  ];

  return (
    <>
      <style>{`
        @keyframes kpulse {
          0%,100% { box-shadow: 0 0 0 0 ${glowColor}, 0 4px 24px rgba(0,0,0,0.14); }
          50%      { box-shadow: 0 0 0 7px transparent, 0 4px 24px rgba(0,0,0,0.14); }
        }
        @keyframes kslide {
          from { opacity:0; transform: translateY(14px) scale(0.96); }
          to   { opacity:1; transform: translateY(0) scale(1); }
        }
        @keyframes kdots {
          0%,80%,100% { opacity:0.2; transform:scale(0.75); }
          40%          { opacity:1;   transform:scale(1); }
        }
        @keyframes kapplied {
          0%   { opacity:0; transform:translateY(4px); }
          15%  { opacity:1; transform:translateY(0); }
          80%  { opacity:1; }
          100% { opacity:0; }
        }
        .kb-dot:nth-child(1){animation:kdots 1.2s infinite 0s}
        .kb-dot:nth-child(2){animation:kdots 1.2s infinite 0.18s}
        .kb-dot:nth-child(3){animation:kdots 1.2s infinite 0.36s}
        .kb-msg { white-space: pre-wrap; line-height: 1.6; word-break: break-word; }
        .kb-input:focus { outline: none; }
        .kb-pill:hover { opacity: 0.9; }
        .kb-applied { animation: kapplied 4s ease-in-out forwards; }
        .kb-qbtn:hover { background: ${isDark ? "#1e293b" : "#e2e8f0"} !important; }
      `}</style>

      {/* Applied toast */}
      {applied && (
        <div className="kb-applied" style={{
          position: "fixed", bottom: "76px", right: "24px", zIndex: 2100,
          background: isDark ? "#0f2a1e" : "#f0fdf4",
          border: `1px solid ${isDark ? "#34d39966" : "#16a34a44"}`,
          borderLeft: `3px solid ${isDark ? "#34d399" : "#16a34a"}`,
          borderRadius: "10px", padding: "8px 14px",
          fontSize: "12px", color: isDark ? "#34d399" : "#16a34a",
          fontWeight: "500", maxWidth: "280px",
          boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
          pointerEvents: "none",
        }}>
          ✓ {applied.summary}
        </div>
      )}

      {/* Floating pill */}
      <div className="kb-pill" onClick={() => setOpen(o => !o)} style={{
        position: "fixed", bottom: "24px", right: "24px", zIndex: 2000,
        background: pillBg, border: `1px solid ${borderClr}`,
        borderRadius: "40px", padding: "9px 18px",
        cursor: "pointer", display: "flex", alignItems: "center", gap: "8px",
        backdropFilter: "blur(12px)",
        animation: open ? "none" : "kpulse 3s ease-in-out infinite",
        transition: "box-shadow 0.2s, opacity 0.15s",
        userSelect: "none",
        boxShadow: open ? `0 4px 24px rgba(0,0,0,0.14)` : undefined,
      }}>
        <div style={{
          width: "7px", height: "7px", borderRadius: "50%",
          background: pillAccent, flexShrink: 0,
          boxShadow: `0 0 5px ${pillAccent}88`,
        }} />
        <span style={{ fontSize: "13px", fontWeight: "500", color: t.text }}>
          {open ? "Close" : "Tax assistant"}
        </span>
        {!open && messages.length > 1 && (
          <span style={{ background: pillAccent, color: isDark ? "#022c22" : "#fff", fontSize: "10px", fontWeight: "700", borderRadius: "20px", padding: "1px 7px" }}>
            {messages.filter(m => m.role === "assistant").length - 1}
          </span>
        )}
      </div>

      {/* Chat panel */}
      {open && (
        <div style={{
          position: "fixed", bottom: "72px", right: "24px", zIndex: 1999,
          width: "min(400px, calc(100vw - 32px))", height: "500px",
          background: pillBg, border: `1px solid ${borderClr}`,
          borderRadius: "18px", display: "flex", flexDirection: "column",
          overflow: "hidden", backdropFilter: "blur(16px)",
          animation: "kslide 0.18s ease-out",
          boxShadow: isDark ? "0 28px 64px rgba(0,0,0,0.55)" : "0 28px 64px rgba(0,0,0,0.13)",
        }}>

          {/* Header */}
          <div style={{ padding: "13px 16px 11px", borderBottom: `1px solid ${borderClr}`, display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
            <div style={{ width: "30px", height: "30px", borderRadius: "50%", background: isDark ? "#0f2a1e" : "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${pillAccent}55`, flexShrink: 0 }}>
              <span style={{ fontSize: "14px" }}>⚡</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "13px", fontWeight: "600", color: t.text }}>Wrytoff AI</div>
              <div style={{ fontSize: "10px", color: t.textDim }}>Can read &amp; update your tax data · 2026</div>
            </div>
            <button onClick={() => setMessages([messages[0]])} style={{ background: "none", border: "none", color: t.textFaint, fontSize: "11px", cursor: "pointer", padding: "2px 6px", borderRadius: "4px", fontFamily: "inherit" }}>
              Clear
            </button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 13px 6px", display: "flex", flexDirection: "column", gap: "9px", background: chatBg }}>
            {messages.map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{
                  maxWidth: "88%",
                  background: m.role === "user" ? userBubble : asstBubble,
                  color: m.role === "user" ? "#fff" : t.text,
                  borderRadius: m.role === "user" ? "14px 14px 3px 14px" : "14px 14px 14px 3px",
                  padding: "9px 12px", fontSize: "13px",
                }}>
                  <span className="kb-msg">{m.content}</span>
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: "flex" }}>
                <div style={{ background: asstBubble, borderRadius: "14px 14px 14px 3px", padding: "11px 14px", display: "flex", gap: "5px", alignItems: "center" }}>
                  {[0, 1, 2].map(i => <div key={i} className="kb-dot" style={{ width: "5px", height: "5px", borderRadius: "50%", background: t.textDim }} />)}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Quick prompts */}
          {messages.length === 1 && !loading && (
            <div style={{ padding: "8px 12px 2px", background: chatBg, display: "flex", gap: "5px", flexWrap: "wrap" }}>
              {QUICK_PROMPTS.map(q => (
                <button key={q} className="kb-qbtn" onClick={() => sendQuick(q)}
                  style={{ background: t.surface, border: `1px solid ${borderClr}`, borderRadius: "20px", padding: "5px 11px", fontSize: "11px", color: t.textMuted, cursor: "pointer", fontFamily: "inherit", transition: "background 0.12s" }}>
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{ padding: "10px 12px", borderTop: `1px solid ${borderClr}`, display: "flex", gap: "8px", alignItems: "flex-end", flexShrink: 0 }}>
            <textarea
              ref={inputRef}
              className="kb-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="e.g. My home is 2,200 sqft, office is 220 sqft, mortgage interest $22,400/yr"
              rows={2}
              style={{
                flex: 1, background: t.inputBg,
                border: `1px solid ${input.trim() ? pillAccent + "88" : borderClr}`,
                borderRadius: "10px", color: t.text, padding: "8px 11px",
                fontSize: "12px", fontFamily: "inherit", resize: "none",
                lineHeight: "1.45", maxHeight: "72px", overflowY: "auto",
                transition: "border-color 0.15s",
              }}
            />
            <button onClick={send} disabled={!input.trim() || loading}
              style={{
                background: input.trim() && !loading ? pillAccent : borderClr,
                border: "none", borderRadius: "10px", width: "36px", height: "36px",
                cursor: input.trim() && !loading ? "pointer" : "default",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, transition: "all 0.15s",
              }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 13L13 7L1 1V5.5L9 7L1 8.5V13Z" fill={input.trim() && !loading ? (isDark ? "#022c22" : "#fff") : t.textFaint} />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
