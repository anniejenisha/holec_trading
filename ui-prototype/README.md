# Holec ERP — UI Prototype

A standalone frontend reference client that simulates the full Holec maize-trading
lifecycle — **Ticket → Intake → Lot → Position → Invoiced → Settled** — with live,
in-memory state.

## What this is (and isn't)

This is a **UI/UX prototype**, not the ERPNext implementation. Its job is to let
Holec and their ERPNext developer agree on exactly how every screen should look
and behave *before* it gets built in ERPNext. It is completely disconnected from
any real backend, database, or ERPNext instance.

- `ui-prototype/` — this project (React frontend, prototype only)
- `holec_trading/` — the real ERPNext custom app (Frappe backend, the actual system)

These two never share code and are never meant to be merged. `ui-prototype/`
exists purely to validate screen design and business-rule behavior in a fast,
disposable environment.

`ui-prototype/reference/holec-erp-prototype.html` is the original single-file
HTML prototype this project was rebuilt from. It's kept as the source of truth
for field names, calculation logic, and copy — check it before changing any
business rule here.

## Tech stack

Vite + React + TypeScript, Tailwind CSS v4, shadcn/ui, React Router, Zustand,
Recharts, lucide-react.

## Running locally

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173` (or the next available port).

## Data & persistence

Everything lives in an in-memory Zustand store (`src/store/useStore.ts`), seeded
on load with demo suppliers, customers, and six lots spanning every stage
(`src/lib/seed.ts`). **There is no persistence** — refreshing the page resets to
seed data. This is intentional; do not add localStorage, IndexedDB, or a backend.

## Structure

```
src/
  types/            Domain types (Supplier, Customer, Lot, Payment, TradeEvent…)
  lib/
    calculations.ts Payable/transport/landed-cost/margin math — ported verbatim
                     from the reference HTML file. Numeric parity matters here.
    seed.ts          Seed data (suppliers, customers, lots, payments)
    format.ts        fmtKES / fmtKg / uid / date helpers
    nav.ts           Sidebar groups + timeline stage config
  store/
    useStore.ts      Central domain store + all mutating actions
    useUiStore.ts    UI-only state (currently "active lot" for the timeline)
  components/
    layout/          Sidebar, Topbar, TimelineStrip, AppShell
    shared/          TierTag, StatusBadge, DataTable, EmptyState, etc.
    ui/              shadcn/ui primitives
  pages/             One file per route (see App.tsx for the route list)
```

## The tier tag system

Every form field carries a `TierTag`: **Native** (out-of-the-box ERPNext),
**Configure** (ERPNext config, no code), or **Build** (needs custom
development). This is the actual point of the prototype — it tells the ERPNext
developer what's already available vs. what needs building, field by field.
Keep it on every field; don't treat it as decorative.

## Known intentional gaps (matching the reference)

- No authentication — a static "You · Purchase User" chip in the top bar.
- No real eTIMS or Mpesa integration — control numbers and references are
  randomly generated on submit.
- No Company Setup or Roles & Permissions screens — one-time admin config in
  the real system, out of scope for a daily-use prototype.
