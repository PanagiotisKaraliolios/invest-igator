# Mock Data Generation

This document describes the enhanced mock data generation script for the Invest-igator application.

## Overview

The `mock.ts` script generates realistic development data including users, transactions, watchlists, goals, API keys, sessions, and audit logs. It's designed to create meaningful test data that mimics real-world usage patterns.

## Quick Start

```bash
# Generate mock data with defaults (10 users)
bun run db:mock

# Generate more users
MOCK_USERS=50 bun run db:mock

# Disable certain features
MOCK_INCLUDE_ADMINS=false MOCK_INCLUDE_API_KEYS=false bun run db:mock
```

## Configuration Options

All configuration is done via environment variables:

### User Generation
- `MOCK_USERS` - Number of regular users to create (default: 10)
- `MOCK_INCLUDE_ADMINS` - Create admin/superadmin users (default: true)
- `MOCK_INCLUDE_API_KEYS` - Generate API keys for users (default: true)
- `MOCK_INCLUDE_SESSIONS` - Create active sessions (default: true)

### Data Volume
- `MOCK_TRANSACTIONS_MIN` - Minimum transactions per user (default: 15)
- `MOCK_TRANSACTIONS_MAX` - Maximum transactions per user (default: 80)
- `MOCK_WATCHLIST_MIN` - Minimum watchlist items per user (default: 3)
- `MOCK_WATCHLIST_MAX` - Maximum watchlist items per user (default: 20)
- `MOCK_GOALS_MIN` - Minimum goals per user (default: 1)
- `MOCK_GOALS_MAX` - Maximum goals per user (default: 4)

## User Profiles

The script generates users with different behavioral profiles:

### 1. Active Trader (25%)
- High transaction volume (64-80 transactions)
- Large watchlist (14-20 symbols)
- Frequent buying and selling
- More likely to have API keys and multiple sessions

### 2. Casual Investor (37.5%)
- Moderate transaction volume (22-48 transactions)
- Medium watchlist (3-12 symbols)
- Balanced buy/sell ratio
- Occasional API usage

### 3. Long-term Holder (25%)
- Low-moderate transactions (15-30 transactions)
- Small focused watchlist
- Mostly buy transactions (85%)
- Rarely sells positions

### 4. New User (12.5%)
- Very few transactions (4-15 transactions)
- Recent activity (last 3 months)
- Small watchlist (3-5 symbols)
- 1-2 goals maximum

## Generated Data

### Users
- Realistic names and emails (`firstname.lastname{N}@example.com`)
- Verified and unverified accounts (90% verified)
- Different themes (Light/Dark)
- Different base currencies (EUR, USD, GBP, HKD, CHF, RUB)
- 5% chance of banned status (for testing admin features)
- All users have password: `password123`

### Admin Users (if enabled)
- `superadmin@example.com` - Superadmin role
- `admin@example.com` - Regular admin role
- Both have password: `password123`
- Comes with 20 audit log entries

### Transactions
- Realistic date distribution (up to 2 years ago)
- Position building (buys followed by sells)
- Realistic prices based on symbol type
- Trading hours timestamps (9 AM - 4 PM)
- Percentage-based fees (0.1% - 1% of transaction value)
- Currency matching (UK stocks in GBP, others in user's currency)
- Occasional notes (15% of transactions)

### Watchlists
- Mix of owned stocks and potential investments
- 70% from user's actual transactions
- 30% new symbols being watched
- 25% starred items

### Goals
- Realistic goal templates:
  - Emergency Fund ($5K-$25K, 1 year)
  - House Down Payment ($30K-$100K, 3 years)
  - Retirement Savings ($500K-$2M, 10 years)
  - New Car Purchase ($15K-$50K, 2 years)
  - And more...
- Progress tracking (0-70% complete)
- Currency matching user's preference

### API Keys (30% of users)
- 1-3 keys per user
- Development keys with `sk_dev_` prefix
- Realistic rate limiting settings
- Various permission levels
- Some expired/disabled keys for testing

### Sessions (60% of users)
- 1-3 active sessions per user
- Realistic device information (iPhone, MacBook, etc.)
- IP addresses and locations
- User agents for different platforms
- 30-day expiration

## Symbol Coverage

The script includes 50+ symbols across:
- **Tech Giants**: AAPL, GOOGL, MSFT, META, AMZN, NVDA, TSLA, etc.
- **Finance**: JPM, BAC, GS, MS, V, MA, AXP, BLK
- **Healthcare**: JNJ, UNH, PFE, ABBV, LLY, MRK, TMO
- **Consumer**: WMT, HD, DIS, NKE, SBUX, MCD, COST, TGT
- **Energy & Industrial**: XOM, CVX, BA, CAT, GE, MMM
- **International/ETFs**: VUSA.L, VWRL.L, SPY, QQQ, VOO

## Safety Features

- **Production Guard**: Script refuses to run if `NODE_ENV=production`
- **Clean Slate**: Automatically deletes previous mock data before generating new
- **Email Scoping**: Only deletes users with `@example.com` emails
- **Type Safety**: Full TypeScript types from Prisma

## Examples

### Small Dataset for Quick Testing
```bash
MOCK_USERS=3 MOCK_TRANSACTIONS_MAX=20 bun run db:mock
```

### Large Dataset for Performance Testing
```bash
MOCK_USERS=100 MOCK_TRANSACTIONS_MAX=200 bun run db:mock
```

### Focus on Trading Activity
```bash
MOCK_USERS=20 MOCK_TRANSACTIONS_MIN=50 MOCK_TRANSACTIONS_MAX=150 bun run db:mock
```

### Minimal Dataset (Users Only)
```bash
MOCK_USERS=5 MOCK_TRANSACTIONS_MAX=10 MOCK_INCLUDE_ADMINS=false MOCK_INCLUDE_API_KEYS=false bun run db:mock
```

## Output

The script provides detailed progress information:

```
🌱 Starting enhanced mock data generation...
   - Cleaning up existing mock data...
   - Creating admin users...
   - Created superadmin and admin users with 20 audit log entries
   - Creating 10 mock users with realistic data...
   - [1/10] john.doe0@example.com (active_trader) - 72 txns, 18 watched, 3 goals
   - [2/10] jane.smith1@example.com (casual_investor) - 35 txns, 9 watched, 2 goals
   ...

✓ Mock data generation completed successfully!

📊 Summary:
   - Total users: 10 + 2 admins
   - All users can log in with password: password123
   - Superadmin: superadmin@example.com
   - Admin: admin@example.com
   - Transactions, watchlists, goals, API keys, sessions generated
```

## Database Studio

After generating mock data, you can explore it visually:

```bash
bun run db:studio
```

Then open http://localhost:5000 in your browser.

## Tips

1. **Start Small**: Begin with 5-10 users to understand the data structure
2. **Iterate**: Regenerate data as needed - the script is idempotent
3. **Profile Mix**: The weighted distribution ensures realistic user behavior
4. **Consistency**: Watchlists align with actual transactions for realism
5. **Testing**: Use different user profiles to test various application features

## Troubleshooting

### Script Fails with "NODE_ENV is production"
Make sure you're not running this in production! This script is for development only.

### No Data Generated
Check that your database connection is working:
```bash
bun run db:studio
```

### Type Errors
Run Prisma generate to ensure types are up to date:
```bash
bun run db:generate
```

### Out of Memory
Reduce `MOCK_USERS` or transaction counts if generating very large datasets.
