# No Overtime 🧾⚡
> Friction-free, "boomer-proof" receipt and invoice scanning SaaS for UK small business owners and sole traders.

[![Next.js](https://img.shields.io/badge/Next.js-16%20App%20Router-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-blue?style=flat-square&logo=react)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38B2AC?style=flat-square&logo=tailwind-css)](https://tailwindcss.com/)
[![Capacitor](https://img.shields.io/badge/Capacitor-8-119EFF?style=flat-square&logo=capacitor)](https://capacitorjs.com/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL%2015+-3ECF8E?style=flat-square&logo=supabase)](https://supabase.com/)
[![HMRC Compliant](https://img.shields.io/badge/HMRC-Making%20Tax%20Digital-darkgreen?style=flat-square)](#hmrc-excel-export-engine)

---

## 🌟 Core Philosophy: "Show the Magic First"

Traditional accounting apps force small business owners through painful onboarding walls and credit card gates before showing any value. **No Overtime flips the script:**

- **Zero Barriers**: Drag-and-drop or snap a receipt instantly upon opening the app.
- **Instant Offline OCR**: Rapid parsing on-device with zero sign-up required.
- **Boomer-Proof Interface**: Massive high-contrast numbers, giant 56px (`h-14`) touch targets, and unmistakable color-coded confidence badges.
- **Soft Authentication Gates**: Supabase 6-digit Email OTP only appears when requesting Cloud AI enhancement or exporting financial workbooks.

---

## 🏗️ Architecture & Tech Stack

| Layer | Technology | Details |
|---|---|---|
| **Frontend Framework** | Next.js 16 (App Router) + React 19 | Static export compatible + dynamic API routes |
| **Styling** | Tailwind CSS v4 | High-contrast accessible design system |
| **Native Bridge** | Capacitor 8 | `@capacitor/core`, `@capacitor/camera`, `@capacitor/device`, `@capacitor/haptics` |
| **Database & Auth** | Supabase (PostgreSQL 15+) | Hosted strictly in London (`eu-west-2`) for UK GDPR compliance |
| **Storage** | Supabase Storage | Private `receipt-images` bucket with 15-minute signed URLs |
| **Parser Engine** | `receipt-to-json` (`src/lib/receipt-to-json.ts`) | UK-tuned regex engine (`DD/MM/YYYY`, 20% VAT, 12.5% service charges, card-terminal noise stripper) |
| **Export Engine** | `exceljs` + `file-saver` (`src/lib/excel-export.ts`) | Multi-tab HMRC workbooks with dynamic `=SUM()` formula cells |

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js**: v18.18+ or v20+
- **npm**: v10+

### 2. Installation
```bash
git clone https://github.com/mikemklau/no-overtime.git
cd no-overtime/no-overtime-app
npm install
```

### 3. Environment Setup
Copy the template environment file:
```bash
cp .env.local.example .env.local
```
Fill in your Supabase project credentials (see [Supabase Setup](#-supabase-database--auth-setup)):
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 4. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📱 Build Modes

The project supports both web server deployment and Capacitor native packaging:

```bash
# Standard Next.js production build (Web / Vercel with dynamic API routes)
npm run build

# Capacitor Native Shell static HTML export (outputs to /out directory)
npm run build:capacitor
```

---

## 🗄️ Supabase Database & Auth Setup

### 1. Create Supabase Project
Create a free Supabase project at [supabase.com](https://supabase.com).  
> **Important**: Select **London (`eu-west-2`)** as the region to maintain strict UK GDPR compliance.

### 2. Run the SQL Migration
Navigate to your **Supabase Dashboard → SQL Editor → New Query**, and paste the full contents of:
[`supabase/migrations/00001_initial_schema.sql`](./supabase/migrations/00001_initial_schema.sql)

This single migration automatically creates:
- **`profiles` table**: 1:1 with `auth.users`, tracking subscription tier (`free` / `pro`) and Cloud AI scan counters.
- **`device_usage` table**: Prevents free-tier reinstall abuse on mobile devices via `Device.getId()`.
- **`receipts` table**: UK fields (Merchant, Date, Net Subtotal, 20% VAT, Service Charge, Gross Total, Confidence Score, Status).
- **`receipt_items` table**: Detailed line items for the Excel Line Items tab.
- **Row-Level Security (RLS)**: Strict policies ensuring users can only read and write their own data.
- **Private Storage Bucket (`receipt-images`)**: Restricted to folder `{user_id}/*`.
- **GDPR Cascading Deletion Trigger**: Deleting a profile automatically cascades to all receipts, items, and deletes all corresponding image files from the Storage bucket.

---

## 📊 HMRC Excel Export Engine

Clicking **"Download Excel Spreadsheet"** generates a fully styled `.xlsx` workbook featuring:

1. **Summary Tab**:
   - Total Gross Expenditure (Inc. VAT)
   - Total UK 20% VAT Reclaimable
   - Net Business Expenditure
   - Accounting Date Range & Receipt Count
   - HMRC Making Tax Digital (MTD) compliance statement
2. **Receipts Register Tab**:
   - Frozen top header row with Teal header styling
   - Formatted in UK pounds (`£#,##0.00`)
   - **Native Dynamic Formulas**: `=SUM(E2:E...)`, `=SUM(F2:F...)` for live calculations when opened in Microsoft Excel, Apple Numbers, or Google Sheets.
3. **Line Items Tab**:
   - Detailed breakdown of quantities, unit prices, descriptions, and assigned expense categories.

---

## 🛡️ Anti-Abuse & Guardrail Fortress

1. **Financial Hardstop**: Configure a hard spend limit of £20 / $25 per month in the OpenAI Billing Console.
2. **Device-Level Quota Tracking**: On mobile, `@capacitor/device` checks physical device ID to block reinstall abuse.
3. **Server-Side Quota Enforcement**: `/api/process-receipt` checks `subscription_tier`. If `free` and `ai_scans_used >= ai_scans_limit`, returns HTTP `403 QUOTA_EXCEEDED` and prompts the Upgrade to Premium modal.
4. **Data Minimization**: Parser strips raw card numbers, PIN/AID verification, and terminal identifiers before storing to database.

---

## 🛠️ Code Structure

```
no-overtime-app/
├── public/                 # Static assets
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── process-receipt/
│   │   │       └── route.ts       # Quota checks, auth gate & receipt upload API
│   │   ├── globals.css            # Native feel CSS (-webkit-tap-highlight, user-select)
│   │   ├── layout.tsx             # Root layout with viewport-fit cover & metadata
│   │   └── page.tsx               # Main application entry point
│   ├── components/
│   │   ├── OtpModal.tsx           # Supabase 6-digit email OTP login modal
│   │   ├── ReceiptScanner.tsx     # Drag-and-drop verification UI & sample receipts
│   │   └── UpgradeModal.tsx       # Quota reached upgrade to Pro modal
│   └── lib/
│       ├── database.types.ts      # TypeScript interfaces for Supabase schema
│       ├── excel-export.ts        # HMRC multi-tab Excel generator (ExcelJS)
│       ├── haptics.ts             # Safe Capacitor haptics utility with web fallback
│       ├── receipt-to-json.ts     # Standalone UK-tuned receipt parser
│       └── supabase/
│           ├── client.ts          # Browser Supabase client (@supabase/ssr)
│           └── server.ts          # Server Supabase client (@supabase/ssr)
├── supabase/
│   └── migrations/
│       └── 00001_initial_schema.sql # GDPR schema, RLS, storage & triggers
├── capacitor.config.ts    # Capacitor mobile container configuration
├── next.config.ts         # Next.js configuration (conditional static export)
└── package.json           # Dependencies and build scripts
```

---

## 🧪 Testing & Verification

Run the test and verification suite:

```bash
# Verify ESLint (0 errors, 0 warnings)
npm run lint

# Verify Next.js Server & Client build
npm run build

# Verify Capacitor Static HTML Export
npm run build:capacitor
```

---

## 📄 License
Private & Proprietary. All rights reserved.
