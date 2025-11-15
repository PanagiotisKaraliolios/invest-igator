# Financial Data Management - Admin Panel

## Overview
Complete financial data management interface for administrators to monitor and manage symbols, data quality, and FX rates.

## Features Implemented

### 1. Symbol Management 📊
**Route:** `/admin/financial-data` → Symbols tab

**Functionality:**
- View all unique symbols across all user watchlists
- Search symbols by ticker, display name, or description
- Sort by symbol, user count, or creation date
- Edit symbol metadata (display name, description, type, currency)
- View user count per symbol
- Paginated table with debounced search (300ms)

**Components:**
- `SymbolManagementTable` - Main table with TanStack Table
- `EditSymbolModal` - Modal form for editing symbol metadata

**API Endpoints:**
- `financialData.getAllSymbols` - Get paginated symbols with search/sort
- `financialData.updateSymbol` - Update symbol metadata across all users

### 2. Data Quality Monitoring 🔍
**Route:** `/admin/financial-data` → Data Quality tab

**Functionality:**
- Check data availability for symbols in InfluxDB
- Filter by specific symbol or date range
- Identify symbols with missing OHLCV data
- View data point counts per symbol
- Track errors during data checks
- Results sorted by data coverage (least data first)

**Components:**
- `DataQualityPanel` - Quality check interface with filters

**API Endpoints:**
- `financialData.checkDataQuality` - Analyze data availability in InfluxDB

### 3. Manual Data Fetch ⬇️
**Route:** `/admin/financial-data` → Manual Fetch tab

**Functionality:**
- Manually trigger Yahoo Finance data ingestion for any symbol
- Force re-fetch option to update existing data
- Real-time progress feedback
- View ingestion results (bars count, skipped status)
- Recent fetch history tracking via audit logs

**Components:**
- `ManualFetchPanel` - Fetch form with force option

**API Endpoints:**
- `financialData.triggerDataFetch` - Manually fetch OHLCV data from Yahoo

### 4. FX Rate Monitoring 💱
**Route:** `/admin/financial-data` → FX Rates tab

**Functionality:**
- View all currency conversion rates
- Filter by base or quote currency
- Monitor rate freshness with color-coded status:
  - Green: < 24 hours (Fresh)
  - Yellow: 24-72 hours (Stale)
  - Red: > 72 hours (Old)
- Statistics dashboard:
  - Total rates count
  - Average age in hours
  - Most recent update timestamp

**Components:**
- `FxRatesPanel` - FX rates table with filters and stats

**API Endpoints:**
- `financialData.getFxRates` - Get FX rates with monitoring stats

### 5. Ingestion Statistics 📈
**Displayed:** Overview cards on all tabs

**Metrics:**
- Total unique symbols in watchlists
- Symbols with OHLCV data
- Data coverage percentage (with color coding)
- Recent manual fetches count

**Components:**
- `IngestionStatsCard` - Overview metrics cards

**API Endpoints:**
- `financialData.getIngestionStats` - Get ingestion coverage stats

## Technical Implementation

### Backend (tRPC Router)
**File:** `src/server/api/routers/financial-data.ts`

All procedures require admin role (admin or superadmin). Audit logging for:
- Symbol viewing and editing
- Data quality checks
- Manual data fetches (success and failure)
- FX rate viewing

**Integrations:**
- Prisma for watchlist/audit log queries
- InfluxDB for OHLCV data checks
- Yahoo Finance via `ingestYahooSymbol` helper
- Alpha Vantage (via existing FX job)

### Frontend Components
**Base:** `src/app/(dashboard)/admin/_components/`

- `financial-data-dashboard.tsx` - Main dashboard with tabs
- `symbol-management-table.tsx` - Symbol CRUD table
- `edit-symbol-modal.tsx` - Symbol edit form
- `data-quality-panel.tsx` - Data quality checker
- `manual-fetch-panel.tsx` - Manual fetch form
- `fx-rates-panel.tsx` - FX rates monitor
- `ingestion-stats-card.tsx` - Stats overview

**Patterns:**
- TanStack Table v8 for complex data tables
- React Hook Form + Zod for forms
- Debounced search (300ms)
- Server-side pagination and sorting
- Skeleton loading states
- Toast notifications (sonner)
- Field component pattern for forms

### Navigation
**Updated:** `src/app/(dashboard)/_components/app-sidebar.tsx`

Added "Financial Data" link to Admin menu, active state detection via `pathname.startsWith('/admin/financial-data')`.

## Security & Audit

All admin actions are logged to the `AuditLog` table with:
- Admin ID and email
- Action type
- Timestamp
- Details (JSON)
- IP address (where applicable)

Actions logged:
- `VIEW_SYMBOLS`
- `SYMBOL_UPDATE`
- `VIEW_DATA_QUALITY`
- `MANUAL_DATA_FETCH`
- `VIEW_FX_RATES`

## Usage Examples

### Edit Symbol Metadata
1. Navigate to `/admin/financial-data`
2. Search for symbol in Symbols tab
3. Click edit icon
4. Update display name, description, type, or currency
5. Save changes (applies to all users)

### Check Data Quality
1. Go to Data Quality tab
2. Optionally filter by symbol or date range
3. Click "Check Quality"
4. Review results sorted by data coverage

### Manual Data Fetch
1. Go to Manual Fetch tab
2. Enter symbol (e.g., AAPL)
3. Optionally enable "Force re-fetch"
4. Click "Fetch Data"
5. View results and ingested bar count

### Monitor FX Rates
1. Go to FX Rates tab
2. View overview stats
3. Optionally filter by base/quote currency
4. Check rate freshness status

## Future Enhancements

Potential additions:
- Bulk symbol operations
- Scheduled data refresh configuration
- Data quality alerting/notifications
- FX rate update triggers
- Export functionality for reports
- Symbol merge/delete operations
- Data retention policies
