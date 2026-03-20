import { useState, useMemo, useRef, useCallback, useEffect, Fragment } from "react";
import { db } from './firebase';
import { doc, setDoc } from 'firebase/firestore';
import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

// ─────────────────────────────────────────────
// 2026 TAX CONSTANTS
// ─────────────────────────────────────────────
const STANDARD_DEDUCTION_MFJ = 30000;
const STANDARD_DEDUCTION_SINGLE = 15000;
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
// IRS EXPENSE LIBRARY
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

// ─────────────────────────────────────────────
// TAX OPPORTUNITIES ENGINE CONFIG
// ─────────────────────────────────────────────
const OPPORTUNITIES = [
  {
    id: "sep-ira",
    title: "SEP-IRA Contribution",
    category: "Retirement",
    whyMsg: "You have self-employment income and no retirement contribution currently modeled. This is one of the most powerful moves for high-earning solo-founders.",
    dataUsed: ["Net SE Income", "Filing Status", "AGI"],
    confidence: "High",
    check: (ctx) => ctx.netSE > 15000 && ctx.scenario.sepIra === 0,
    estimate: (ctx) => {
      const maxAmt = Math.min(69000, ctx.netSE * 0.20);
      return maxAmt * ctx.marginal;
    },
    missingFacts: [{ id: "plannedAmt", label: "Contribution amount", type: "currency", placeholder: "$0" }],
    field: "sepIra",
    priority: 1
  },
  {
    id: "health-ins",
    title: "Self-Employed Health Insurance",
    category: "Insurance",
    whyMsg: "Based on your business income, you can deduct 100% of your health insurance premiums directly. We don't see this deduction in your profile yet.",
    dataUsed: ["Business Income", "Profile Context"],
    confidence: "High",
    check: (ctx) => {
      const hasIns = ctx.expenses.some(e => e.category === "Insurance" && e.vendor.toLowerCase().includes("health"));
      return ctx.bizIncome > 0 && !hasIns && ctx.scenario.healthIns === 0;
    },
    estimate: (ctx) => 8400 * ctx.marginal,
    missingFacts: [{ id: "premiumAmt", label: "Estimated annual premium", type: "currency", placeholder: "$8,500" }],
    field: "healthIns",
    priority: 2
  },
  {
    id: "home-office",
    title: "Simplified Home Office Deduction",
    category: "Home",
    whyMsg: "You have business income but haven't applied the home office deduction. The simplified method ($5/sqft) is the fastest way to save.",
    dataUsed: ["Business Income", "Expense History"],
    confidence: "Med",
    check: (ctx) => ctx.bizIncome > 0 && ctx.homeOfficeDed === 0,
    estimate: (ctx) => 1500 * ctx.marginal,
    missingFacts: [{ id: "sqFt", label: "Office square footage (max 300)", type: "number", placeholder: "e.g. 150" }],
    field: "homeOfficeDed",
    priority: 3
  },
  {
    id: "mileage",
    title: "Business Mileage Tracker",
    category: "Vehicle",
    whyMsg: "You're likely missing local travel deductions. At $0.70/mile, even weekly client meetings add up to significant savings.",
    dataUsed: ["Expense Categories", "Business Activity"],
    confidence: "Med",
    check: (ctx) => ctx.bizIncome > 0 && ctx.scenario.mileage === 0,
    estimate: (ctx) => 3000 * 0.70 * ctx.marginal,
    missingFacts: [{ id: "estMiles", label: "Estimated annual business miles", type: "number", placeholder: "e.g. 2,000" }],
    field: "mileage",
    priority: 4
  },
  {
    id: "equipment-179",
    category: "Hardware",
    title: "Section 179 Equipment Expensing",
    whyMsg: "You have equipment purchases this year. Using Section 179 allows you to deduct the full cost now instead of over 5 years.",
    dataUsed: ["Equipment & Hardware Category"],
    confidence: "High",
    check: (ctx) => {
      const hasHardware = ctx.expenses.some(e => e.category === "Equipment & Hardware");
      return hasHardware && !ctx.scenario.section179;
    },
    estimate: (ctx) => 5000 * ctx.marginal,
    missingFacts: [],
    field: "section179",
    priority: 5,
    advanced: true
  }
];

const ALL_CATEGORY_NAMES = Object.keys(IRS_LIBRARY);

const FREQUENCY_MULTIPLIERS = {
  "monthly": 12,
  "annual": 1,
  "weekly": 52,
  "quarterly": 4,
  "one-time": 1
};

function calcAnnualized(amount, frequency) {
  const f = (frequency || "annual").toLowerCase();
  const mult = FREQUENCY_MULTIPLIERS[f] || 1;
  const val = parseFloat(amount) || 0;
  return val * mult;
}

function calcDeductible(e) {
  const base = e.annualizedAmount ?? e.amount ?? 0;
  if (e.category === "Meals & Entertainment") return base * 0.50;
  const bPct = parseFloat(e.bizPct ?? 1.0);
  return base * bPct;
}

const fmt = (n) => {
  if (isNaN(n) || n === null || n === undefined) return "$0";
  return "$" + Math.round(Math.abs(n)).toLocaleString();
};
const fmtK = (n) => {
  if (isNaN(n) || n === null || n === undefined) return "$0";
  const abs = Math.round(Math.abs(n));
  if (abs >= 1000000) return "$" + (abs / 1000000).toFixed(1) + "M";
  if (abs >= 10000) return "$" + (abs / 1000).toFixed(0) + "K";
  return "$" + abs.toLocaleString();
};
const pct = (n) => (n * 100).toFixed(0) + "%";

// Helper for inline inputs
const inp = (s) => ({
  background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: "5px",
  padding: "4px 8px", fontSize: "12px", fontFamily: "inherit", outline: "none",
  boxSizing: "border-box", ...s
});

const bigInp = () => ({
  width: "100%", background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: "8px", 
  padding: "12px", fontSize: "18px", fontFamily: "'DM Mono',monospace", color: "#1d4ed8", outline: "none",
  boxSizing: "border-box"
});

// ─────────────────────────────────────────────
// ADD EXPENSE MODAL
// ─────────────────────────────────────────────
function AddExpenseModal({ onAdd, onClose, t, marginalRate = 0.22 }) {
  const [selectedGroup, setSelectedGroup] = useState(ALL_CATEGORY_NAMES[0]);
  const [selectedRule, setSelectedRule] = useState(null);
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [bizPct, setBizPct] = useState(1.00);
  const [frequency, setFrequency] = useState("annual");

  const group = IRS_LIBRARY[selectedGroup] || [];

  const selectRule = (rule) => {
    setSelectedRule(rule);
    setBizPct(rule.deductPct === 0.50 ? 0.50 :
      selectedGroup === "Utilities" ? 0.70 :
        selectedGroup === "Housing & Real Estate" ? 0.10 : 1.00);
    if (!vendor) setVendor(rule.name);
  };

  const inputVal = parseFloat(amount || 0);
  const annualized = calcAnnualized(inputVal, frequency);
  const effectivePct = selectedRule?.deductPct === 0 ? 0 :
    (selectedGroup === "Meals & Entertainment" ? 0.50 : bizPct);
  const deductible = annualized * effectivePct;

  const canAdd = vendor.trim() && inputVal > 0 && selectedRule && frequency;

  const handleAdd = () => {
    if (!canAdd) return;
    onAdd({
      id: Date.now() + Math.random(),
      vendor: vendor.trim(),
      category: selectedGroup,
      inputAmount: inputVal,
      amount: inputVal,
      frequency: frequency,
      annualizedAmount: annualized,
      bizPct: selectedGroup === "Meals & Entertainment" ? 0.50 : bizPct,
      irsRule: selectedRule,
      status: "Likely Deductible"
    });
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: t.modalOverlay, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: t.modalBg, border: `1px solid ${t.border2}`, borderRadius: "16px", width: "100%", maxWidth: "640px", maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: "16px", fontWeight: "600", color: t.text }}>Add expense</div>
            <div style={{ fontSize: "12px", color: t.textDim, marginTop: "2px" }}>IRS deduction rules pre-loaded by category</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${t.border2}`, borderRadius: "8px", color: t.textDim, width: "32px", height: "32px", cursor: "pointer", fontSize: "16px", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>
        <div style={{ overflowY: "auto", padding: "20px 24px", flex: 1 }}>
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
          {selectedRule && (
            <div style={{ marginBottom: "4px" }}>
              <div style={{ fontSize: "11px", fontWeight: "600", color: t.textDim, marginBottom: "8px", letterSpacing: "0.5px" }}>3 — ENTER DETAILS</div>
              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "11px", color: t.textDim, marginBottom: "5px" }}>VENDOR / DESCRIPTION</div>
                <input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="e.g. Chase mortgage"
                  style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: "7px", color: t.text, padding: "9px 12px", width: "100%", fontSize: "13px", boxSizing: "border-box", fontFamily: "inherit", outline: "none" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                <div>
                  <div style={{ fontSize: "11px", color: t.textDim, marginBottom: "5px" }}>AMOUNT ($)</div>
                  <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0"
                    style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: "7px", color: t.inputText, padding: "9px 12px", width: "100%", fontSize: "13px", fontFamily: "'DM Mono',monospace", boxSizing: "border-box", outline: "none" }} />
                </div>
                <div>
                  <div style={{ fontSize: "11px", color: t.textDim, marginBottom: "5px" }}>FREQUENCY</div>
                  <select value={frequency} onChange={e => setFrequency(e.target.value)}
                    style={{ background: t.inputBg, border: `1px solid ${t.inputBorder}`, borderRadius: "7px", color: t.text, padding: "9px 12px", width: "100%", fontSize: "13px", boxSizing: "border-box", fontFamily: "inherit", outline: "none" }}>
                    <option value="monthly">Monthly</option>
                    <option value="annual">Annual</option>
                    <option value="weekly">Weekly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="one-time">One-time</option>
                  </select>
                </div>
              </div>
              {selectedRule.bizOnly && selectedGroup !== "Meals & Entertainment" && (
                <div style={{ marginTop: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
                    <div style={{ fontSize: "11px", color: t.textDim }}>BUSINESS-USE %</div>
                    <div style={{ fontSize: "12px", fontWeight: "600", color: t.blue, fontFamily: "'DM Mono',monospace" }}>{Math.round(bizPct * 100)}%</div>
                  </div>
                  <input type="range" min="0" max="1" step="0.05" value={bizPct} onChange={e => setBizPct(parseFloat(e.target.value))}
                    style={{ width: "100%" }} />
                </div>
              )}
              {inputVal > 0 && (
                <div style={{ marginTop: "16px", background: t.effectiveBg, border: `1px solid ${t.effectiveBorder}`, borderRadius: "8px", padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "10px", color: t.effectiveLabel, marginBottom: "4px" }}>ANNUALIZED TOTAL</div>
                    <div style={{ fontSize: "18px", fontFamily: "'DM Mono',monospace", fontWeight: "600", color: t.text }}>{fmt(annualized)}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "10px", color: t.textDim, marginBottom: "4px" }}>EST. SAVINGS @ {Math.round(marginalRate * 100)}%</div>
                    <div style={{ fontSize: "18px", fontFamily: "'DM Mono',monospace", fontWeight: "600", color: t.green }}>{fmt(deductible * marginalRate)}</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
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
// WRYTOFF TAX OPTIMIZER
// ─────────────────────────────────────────────
export default function WrytoffTaxOptimizer({ userProfile, onLogout }) {
  const companyName = userProfile?.companyName || "WRYTOFF";
  const [isDark, setIsDark] = useState(false);
  const t = isDark ? DARK : LIGHT;

  const [expenses, setExpenses] = useState([]);
  const [assets, setAssets] = useState([]);
  const [w2Income, setW2Income] = useState(0);
  const [spouseIncome, setSpouseIncome] = useState(0);
  const [w2Withheld, setW2Withheld] = useState(0);
  const [spouseWithheld, setSpouseWithheld] = useState(0);
  const [estimatedPayments, setEstimatedPayments] = useState(0);
  const [bizIncome, setBizIncome] = useState(0);
  const [employerName, setEmployerName] = useState("");
  const [homeOfficeDed, setHomeOfficeDed] = useState(0);
  const [scenario, setScenario] = useState({ posture: "Standard", sepIra: 0, healthIns: 0, mileage: 0, filingStatus: "MFJ" });
  const [activeTab, setActiveTab] = useState("optimizations");
  const [showAddModal, setShowAddModal] = useState(false);
  const [dismissedOpps, setDismissedOpps] = useState([]);
  const [activeScenarioId, setActiveScenarioId] = useState(null);
  const [tempScenarioValue, setTempScenarioValue] = useState("");
  const [expandedRow, setExpandedRow] = useState(null);
  const [flashFields, setFlashFields] = useState({});
  const [dataLoaded, setDataLoaded] = useState(false);

  // Initial Data Sync
  useEffect(() => {
    if (userProfile?.taxData) {
      const td = userProfile.taxData;
      if (td.expenses) setExpenses(td.expenses);
      if (td.assets) setAssets(td.assets);
      if (td.w2Income != null) setW2Income(td.w2Income);
      if (td.spouseIncome != null) setSpouseIncome(td.spouseIncome);
      if (td.w2Withheld != null) setW2Withheld(td.w2Withheld);
      if (td.spouseWithheld != null) setSpouseWithheld(td.spouseWithheld);
      if (td.estimatedPayments != null) setEstimatedPayments(td.estimatedPayments);
      if (td.bizIncome != null) setBizIncome(td.bizIncome);
      if (td.homeOfficeDed != null) setHomeOfficeDed(td.homeOfficeDed);
      if (td.scenario) setScenario(td.scenario);
      setDataLoaded(true);
    } else {
      setDataLoaded(true);
    }
  }, [userProfile?.uid]);

  // Cloud Auto-save
  useEffect(() => {
    if (!dataLoaded || !userProfile?.uid) return;
    const saveToCloud = async () => {
      try {
        await setDoc(doc(db, 'users', userProfile.uid), {
          taxData: { expenses, assets, w2Income, spouseIncome, w2Withheld, spouseWithheld, estimatedPayments, bizIncome, homeOfficeDed, scenario }
        }, { merge: true });
      } catch (e) { console.error("Cloud auto-save failure:", e); }
    };
    const syncTimer = setTimeout(saveToCloud, 1000); 
    return () => clearTimeout(syncTimer);
  }, [expenses, assets, w2Income, spouseIncome, w2Withheld, spouseWithheld, estimatedPayments, bizIncome, homeOfficeDed, scenario, userProfile?.uid, dataLoaded]);

  const dispatch = useCallback((actions) => {
    actions.forEach(action => {
      switch (action.type) {
        case "SET_W2_INCOME": setW2Income(action.value); break;
        case "SET_SPOUSE_INCOME": setSpouseIncome(action.value); break;
        case "SET_W2_WITHHELD": setW2Withheld(action.value); break;
        case "SET_SPOUSE_WITHHELD": setSpouseWithheld(action.value); break;
        case "SET_ESTIMATED_PAYMENTS": setEstimatedPayments(action.value); break;
        case "SET_BIZ_INCOME": setBizIncome(action.value); break;
        case "SET_HOME_OFFICE": setHomeOfficeDed(action.value); break;
        case "ADD_EXPENSE":
          const inputAmt = parseFloat(action.expense.amount || action.expense.inputAmount || 0);
          const freq = action.expense.frequency || "annual";
          const ann = calcAnnualized(inputAmt, freq);
          setExpenses(prev => [...prev, { 
            id: Date.now() + Math.random(), 
            vendor: action.expense.vendor,
            category: action.expense.category,
            inputAmount: inputAmt,
            amount: inputAmt,
            frequency: freq,
            annualizedAmount: ann,
            bizPct: parseFloat(action.expense.bizPct ?? 1.0),
            status: action.expense.status || "Likely Deductible"
          }]);
          break;
        case "NAVIGATE": setActiveTab(action.tab); break;
        case "APPLY_OPTIMIZATION":
          if (action.field === "homeOfficeDed") setHomeOfficeDed(action.value);
          else setScenario(prev => ({ ...prev, [action.field]: action.value }));
          break;
        default: break;
      }
    });
  }, []);

  const updateExp = useCallback((id, field, val) => {
    setExpenses(prev => prev.map(e => {
      if (e.id !== id) return e;
      const updated = { ...e, [field]: (field === "bizPct" || field === "inputAmount") ? (parseFloat(val) || 0) : val };
      if (field === "inputAmount") updated.amount = updated.inputAmount;
      const inputAmount = updated.inputAmount ?? updated.amount ?? 0;
      updated.annualizedAmount = calcAnnualized(inputAmount, updated.frequency || "annual");
      if (updated.frequency) updated.status = "Likely Deductible";
      return updated;
    }));
  }, []);

  const removeExpense = useCallback((id) => setExpenses(prev => prev.filter(e => e.id !== id)), []);

  const calc = useMemo(() => {
    const scenarioDeds = (scenario.sepIra || 0) + (scenario.healthIns || 0) + ((scenario.mileage || 0) * 0.70) + (scenario.section179 || 0);
    const totalBizDed = expenses.reduce((s, e) => s + calcDeductible(e), 0) + homeOfficeDed + scenarioDeds;
    const netSE = Math.max(0, bizIncome - totalBizDed);
    const seTax = netSE * 0.9235 * 0.153;
    const seDed = seTax * 0.5;
    const totalW2 = w2Income + spouseIncome;
    const agi = totalW2 + netSE - seDed;
    const stdDed = scenario.filingStatus === "MFJ" ? STANDARD_DEDUCTION_MFJ : (scenario.filingStatus === "Single" ? STANDARD_DEDUCTION_SINGLE : 0);
    const qbiDed = agi < QBI_THRESHOLD_MFJ ? netSE * QBI_RATE : 0;
    const taxable = Math.max(0, agi - stdDed - qbiDed);
    const fedTax = calcFederalTax(taxable);
    const marginal = marginalRate(taxable);
    const withheld = w2Withheld + spouseWithheld + estimatedPayments;
    const liability = fedTax + seTax;
    const position = withheld - liability;

    const catTotals = expenses.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + calcDeductible(e);
      return acc;
    }, {});

    return { totalIncome: totalW2 + bizIncome, totalBizDed, netSE, seTax, seDed, agi, stdDed, qbiDed, taxable, fedTax, marginal, withheld, liability, position, catTotals, isRefund: position >= 0 };
  }, [expenses, bizIncome, w2Income, spouseIncome, w2Withheld, spouseWithheld, estimatedPayments, homeOfficeDed, scenario]);

  const catTotals = calc.catTotals;
  const isRefund = calc.isRefund;

  const scenarioCalc = useMemo(() => {
    // This is used for "what if I add X amount more to Y"
    // For now, it's just a mirror of calc until we add a secondary preview layer
    return calc;
  }, [calc]);

  const handleExportCSV = () => {
    const headers = ["Vendor", "Category", "Amount", "Frequency", "Biz %", "Deductible"];
    const rows = expenses.map(e => [e.vendor, e.category, e.inputAmount, e.frequency, e.bizPct, calcDeductible(e)]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const link = document.createElement("a");
    link.href = encodeURI(csvContent);
    link.download = "wrytoff_expenses.csv";
    link.click();
  };

  const [isParsingW2, setIsParsingW2] = useState(false);
  const [w2ParseStatus, setW2ParseStatus] = useState(""); // "", "reading", "sending", "done", "error"
  const w2FileRef = useRef();

  const handleW2Upload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsParsingW2(true);
    setW2ParseStatus("reading");

    try {
      let imageBase64;
      let mediaType = 'image/jpeg';

      if (file.type === 'application/pdf') {
        // Render the first page of the PDF to a JPEG via canvas
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 2.0 }); // 2x for legibility
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        imageBase64 = canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
        mediaType = 'image/jpeg';
      } else {
        // PNG / JPEG / WEBP — read directly as base64
        imageBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error("File read failed"));
          reader.onload = (evt) => resolve(evt.target.result.split(',')[1]);
          reader.readAsDataURL(file);
        });
        mediaType = file.type || 'image/jpeg';
      }

      setW2ParseStatus("sending");

      const apiUrl = window.location.hostname === 'localhost'
        ? 'http://localhost:3001/api/parse-w2'
        : '/api/parse-w2';

      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, mediaType }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `API error ${res.status}`);
      }

      // Populate fields from structured response
      if (data.wages) setW2Income(data.wages);
      if (data.federalWithholding) setW2Withheld(data.federalWithholding);
      if (data.employerName) setEmployerName(data.employerName);
      if (data.stateWithholding) setScenario(prev => ({ ...prev, stateWithheld: data.stateWithholding }));
      if (data.stateName) setScenario(prev => ({ ...prev, stateName: data.stateName }));

      setW2ParseStatus("done");
      alert(`W-2 Synced via ${data.model || 'AI'}!\nWages: $${(data.wages || 0).toLocaleString()} · Withheld: $${(data.federalWithholding || 0).toLocaleString()}`);
    } catch (err) {
      console.error("W-2 upload error:", err);
      setW2ParseStatus("error");
      alert(`W-2 parse failed: ${err.message}\n\nPlease enter values manually in the fields below.`);
    } finally {
      setIsParsingW2(false);
      setTimeout(() => setW2ParseStatus(""), 3000);
      if (w2FileRef.current) w2FileRef.current.value = "";
    }
  };

  const fileInputRef = useRef();
  const handleImportCSV = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const lines = evt.target.result.split("\n").filter(l => l.trim());
      const newExpenses = lines.slice(1).map(line => {
        const [vendor, category, amount, frequency, bizPct] = line.split(",").map(c => c.trim().replace(/^"|"$/g, ''));
        const inputAmount = parseFloat(amount) || 0;
        const f = frequency || "annual";
        return {
          id: Math.random(), vendor, category, inputAmount, frequency: f,
          bizPct: parseFloat(bizPct) || 1.0, annualizedAmount: calcAnnualized(inputAmount, f),
          status: "Likely Deductible"
        };
      }).filter(e => e.vendor);
      setExpenses(prev => [...prev, ...newExpenses]);
    };
    reader.readAsText(file);
  };

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: t.bg, color: t.text, minHeight: "100vh" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@500&display=swap" rel="stylesheet" />
      {showAddModal && <AddExpenseModal onAdd={(e) => setExpenses(prev => [...prev, e])} onClose={() => setShowAddModal(false)} t={t} marginalRate={calc.marginal} />}

      <div style={{ background: t.headerBg, borderBottom: `1px solid ${t.border}`, padding: "18px 24px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
          <div>
            <div style={{ fontSize: "10px", letterSpacing: "2px", color: t.textDim, fontWeight: "700" }}>{companyName} · TAX 2026</div>
            <div style={{ fontSize: "24px", fontWeight: "700", letterSpacing: "-0.5px" }}>WRYTOFF TAX ENGINE</div>
          </div>
          <div style={{ textAlign: "right", display: "flex", gap: "24px", alignItems: "center" }}>
            <button onClick={() => setIsDark(!isDark)} style={{ background: t.surface, border: `1px solid ${t.border2}`, borderRadius: "20px", padding: "6px 12px", fontSize: "12px", cursor: "pointer", color: t.text }}>{isDark ? "☀️ Light" : "🌙 Dark"}</button>
            <button onClick={onLogout} style={{ background: "transparent", color: t.red, border: "none", cursor: "pointer", fontSize: "12px" }}>Log Out</button>
            <div>
              <div style={{ fontSize: "10px", color: t.textDim, marginBottom: "2px" }}>EST. POSITION</div>
              <div style={{ fontSize: "28px", fontWeight: "700", color: isRefund ? t.green : t.red, fontFamily: "'DM Mono',monospace" }}>{isRefund ? "+" : "-"}{fmt(calc.position)}</div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "20px" }}>
          {["summary", "expenses", "income", "optimizations"].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{ background: "none", border: "none", borderBottom: activeTab === tab ? `2px solid ${t.blue}` : "2px solid transparent", color: activeTab === tab ? t.blue : t.textDim, padding: "12px 4px", fontSize: "13px", fontWeight: "600", cursor: "pointer", textTransform: "capitalize" }}>{tab}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
        {activeTab === "summary" && (
          <div>
            {/* HERO METRIC CARDS */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "28px" }}>
              {[
                {
                  label: "TOTAL TAX LIABILITY",
                  value: fmt(calc.liability),
                  sub: `Fed ${fmt(calc.fedTax)} + SE ${fmt(calc.seTax)}`,
                  color: t.red,
                  accent: `${t.red}18`,
                },
                {
                  label: "TAXABLE INCOME",
                  value: fmt(calc.taxable),
                  sub: `AGI ${fmt(calc.agi)} − deductions`,
                  color: t.blue,
                  accent: `${t.blue}14`,
                },
                {
                  label: "TOTAL DEDUCTIONS",
                  value: fmt(calc.totalBizDed + calc.stdDed + calc.qbiDed),
                  sub: `Biz ${fmt(calc.totalBizDed)} + Std ${fmt(calc.stdDed)}`,
                  color: t.green,
                  accent: `${t.green}14`,
                },
                {
                  label: "EST. REFUND / OWED",
                  value: (calc.isRefund ? "+" : "−") + fmt(calc.position),
                  sub: calc.isRefund ? "Estimated refund" : "Estimated amount owed",
                  color: calc.isRefund ? t.green : t.red,
                  accent: calc.isRefund ? `${t.green}14` : `${t.red}14`,
                  big: true,
                },
              ].map((card, i) => (
                <div key={i} style={{ background: card.accent, border: `1px solid ${card.color}33`, borderRadius: "16px", padding: "20px 24px" }}>
                  <div style={{ fontSize: "10px", fontWeight: "700", color: card.color, letterSpacing: "1.5px", marginBottom: "10px" }}>{card.label}</div>
                  <div style={{ fontSize: card.big ? "36px" : "32px", fontWeight: "800", color: card.color, fontFamily: "'DM Mono',monospace", lineHeight: 1.1, marginBottom: "6px" }}>{card.value}</div>
                  <div style={{ fontSize: "11px", color: t.textDim }}>{card.sub}</div>
                </div>
              ))}
            </div>

            {/* SECONDARY ROW: marginal rate + income breakdown */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", marginBottom: "28px" }}>
              <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "12px", padding: "18px 20px" }}>
                <div style={{ fontSize: "10px", fontWeight: "700", color: t.textDim, letterSpacing: "1px", marginBottom: "8px" }}>MARGINAL RATE</div>
                <div style={{ fontSize: "28px", fontWeight: "800", color: t.amber, fontFamily: "'DM Mono',monospace" }}>{Math.round(calc.marginal * 100)}%</div>
                <div style={{ fontSize: "11px", color: t.textDim, marginTop: "4px" }}>Each extra $1 earned costs {Math.round(calc.marginal * 100)}¢</div>
              </div>
              <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "12px", padding: "18px 20px" }}>
                <div style={{ fontSize: "10px", fontWeight: "700", color: t.textDim, letterSpacing: "1px", marginBottom: "8px" }}>TOTAL INCOME</div>
                <div style={{ fontSize: "28px", fontWeight: "800", color: t.text, fontFamily: "'DM Mono',monospace" }}>{fmt(calc.totalIncome)}</div>
                <div style={{ fontSize: "11px", color: t.textDim, marginTop: "4px" }}>Biz {fmt(bizIncome)} + W-2 {fmt(w2Income + spouseIncome)}</div>
              </div>
              <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "12px", padding: "18px 20px" }}>
                <div style={{ fontSize: "10px", fontWeight: "700", color: t.textDim, letterSpacing: "1px", marginBottom: "8px" }}>QBI DEDUCTION</div>
                <div style={{ fontSize: "28px", fontWeight: "800", color: t.green, fontFamily: "'DM Mono',monospace" }}>{fmt(calc.qbiDed)}</div>
                <div style={{ fontSize: "11px", color: t.textDim, marginTop: "4px" }}>20% pass-through deduction</div>
              </div>
            </div>

            {/* TAX WATERFALL + CATEGORY BREAKDOWN */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
              <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "12px", padding: "24px" }}>
                <div style={{ fontSize: "12px", fontWeight: "700", color: t.textDim, marginBottom: "16px", letterSpacing: "0.5px" }}>TAX WATERFALL</div>
                {[
                  { label: "Gross revenue", value: fmt(bizIncome), color: t.text },
                  { label: "Business deductions", value: "−" + fmt(calc.totalBizDed), color: t.red },
                  { label: "= Net SE income", value: fmt(calc.netSE), color: t.text, bold: true },
                  { label: "W-2 income", value: "+" + fmt(w2Income + spouseIncome), color: t.blue },
                  { label: "SE tax deduction (½)", value: "−" + fmt(calc.seDed), color: t.red },
                  { label: "= AGI", value: fmt(calc.agi), color: t.text, bold: true },
                  { label: "Standard deduction", value: "−" + fmt(calc.stdDed), color: t.red },
                  { label: "QBI deduction (20%)", value: "−" + fmt(calc.qbiDed), color: t.green },
                  { label: "= Taxable income", value: fmt(calc.taxable), color: t.blue, bold: true },
                  { label: "Federal income tax", value: fmt(calc.fedTax), color: t.red },
                  { label: "Self-employment tax", value: fmt(calc.seTax), color: t.red },
                  { label: "Total withheld/paid", value: fmt(calc.withheld), color: t.green },
                ].map((row, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: row.bold ? "10px 8px" : "7px 8px", borderBottom: `1px solid ${t.surface2}`, background: row.bold ? t.surface2 : "transparent", borderRadius: row.bold ? "6px" : 0, marginBottom: row.bold ? "4px" : 0 }}>
                    <span style={{ fontSize: "12px", color: row.bold ? t.text : t.textDim, fontWeight: row.bold ? "700" : "400" }}>{row.label}</span>
                    <span style={{ fontSize: row.bold ? "15px" : "13px", fontFamily: "'DM Mono',monospace", color: row.color || t.text, fontWeight: row.bold ? "700" : "500" }}>{row.value}</span>
                  </div>
                ))}
              </div>

              <div>
                <div style={{ fontSize: "12px", fontWeight: "700", color: t.textDim, marginBottom: "12px", letterSpacing: "0.5px" }}>DEDUCTIONS BY CATEGORY</div>
                {Object.keys(catTotals).length === 0 ? (
                  <div style={{ background: t.surface, border: `1px dashed ${t.border}`, borderRadius: "10px", padding: "40px", textAlign: "center", color: t.textDim, fontSize: "13px" }}>
                    Add expenses in the Expenses tab to see your deductions breakdown.
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "8px" }}>
                    {Object.entries(catTotals).sort((a, b) => b[1] - a[1]).map(([cat, val]) => {
                      const total = calc.totalBizDed || 1;
                      const pctVal = Math.round((val / total) * 100);
                      const cc = t.catColors?.[cat] || { bg: t.surface2, accent: t.green, text: t.green };
                      return (
                        <div key={cat} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "10px", padding: "12px 16px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                            <span style={{ fontSize: "12px", color: t.textMuted, fontWeight: "500" }}>{cat}</span>
                            <span style={{ fontSize: "16px", fontWeight: "700", color: cc.accent, fontFamily: "'DM Mono',monospace" }}>{fmt(val)}</span>
                          </div>
                          <div style={{ height: "4px", background: t.surface2, borderRadius: "2px", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${pctVal}%`, background: cc.accent, borderRadius: "2px" }} />
                          </div>
                          <div style={{ fontSize: "10px", color: t.textFaint, marginTop: "4px" }}>{pctVal}% of total deductions</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "expenses" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px" }}>
              <div style={{ fontSize: "13px", color: t.textDim }}>Managing all business outlays for {companyName}.</div>
              <div style={{ display: "flex", gap: "10px" }}>
                <input type="file" accept=".csv" ref={fileInputRef} style={{ display: "none" }} onChange={handleImportCSV} />
                <button onClick={() => setShowAddModal(true)} style={{ background: t.green, color: "#fff", border: "none", borderRadius: "8px", padding: "8px 16px", fontWeight: "600", cursor: "pointer" }}>+ Add Expense</button>
                <button 
                  onClick={() => { 
                    if (window.confirm("Are you sure you want to clear all expenses? This will reset your current progress.")) {
                      setExpenses([]); 
                    }
                  }} 
                  style={{ background: "none", border: `1px solid ${t.red}44`, color: t.red, borderRadius: "8px", padding: "8px 12px", fontSize: "11px", cursor: "pointer", transition: "all 0.15s" }}
                >
                  Clear All
                </button>
                <button onClick={() => fileInputRef.current?.click()} style={{ background: t.surface, border: `1px solid ${t.border2}`, borderRadius: "8px", padding: "8px 16px", fontSize: "12px", cursor: "pointer" }}>Import CSV</button>
                <button onClick={handleExportCSV} style={{ background: t.surface, border: `1px solid ${t.border2}`, borderRadius: "8px", padding: "8px 16px", fontSize: "12px", cursor: "pointer" }}>Export CSV</button>
              </div>
            </div>
            <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "12px", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ background: t.surface2, color: t.textDim, fontSize: "11px", textAlign: "left" }}>
                    <th style={{ padding: "12px 16px" }}>VENDOR</th>
                    <th style={{ padding: "12px 16px" }}>CATEGORY</th>
                    <th style={{ padding: "12px 16px" }}>AMOUNT</th>
                    <th style={{ padding: "12px 16px" }}>FREQUENCY</th>
                    <th style={{ padding: "12px 16px" }}>ANNUALIZED</th>
                    <th style={{ padding: "12px 16px" }}>BIZ %</th>
                    <th style={{ padding: "12px 16px" }}>DEDUCTIBLE</th>
                    <th style={{ padding: "12px 16px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map(e => (
                    <tr key={e.id} style={{ borderBottom: `1px solid ${t.border}` }}>
                      <td style={{ padding: "12px 16px", fontWeight: "500" }}>{e.vendor}</td>
                      <td style={{ padding: "12px 16px" }}><span style={{ background: t.surface2, padding: "2px 6px", borderRadius: "4px", fontSize: "11px" }}>{e.category}</span></td>
                      <td style={{ padding: "12px 16px" }}>
                        <input type="number" value={e.inputAmount || ""} onChange={ev => updateExp(e.id, "inputAmount", ev.target.value)} style={inp({ width: "80px" })} />
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <select value={e.frequency} onChange={ev => updateExp(e.id, "frequency", ev.target.value)} style={inp({ width: "100px" })}>
                          <option value="monthly">Monthly</option>
                          <option value="annual">Annual</option>
                          <option value="weekly">Weekly</option>
                          <option value="quarterly">Quarterly</option>
                          <option value="one-time">One-time</option>
                        </select>
                      </td>
                      <td style={{ padding: "12px 16px", fontFamily: "'DM Mono',monospace" }}>{fmt(e.annualizedAmount)}</td>
                      <td style={{ padding: "12px 16px" }}>
                        <input type="number" step="0.05" value={e.bizPct} onChange={ev => updateExp(e.id, "bizPct", ev.target.value)} style={inp({ width: "60px" })} />
                      </td>
                      <td style={{ padding: "12px 16px", fontWeight: "600", color: t.green }}>{fmt(calcDeductible(e))}</td>
                      <td style={{ padding: "12px 16px", textAlign: "right" }}>
                        <button onClick={() => removeExpense(e.id)} style={{ background: "none", border: `1px solid ${t.red}22`, borderRadius: "6px", color: t.red, padding: "4px 8px", fontSize: "10px", fontWeight: "700", cursor: "pointer", transition: "all 0.15s" }}>DELETE</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Other tabs omitted for brevity but they follow the same patterns */}
        {activeTab === "income" && (
          <div style={{ animation: "fadeIn 0.4s ease-out" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "32px" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "11px", fontWeight: "700", color: t.textDim, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>Filing Context</div>
                <div style={{ display: "flex", gap: "12px" }}>
                  {["Single", "MFJ"].map(fs => (
                    <button key={fs} onClick={() => setScenario({ ...scenario, filingStatus: fs })} style={{ 
                      flex: 1, padding: "12px", borderRadius: "10px", cursor: "pointer", fontSize: "14px", fontWeight: "600",
                      background: scenario.filingStatus === fs ? t.blue : t.surface,
                      border: `1px solid ${scenario.filingStatus === fs ? t.blue : t.border}`,
                      color: scenario.filingStatus === fs ? "#fff" : t.text,
                      transition: "all 0.2s"
                    }}>
                      {fs === "MFJ" ? "Married Filing Jointly" : "Single / Individual"}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ width: "24px" }} />
              <div style={{ flex: 1, textAlign: "right" }}>
                <input type="file" ref={w2FileRef} style={{ display: "none" }} accept="image/png,image/jpeg,image/webp,.pdf,application/pdf" onChange={handleW2Upload} />
                <button
                  onClick={() => w2FileRef.current.click()}
                  disabled={isParsingW2}
                  style={{
                    background: t.blue, color: "#fff", border: "none", borderRadius: "10px", padding: "14px 24px", fontSize: "14px", fontWeight: "700", cursor: "pointer",
                    boxShadow: `0 4px 12px ${t.blue}44`, display: "flex", alignItems: "center", gap: "10px", width: "100%", justifyContent: "center"
                  }}
                >
                  {w2ParseStatus === "reading" ? "📖 Reading file..." : w2ParseStatus === "sending" ? "🤖 AI scanning W-2..." : w2ParseStatus === "done" ? "✅ W-2 synced!" : w2ParseStatus === "error" ? "❌ Try again" : "📄 Upload W-2 (PDF, PNG, or JPEG)"}
                </button>
                <div style={{ fontSize: "10px", color: t.textFaint, textAlign: "center", marginTop: "6px" }}>Accepts PDF, PNG, or JPEG</div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: scenario.filingStatus === "MFJ" ? "1fr 1fr" : "1fr", gap: "32px" }}>
              {/* PRIMARY TAXPAYER */}
              <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "16px", padding: "24px" }}>
                <div style={{ fontSize: "14px", fontWeight: "700", color: t.blue, marginBottom: "20px" }}>PRIMARY HOLDER</div>
                
                <div style={{ marginBottom: "20px" }}>
                  <div style={{ fontSize: "11px", fontWeight: "700", color: t.textDim, marginBottom: "8px" }}>EMPLOYER (BOX C)</div>
                  <input type="text" value={employerName || ""} onChange={e => setEmployerName(e.target.value)} placeholder="Company Name" style={{ ...bigInp(), textAlign: "left" }} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: "12px", marginBottom: "20px" }}>
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: "700", color: t.textDim, marginBottom: "8px" }}>WAGES (BOX 1)</div>
                    <input type="number" value={w2Income || ""} onChange={e => setW2Income(parseFloat(e.target.value) || 0)} style={{ ...bigInp(), textAlign: "left" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: "700", color: t.textDim, marginBottom: "8px" }}>FED WITHHELD (BOX 2)</div>
                    <input type="number" value={w2Withheld || ""} onChange={e => setW2Withheld(parseFloat(e.target.value) || 0)} style={{ ...bigInp(), textAlign: "left", color: t.green }} />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "20px" }}>
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: "700", color: t.textDim, marginBottom: "8px" }}>STATE NAME</div>
                    <input type="text" value={scenario.stateName || ""} onChange={e => setScenario(prev => ({ ...prev, stateName: e.target.value }))} style={{ ...bigInp(), textAlign: "left" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: "700", color: t.textDim, marginBottom: "8px" }}>STATE WITHHELD (BOX 17)</div>
                    <input type="number" value={scenario.stateWithheld || ""} onChange={e => setScenario(prev => ({ ...prev, stateWithheld: parseFloat(e.target.value) || 0 }))} style={{ ...bigInp(), textAlign: "left" }} />
                  </div>
                </div>

                <div style={{ borderTop: `1px dashed ${t.border}`, pt: "20px", marginTop: "20px" }}>
                  <div style={{ fontSize: "11px", fontWeight: "700", color: t.textDim, marginBottom: "8px", marginTop: "20px" }}>BIZ REVENUE (ACCRUAL)</div>
                  <input type="number" value={bizIncome || ""} onChange={e => setBizIncome(parseFloat(e.target.value) || 0)} style={{ ...bigInp(), textAlign: "left" }} />
                </div>
              </div>

              {/* SPOUSE SECTION */}
              {scenario.filingStatus === "MFJ" && (
                <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "16px", padding: "24px" }}>
                  <div style={{ fontSize: "14px", fontWeight: "700", color: t.amber, marginBottom: "20px" }}>SPOUSE / JOINT</div>
                  
                  <div style={{ marginBottom: "20px" }}>
                    <div style={{ fontSize: "11px", fontWeight: "700", color: t.textDim, marginBottom: "8px" }}>W-2 WAGES (GROSS)</div>
                    <input type="number" value={spouseIncome || ""} onChange={e => setSpouseIncome(parseFloat(e.target.value) || 0)} placeholder="Enter Box 1 amount" style={{ ...bigInp(), textAlign: "left" }} />
                  </div>
                  
                  <div style={{ marginBottom: "20px" }}>
                    <div style={{ fontSize: "11px", fontWeight: "700", color: t.textDim, marginBottom: "8px" }}>FEDERAL WITHHOLDING</div>
                    <input type="number" value={spouseWithheld || ""} onChange={e => setSpouseWithheld(parseFloat(e.target.value) || 0)} placeholder="Enter Box 2 amount" style={{ ...bigInp(), textAlign: "left", color: t.green }} />
                  </div>
                </div>
              )}
            </div>
            
            {/* ESTIMATED TAX PAYMENTS */}
            <div style={{ marginTop: "24px", background: t.surface, border: `1px solid ${t.border}`, borderRadius: "16px", padding: "24px" }}>
              <div style={{ fontSize: "14px", fontWeight: "700", color: t.green, marginBottom: "6px" }}>QUARTERLY ESTIMATED PAYMENTS</div>
              <div style={{ fontSize: "11px", color: t.textDim, marginBottom: "16px" }}>Total estimated tax payments made this year (Form 1040-ES). Self-employed filers typically pay quarterly.</div>
              <input
                type="number"
                value={estimatedPayments || ""}
                onChange={e => setEstimatedPayments(parseFloat(e.target.value) || 0)}
                placeholder="e.g. 12000"
                style={{ ...bigInp(), textAlign: "left", color: t.green }}
              />
            </div>

            <div style={{ marginTop: "16px", padding: "16px", background: `${t.blue}08`, borderRadius: "12px", border: `1px solid ${t.blue}22`, fontSize: "12px", color: t.textDim, lineHeight: "1.5" }}>
              <strong>Note on Business Income:</strong> Accrual revenue should include all income earned during the tax year, regardless of when cash was received. Your business deductions are managed in the <strong>Expenses</strong> tab.
            </div>
          </div>
        )}

        {activeTab === "optimizations" && (
           <TaxOpportunitiesEngine 
             t={t} 
             ctx={{ ...calc, expenses, bizIncome, homeOfficeDed, scenario, dismissedOpps }} 
             onApply={(opp, val) => {
               if (opp.field === "homeOfficeDed") {
                 setHomeOfficeDed(val);
               } else {
                 setScenario(prev => ({ ...prev, [opp.field]: val }));
               }
             }}
             onDismiss={(id) => setDismissedOpps(prev => [...prev, id])}
             activeScenarioId={activeScenarioId}
             setActiveScenarioId={setActiveScenarioId}
             tempScenarioValue={tempScenarioValue}
             setTempScenarioValue={setTempScenarioValue}
             fmt={fmt}
           />
        )}
      </div>

      <TaxBot t={t} calc={calc} expenses={expenses} dispatch={dispatch} setActiveTab={setActiveTab} />
    </div>
  );
}

// ─────────────────────────────────────────────
// TAX OPPORTUNITIES ENGINE COMPONENTS
// ─────────────────────────────────────────────
function TaxOpportunitiesEngine({ t, ctx, onApply, onDismiss, activeScenarioId, setActiveScenarioId, tempScenarioValue, setTempScenarioValue, fmt }) {
  const [isScanning, setIsScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [aiInsights, setAiInsights] = useState(null);

  const ranking = useMemo(() => {
    return OPPORTUNITIES.map(opp => {
      const applies = opp.check(ctx);
      const savings = opp.estimate ? opp.estimate(ctx) : 0;
      let aiScore = (savings / 1000) * (opp.priority || 1);
      if (opp.confidence === "High") aiScore *= 1.2;
      return { ...opp, applies, estSavings: savings, aiScore };
    }).filter(opp => !ctx.dismissedOpps.includes(opp.id));
  }, [ctx]);

  // If AI scan returned a ranking, reorder topOpps by AI's rankedIds; otherwise fall back to score sort
  const topOpps = useMemo(() => {
    const base = ranking
      .filter(o => o.applies && !o.advanced)
      .sort((a, b) => b.aiScore - a.aiScore);
    if (!aiInsights?.rankedIds?.length) return base;
    const aiOrder = aiInsights.rankedIds;
    const inAiOrder = base
      .filter(o => aiOrder.includes(o.id))
      .sort((a, b) => aiOrder.indexOf(a.id) - aiOrder.indexOf(b.id));
    const notInAiOrder = base.filter(o => !aiOrder.includes(o.id));
    return [...inAiOrder, ...notInAiOrder];
  }, [ranking, aiInsights]);

  const secondaryOppsArr = ranking.filter(o => !o.applies && !o.advanced);
  const advancedOppsArr = ranking.filter(o => o.advanced);

  const [selectedOppId, setSelectedOppId] = useState(null);

  useEffect(() => {
    if (topOpps.length > 0 && !selectedOppId) {
      setSelectedOppId(topOpps[0].id);
    }
  }, [topOpps, selectedOppId]);

  const selectedOpp = topOpps.find(o => o.id === selectedOppId) || topOpps[0];
  const totalPotential = topOpps.reduce((s, o) => s + o.estSavings, 0);

  const triggerScan = async () => {
    setIsScanning(true);
    try {
      const apiUrl = window.location.hostname === 'localhost'
        ? 'http://localhost:3001/api/optimize'
        : '/api/optimize';

      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bizIncome: ctx.bizIncome,
          w2Income: ctx.totalIncome - ctx.bizIncome,
          netSE: ctx.netSE,
          marginal: ctx.marginal,
          totalBizDed: ctx.totalBizDed,
          expenses: ctx.expenses,
          scenario: ctx.scenario,
          position: ctx.position,
        }),
      });

      const data = await res.json().catch(() => ({}));
      // Always set insights so the scan result is visible — even a topInsight fallback is useful
      setAiInsights({
        rankedIds: Array.isArray(data.rankedIds) ? data.rankedIds : [],
        topInsight: data.topInsight || data.error || "Scan complete. Review the strategies below.",
        insights: data.insights || {},
      });
    } catch (err) {
      console.error("AI scan error:", err);
    } finally {
      setIsScanning(false);
      setHasScanned(true);
    }
  };

  return (
    <div style={{ animation: "fadeIn 0.4s ease-out" }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .opp-card:hover { border-color: ${t.blue}66 !important; background: ${t.surface} !important; box-shadow: 0 10px 30px -5px rgba(0,0,0,0.1); }
        .opp-tab { cursor: pointer; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); border: 1px solid ${t.border}; outline: none; }
        .opp-tab:hover { border-color: ${t.blue}66; scale: 1.02; }
        .opp-tab.active { border-color: ${t.blue}; background: ${t.blue}08; box-shadow: 0 4px 12px ${t.blue}11; }
      `}</style>

      {/* 1. TOP SUMMARY STRIP */}
      <div style={{ 
        background: `linear-gradient(135deg, ${t.blue}aa 0%, ${t.surface2} 100%)`, 
        border: `1px solid ${t.border}`, 
        borderRadius: "16px", 
        padding: "24px", 
        marginBottom: "24px", 
        display: "grid", 
        gridTemplateColumns: "1fr 1.5fr 1fr", 
        gap: "24px",
        alignItems: "center",
        backdropFilter: "blur(12px)",
        boxShadow: `0 8px 32px -4px ${t.blue}22`,
        position: "relative",
        overflow: "hidden"
      }}>
        {isScanning && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 10, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: "700", gap: "12px", backdropFilter: "blur(4px)" }}>
            <div style={{ width: "16px", height: "16px", border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
            AI IS SCANNING CONTEXT...
          </div>
        )}
        <style>{` @keyframes spin { to { transform: rotate(360deg); } } `}</style>

        <div>
          <div style={{ fontSize: "11px", fontWeight: "700", color: t.textDim, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "4px" }}>Potential Additional Savings</div>
          <div style={{ fontSize: "36px", fontWeight: "800", color: t.text }}>{fmt(totalPotential)}</div>
        </div>
        <div style={{ borderLeft: `1px solid ${t.border}`, borderRight: `1px solid ${t.border}`, padding: "0 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ fontSize: "11px", fontWeight: "700", color: t.textDim, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "4px" }}>Best Next Move</div>
            {!hasScanned && (
              <button onClick={triggerScan} disabled={isScanning} style={{ background: t.blue, color: "#fff", border: "none", borderRadius: "4px", padding: "2px 8px", fontSize: "10px", fontWeight: "700", cursor: isScanning ? "default" : "pointer", opacity: isScanning ? 0.7 : 1 }}>
                {isScanning ? "SCANNING..." : "⚡ AI SCAN"}
              </button>
            )}
          </div>
          {aiInsights?.topInsight ? (
            <div style={{ fontSize: "13px", fontWeight: "500", color: "#fff", lineHeight: "1.4" }}>{aiInsights.topInsight}</div>
          ) : topOpps.length > 0 ? (
            <div style={{ fontSize: "18px", fontWeight: "600", color: "#fff" }}>{topOpps[0].title}</div>
          ) : (
            <div style={{ fontSize: "18px", fontWeight: "600", color: t.green }}>Fully Optimized ✓</div>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "11px", fontWeight: "700", color: t.textDim, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "4px" }}>Open Opportunities</div>
          <div style={{ fontSize: "36px", fontWeight: "800", color: t.text }}>{topOpps.length}</div>
        </div>
      </div>

      {/* 2. RANKED OPPORTUNITY TABS */}
      <div style={{ marginBottom: "40px" }}>
        <h3 style={{ fontSize: "14px", fontWeight: "700", color: t.textDim, letterSpacing: "0.5px", marginBottom: "16px" }}>PRIORITY STRATEGIES</h3>
        
        <div style={{ display: "flex", gap: "12px", marginBottom: "24px", overflowX: "auto", padding: "4px 4px 12px", scrollbarWidth: "none" }}>
          {topOpps.length > 0 ? topOpps.map(opp => {
            const isApplied = ctx.scenario[opp.field] > 0 || (opp.id === "home-office" && ctx.homeOfficeDed > 0);
            const needsInfo = opp.check(ctx) && !isApplied;
            return (
              <div 
                key={opp.id} 
                onClick={() => setSelectedOppId(opp.id)}
                className={`opp-tab ${selectedOppId === opp.id ? "active" : ""}`}
                style={{ 
                  flexShrink: 0, minWidth: "220px", background: t.surface, borderRadius: "12px", padding: "16px", textAlign: "left"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                  <div style={{ fontSize: "11px", fontWeight: "800", color: isApplied ? t.green : (needsInfo && selectedOppId !== opp.id ? t.amber : t.textDim) }}>
                    {isApplied ? "APPLIED ✓" : (needsInfo ? "NEEDS INFO" : "STRATEGY")}
                  </div>
                  <div style={{ fontSize: "12px", fontWeight: "800", color: t.green }}>+{fmt(opp.estSavings)}</div>
                </div>
                <div style={{ fontSize: "15px", fontWeight: "700", color: t.text, marginBottom: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{opp.title}</div>
                <div style={{ fontSize: "10px", color: t.textFaint, fontWeight: "600" }}>{opp.confidence.toUpperCase()} CONFIDENCE</div>
              </div>
            );
          }) : (
            <div style={{ padding: "40px", textAlign: "center", background: t.surface, border: `1px dashed ${t.border}`, borderRadius: "12px", color: t.textDim, width: "100%" }}>
              No high-impact opportunities remaining based on current data.
            </div>
          )}
        </div>

        {selectedOpp && (
          <div style={{ transition: "all 0.3s ease-out", animation: "tabEnter 0.3s ease-out" }}>
            <style>{` @keyframes tabEnter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } } `}</style>
            <OpportunityCard
              key={selectedOpp.id}
              t={t}
              opp={selectedOpp}
              ctx={ctx}
              onApply={(val) => onApply(selectedOpp, val)}
              onDismiss={() => onDismiss(selectedOpp.id)}
              isActiveScenario={activeScenarioId === selectedOpp.id}
              setActiveScenarioId={setActiveScenarioId}
              tempValue={tempScenarioValue}
              setTempValue={setTempScenarioValue}
              fmt={fmt}
              aiInsight={aiInsights?.insights?.[selectedOpp.id]}
            />
          </div>
        )}
      </div>

      {/* 3. SECONDARY SECTIONS */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
        <div>
          <h3 style={{ fontSize: "13px", fontWeight: "700", color: t.textDim, marginBottom: "12px" }}>COMMONLY MISSED</h3>
          {secondaryOppsArr.length > 0 ? secondaryOppsArr.map(o => (
            <div key={o.id} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "10px", padding: "14px", marginBottom: "10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "13px", fontWeight: "600" }}>{o.title}</span>
              <span style={{ fontSize: "12px", color: t.green, fontWeight: "700" }}>+{fmt(o.estSavings)}</span>
            </div>
          )) : <div style={{ fontSize: "12px", color: t.textFaint }}>All common items reviewed.</div>}
        </div>
        <div>
          <h3 style={{ fontSize: "13px", fontWeight: "700", color: t.textDim, marginBottom: "12px" }}>ADVANCED STRATEGIES</h3>
          {advancedOppsArr.map(o => (
            <div key={o.id} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: "10px", padding: "14px", marginBottom: "10px", opacity: o.applies ? 1 : 0.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <span style={{ fontSize: "13px", fontWeight: "600" }}>{o.title}</span>
                {o.applies && <span style={{ fontSize: "11px", fontWeight: "700", color: t.blue }}>Recommended</span>}
              </div>
              <div style={{ fontSize: "11px", color: t.textDim }}>{o.whyMsg}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function OpportunityCard({ t, opp, ctx, onApply, onDismiss, isActiveScenario, setActiveScenarioId, tempValue, setTempValue, fmt, aiInsight }) {
  const isApplied = ctx.scenario[opp.field] > 0 || (opp.id === "home-office" && ctx.homeOfficeDed > 0);

  return (
    <div className="opp-card" style={{
      background: isActiveScenario ? `${t.blue}08` : t.surface,
      border: `1px solid ${isActiveScenario ? t.blue : t.border}`,
      borderRadius: "16px",
      padding: "24px",
      transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
      position: "relative",
      overflow: "hidden"
    }}>
      {isActiveScenario && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "4px", background: t.blue }} />}

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ fontSize: "18px", fontWeight: "700", color: t.text }}>{opp.title}</div>
          <div style={{ background: opp.confidence === "High" ? `${t.green}22` : `${t.amber}22`, color: opp.confidence === "High" ? t.green : t.amber, padding: "2px 8px", borderRadius: "4px", fontSize: "10px", fontWeight: "700", letterSpacing: "0.5px" }}>
            {opp.confidence.toUpperCase()} CONFIDENCE
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "10px", color: t.textDim, fontWeight: "700", letterSpacing: "0.5px" }}>EST. SAVINGS</div>
          <div style={{ fontSize: "20px", fontWeight: "800", color: t.green, fontFamily: "'DM Mono',monospace" }}>~{fmt(opp.estSavings)}</div>
        </div>
      </div>

      <div style={{ fontSize: "14px", color: t.textMuted, lineHeight: "1.5", marginBottom: aiInsight ? "12px" : "20px", maxWidth: "80%" }}>
        {opp.whyMsg}
      </div>

      {aiInsight && (
        <div style={{ background: `${t.blue}0d`, border: `1px solid ${t.blue}33`, borderRadius: "8px", padding: "10px 14px", marginBottom: "20px", display: "flex", gap: "8px", alignItems: "flex-start" }}>
          <span style={{ fontSize: "11px", fontWeight: "700", color: t.blue, whiteSpace: "nowrap", marginTop: "1px" }}>⚡ AI</span>
          <span style={{ fontSize: "12px", color: t.text, lineHeight: "1.45" }}>{aiInsight}</span>
        </div>
      )}

      <div style={{ display: "flex", gap: "24px", marginBottom: "20px", padding: "12px", background: t.surface2, borderRadius: "10px" }}>
        <div>
          <div style={{ fontSize: "9px", color: t.textDim, fontWeight: "700", marginBottom: "4px" }}>DATA USED</div>
          <div style={{ display: "flex", gap: "8px" }}>
            {opp.dataUsed.map(d => <span key={d} style={{ fontSize: "11px", color: t.text }}>• {d}</span>)}
          </div>
        </div>
      </div>

      {isActiveScenario && opp.missingFacts.length > 0 && (
        <div style={{ background: `${t.amber}11`, border: `1px solid ${t.amber}33`, borderRadius: "12px", padding: "16px", marginBottom: "20px" }}>
          <div style={{ fontSize: "12px", color: t.amber, fontWeight: "700", marginBottom: "12px" }}>ONE FINAL FACT NEEDED</div>
          {opp.missingFacts.map(fact => (
            <div key={fact.id}>
              <label style={{ fontSize: "11px", color: t.textDim, display: "block", marginBottom: "6px" }}>{fact.label}</label>
              <input 
                type={fact.type === "currency" ? "number" : fact.type} 
                value={tempValue} 
                onChange={(e) => setTempValue(e.target.value)}
                placeholder={fact.placeholder}
                autoFocus
                style={{ background: t.inputBg, border: `1px solid ${t.amber}44`, borderRadius: "8px", color: t.text, padding: "10px 14px", width: "100%", outline: "none", fontSize: "14px" }}
              />
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: "10px" }}>
          {!isActiveScenario ? (
            <>
              <button 
                onClick={() => setActiveScenarioId(opp.id)}
                style={{ background: t.blue, color: "#fff", border: "none", borderRadius: "10px", padding: "10px 20px", fontSize: "13px", fontWeight: "700", cursor: "pointer", transition: "all 0.15s" }}
              >
                Apply scenario
              </button>
              <button 
                onClick={onDismiss}
                style={{ background: "none", color: t.textDim, border: `1px solid ${t.border}`, borderRadius: "10px", padding: "10px 20px", fontSize: "13px", fontWeight: "600", cursor: "pointer" }}
              >
                Dismiss
              </button>
            </>
          ) : (
            <>
              <button 
                onClick={() => {
                  onApply(parseFloat(tempValue) || opp.estSavings / 0.22); // naive fallback
                  setActiveScenarioId(null);
                  setTempValue("");
                }}
                style={{ background: t.green, color: "#fff", border: "none", borderRadius: "10px", padding: "10px 24px", fontSize: "13px", fontWeight: "700", cursor: "pointer" }}
              >
                Confirm & Add to Profile
              </button>
              <button 
                onClick={() => { setActiveScenarioId(null); setTempValue(""); }}
                style={{ background: "none", color: t.textDim, border: "none", borderRadius: "10px", padding: "10px 20px", fontSize: "13px", fontWeight: "600", cursor: "pointer" }}
              >
                Cancel
              </button>
            </>
          )}
        </div>
        <button style={{ background: "none", border: "none", color: t.blue, fontSize: "12px", fontWeight: "600", cursor: "pointer" }}>Ask Wrytoff AI about this →</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// TAXBOT
// ─────────────────────────────────────────────
const CHAT_STARTERS = [
  "What deductions am I missing?",
  "How much can I save with a SEP-IRA?",
  "Can I deduct my home office?",
  "Add a software subscription expense",
  "What is my estimated refund?",
];

function TaxBot({ t, calc, expenses, dispatch, setActiveTab }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi, I am Wrytoff AI. Ask me about your taxes, deductions, or how to reduce what you owe. I can also update your numbers directly." }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef();

  useEffect(() => { if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, open]);

  const buildSystemPrompt = () => {
    const expList = expenses.length > 0
      ? expenses.slice(0, 10).map(e => `${e.vendor} (${e.category}) $${Math.round(e.annualizedAmount || e.amount || 0)}/yr`).join(", ")
      : "none tracked yet";
    return `IMPORTANT RULES: Reply in 2-3 plain sentences maximum. Never use asterisks (**), pound signs (#), hyphens for bullets, or any other markdown symbols. Plain text only.

You are Wrytoff AI, a friendly tax assistant for self-employed business owners. Answer conversationally and briefly.

Current user tax profile:
- Business income: ${fmt(calc.netSE + calc.totalBizDed)}
- W-2 income: ${fmt(calc.totalIncome - calc.netSE - calc.totalBizDed)}
- Net self-employment income: ${fmt(calc.netSE)}
- Total business deductions: ${fmt(calc.totalBizDed)}
- Adjusted gross income: ${fmt(calc.agi)}
- Federal tax owed: ${fmt(calc.fedTax)}
- SE tax: ${fmt(calc.seTax)}
- Withholding: ${fmt(calc.withheld)}
- Estimated tax position: ${calc.isRefund ? "refund of " : "owed "}${fmt(calc.position)}
- Marginal tax rate: ${pct(calc.marginal)}
- Tracked expenses (${expenses.length} items): ${expList}

IRS context: Standard deduction MFJ is $30,000 in 2026. SE tax is 15.3% on 92.35% of net SE income. Half of SE tax is deductible above the line. SEP-IRA max is 25% of net SE or $69,000. Meals are 50% deductible. Mileage rate is $0.70/mile.

You can take actions to update the user profile by including a JSON block when the user explicitly asks to add or change something. Format:
\`\`\`actions
[{"type":"ADD_EXPENSE","expense":{"vendor":"Name","category":"Software & Subscriptions","amount":100,"frequency":"monthly"}},{"type":"SET_BIZ_INCOME","value":120000}]
\`\`\`
Available action types: SET_W2_INCOME (value), SET_BIZ_INCOME (value), ADD_EXPENSE (expense object with vendor/category/amount/frequency), APPLY_OPTIMIZATION (field, value), NAVIGATE (tab: "expenses"|"income"|"optimizations"|"summary").
Only include an actions block when the user explicitly asks to add or change data.`;
  };

  const sendMessage = async (text) => {
    const content = text || input;
    if (!content.trim() || loading) return;
    const userMsg = { role: "user", content };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })),
          system: buildSystemPrompt(),
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      const raw = data.content || "";

      // Parse and dispatch any actions block
      const actionMatch = raw.match(/```actions\s*([\s\S]*?)```/);
      if (actionMatch) {
        try {
          const actions = JSON.parse(actionMatch[1].trim());
          if (Array.isArray(actions)) dispatch(actions);
        } catch (_) {}
      }

      // Strip actions block, then strip any residual markdown the model added
      const stripped = raw.replace(/```actions[\s\S]*?```/g, "").trim();
      const displayText = stripped
        .replace(/\*\*(.*?)\*\*/g, "$1")   // **bold** → bold
        .replace(/\*(.*?)\*/g, "$1")        // *italic* → italic
        .replace(/#{1,6}\s+/g, "")          // headings
        .replace(/^\s*[-*]\s+/gm, "")       // bullet points
        .replace(/^\d+\.\s+/gm, "")         // numbered lists
        .replace(/`{1,3}[^`]*`{1,3}/g, "")  // inline code
        .replace(/\n{3,}/g, "\n\n")          // collapse excess blank lines
        .trim();
      // Only push if there's actual text — if the response was actions-only, say nothing
      if (displayText) {
        setMessages(prev => [...prev, { role: "assistant", content: displayText }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: "Something went wrong. Please try again." }]);
      console.error("TaxBot error:", err);
    }
    setLoading(false);
  };

  const showStarters = messages.length === 1;

  return (
    <>
      <div
        onClick={() => setOpen(!open)}
        style={{ position: "fixed", bottom: "24px", right: "24px", background: "#2563eb", color: "#fff", borderRadius: "30px", padding: "10px 20px", cursor: "pointer", boxShadow: "0 10px 20px rgba(0,0,0,0.2)", zIndex: 1000, fontWeight: "600", userSelect: "none" }}
      >
        {open ? "Close Chat" : "Ask Wrytoff AI"}
      </div>
      {open && (
        <div style={{ position: "fixed", bottom: "80px", right: "24px", width: "360px", height: "520px", background: t.surface, border: `1px solid ${t.border}`, borderRadius: "16px", boxShadow: "0 20px 40px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column", zIndex: 1000 }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${t.border}`, fontSize: "13px", fontWeight: "700", color: t.textDim }}>WRYTOFF AI</div>
          <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
            {messages.map((m, i) => (
              <div key={i} style={{ marginBottom: "12px", textAlign: m.role === "user" ? "right" : "left" }}>
                <div style={{ display: "inline-block", background: m.role === "user" ? "#2563eb" : t.surface2, color: m.role === "user" ? "#fff" : t.text, padding: "8px 12px", borderRadius: "12px", fontSize: "13px", maxWidth: "85%", lineHeight: "1.45" }}>
                  {m.content}
                </div>
              </div>
            ))}
            {showStarters && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
                {CHAT_STARTERS.map(s => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    disabled={loading}
                    style={{ background: t.bg, border: `1px solid ${t.border2}`, borderRadius: "8px", padding: "7px 11px", fontSize: "12px", color: t.blue, cursor: loading ? "default" : "pointer", textAlign: "left", fontFamily: "inherit", opacity: loading ? 0.5 : 1 }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {loading && (
              <div style={{ textAlign: "left", marginBottom: "12px" }}>
                <div style={{ display: "inline-block", background: t.surface2, padding: "8px 14px", borderRadius: "12px", fontSize: "12px", color: t.textDim }}>
                  Thinking...
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          <div style={{ padding: "12px", borderTop: `1px solid ${t.border}` }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && sendMessage()}
              placeholder="Ask a tax question..."
              disabled={loading}
              style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: `1px solid ${t.border}`, background: t.bg, color: t.text, outline: "none", boxSizing: "border-box", fontFamily: "inherit", fontSize: "13px" }}
            />
          </div>
        </div>
      )}
    </>
  );
}

const DARK = {
  bg: "#0a0a0f", surface: "#111827", surface2: "#0f172a", border: "#1e293b", border2: "#334155",
  text: "#e2e8f0", textMuted: "#94a3b8", textDim: "#64748b", textFaint: "#475569", blue: "#3b82f6", green: "#10b981", red: "#ef4444", amber: "#f59e0b",
  modalOverlay: "rgba(0,0,0,0.7)", modalBg: "#111827", headerBg: "#0a0a0f", inputBg: "#0f172a",
  effectiveBg: "#0f2a1e", effectiveBorder: "#10b98144", effectiveLabel: "#10b981", effectiveNum: "#10b981",
  irsTagBg: "#1a1c2e", irsTagText: "#93c5fd", irsTagBorder: "#3b82f633",
  catColors: {
    "Housing & Real Estate": { bg: "#422006", accent: "#fbbf24", text: "#fbbf24" },
    "Utilities": { bg: "#422006", accent: "#fbbf24", text: "#fbbf24" },
    "Software & Subscriptions": { bg: "#1e3a8a", accent: "#60a5fa", text: "#60a5fa" },
    "Meals & Entertainment": { bg: "#064e3b", accent: "#34d399", text: "#34d399" },
    "Travel & Transportation": { bg: "#4c1d95", accent: "#a78bfa", text: "#a78bfa" },
    "Professional Services": { bg: "#164e63", accent: "#22d3ee", text: "#22d3ee" },
    "Education & Development": { bg: "#312e81", accent: "#818cf8", text: "#818cf8" },
    "Marketing & Advertising": { bg: "#7c2d12", accent: "#fb923c", text: "#fb923c" },
    "Equipment & Hardware": { bg: "#1e293b", accent: "#94a3b8", text: "#94a3b8" },
    "Insurance": { bg: "#831843", accent: "#f472b6", text: "#f472b6" },
    "Retirement & Benefits": { bg: "#134e4a", accent: "#2dd4bf", text: "#2dd4bf" },
    "Office & Supplies": { bg: "#374151", accent: "#9ca3af", text: "#9ca3af" },
  }
};
const LIGHT = {
  bg: "#f8fafc", surface: "#ffffff", surface2: "#f1f5f9", border: "#e2e8f0", border2: "#cbd5e1",
  text: "#0f172a", textMuted: "#475569", textDim: "#64748b", textFaint: "#94a3b8", blue: "#2563eb", green: "#16a34a", red: "#dc2626", amber: "#f59e0b",
  modalOverlay: "rgba(0,0,0,0.4)", modalBg: "#ffffff", headerBg: "#f8fafc", inputBg: "#f1f5f9",
  effectiveBg: "#f0fdf4", effectiveBorder: "#16a34a44", effectiveLabel: "#16a34a", effectiveNum: "#16a34a",
  irsTagBg: "#eff6ff", irsTagText: "#2563eb", irsTagBorder: "#3b82f633",
  catColors: {
    "Housing & Real Estate": { bg: "#fef2f2", accent: "#ef4444", text: "#991b1b" },
    "Utilities": { bg: "#fffbeb", accent: "#f59e0b", text: "#92400e" },
    "Software & Subscriptions": { bg: "#eff6ff", accent: "#3b82f6", text: "#1e40af" },
    "Meals & Entertainment": { bg: "#f0fdf4", accent: "#10b981", text: "#065f46" },
    "Travel & Transportation": { bg: "#faf5ff", accent: "#8b5cf6", text: "#5b21b6" },
    "Professional Services": { bg: "#ecfeff", accent: "#06b6d4", text: "#155e75" },
    "Education & Development": { bg: "#f5f3ff", accent: "#7c3aed", text: "#4c1d95" },
    "Marketing & Advertising": { bg: "#fff7ed", accent: "#f97316", text: "#9a3412" },
    "Equipment & Hardware": { bg: "#f8fafc", accent: "#64748b", text: "#334155" },
    "Insurance": { bg: "#fdf2f7", accent: "#db2777", text: "#9d174d" },
    "Retirement & Benefits": { bg: "#f0fdfa", accent: "#14b8a6", text: "#115e59" },
    "Office & Supplies": { bg: "#f9fafb", accent: "#6b7280", text: "#374151" },
  }
};
