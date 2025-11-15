#!/usr/bin/env bun
/**
 * Development-only database seeder with enhanced mock data generation.
 *
 * Features:
 * - Creates realistic users with varied profiles (active traders, casual investors, new users)
 * - Generates transaction histories with realistic patterns (position building, profit-taking)
 * - Creates watchlists based on actual portfolio holdings
 * - Generates meaningful financial goals with realistic timelines
 * - Optionally creates admin users with audit logs
 * - Generates API keys with realistic usage patterns
 * - Creates sessions to simulate active users
 *
 * Usage:
 *   bun prisma/mock.ts
 *
 * Configuration:
 *   - MOCK_USERS: Number of users to create (default: 10)
 *   - MOCK_INCLUDE_ADMINS: Create admin/superadmin users (default: true)
 *   - MOCK_INCLUDE_API_KEYS: Generate API keys for some users (default: true)
 *   - MOCK_INCLUDE_SESSIONS: Create active sessions (default: true)
 *   - MOCK_TRANSACTIONS_MIN/MAX: Range for transactions per user (default: 15-80)
 *   - MOCK_WATCHLIST_MIN/MAX: Range for watchlist items per user (default: 3-20)
 *   - MOCK_GOALS_MIN/MAX: Range for goals per user (default: 1-4)
 */
import { faker } from '@faker-js/faker';
import type { Currency, TransactionSide } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { env } from '../src/env';
import { db } from '../src/server/db';

// --- Configuration ---
const MOCK_USERS = Number.parseInt(process.env.MOCK_USERS || '50', 10);
const MOCK_INCLUDE_ADMINS = process.env.MOCK_INCLUDE_ADMINS !== 'false';
const MOCK_INCLUDE_API_KEYS = process.env.MOCK_INCLUDE_API_KEYS !== 'false';
const MOCK_INCLUDE_SESSIONS = process.env.MOCK_INCLUDE_SESSIONS !== 'false';
const MOCK_TRANSACTIONS_MIN = Number.parseInt(process.env.MOCK_TRANSACTIONS_MIN || '30', 10);
const MOCK_TRANSACTIONS_MAX = Number.parseInt(process.env.MOCK_TRANSACTIONS_MAX || '200', 10);
const MOCK_WATCHLIST_MIN = Number.parseInt(process.env.MOCK_WATCHLIST_MIN || '5', 10);
const MOCK_WATCHLIST_MAX = Number.parseInt(process.env.MOCK_WATCHLIST_MAX || '35', 10);
const MOCK_GOALS_MIN = Number.parseInt(process.env.MOCK_GOALS_MIN || '2', 10);
const MOCK_GOALS_MAX = Number.parseInt(process.env.MOCK_GOALS_MAX || '8', 10);

// Expanded symbol list with more diversity
const SYMBOLS = [
	// Tech giants
	'AAPL',
	'GOOGL',
	'MSFT',
	'META',
	'AMZN',
	'NVDA',
	'TSLA',
	'NFLX',
	'AMD',
	'INTC',
	'ADBE',
	'CRM',
	'ORCL',
	'IBM',
	'CSCO',
	'QCOM',
	'TXN',
	'AVGO',
	// Finance
	'JPM',
	'BAC',
	'GS',
	'MS',
	'V',
	'MA',
	'AXP',
	'BLK',
	'C',
	'WFC',
	'SCHW',
	'USB',
	// Healthcare
	'JNJ',
	'UNH',
	'PFE',
	'ABBV',
	'LLY',
	'MRK',
	'TMO',
	'ABT',
	'DHR',
	'BMY',
	'AMGN',
	'GILD',
	// Consumer
	'WMT',
	'HD',
	'DIS',
	'NKE',
	'SBUX',
	'MCD',
	'COST',
	'TGT',
	'LOW',
	'TJX',
	'BKNG',
	'CMG',
	// Energy & Industrial
	'XOM',
	'CVX',
	'BA',
	'CAT',
	'GE',
	'MMM',
	'HON',
	'UNP',
	'UPS',
	'RTX',
	'LMT',
	'DE',
	// Retail & E-commerce
	'AMZN',
	'WMT',
	'HD',
	'EBAY',
	'ETSY',
	'SHOP',
	'SQ',
	// Automotive
	'TSLA',
	'F',
	'GM',
	'RIVN',
	'LCID',
	// International/ETFs
	'VUSA.L',
	'VWRL.L',
	'VUKE.L',
	'VEUR.L',
	'VFEM.L',
	'SPY',
	'QQQ',
	'VOO',
	'VTI',
	'IVV',
	// Crypto-related
	'COIN',
	'MSTR',
	'RIOT',
	'MARA',
	// Emerging sectors
	'PLTR',
	'SNOW',
	'CRWD',
	'NET',
	'ZS',
	'DDOG',
	'MDB'
];

const CURRENCIES: Currency[] = ['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB'];

// User profile types for realistic behavior patterns
type UserProfile = 'active_trader' | 'casual_investor' | 'new_user' | 'long_term_holder';

const GOAL_TEMPLATES = [
	{ maxAmount: 25000, minAmount: 5000, title: 'Emergency Fund', yearsAhead: 1 },
	{ maxAmount: 100000, minAmount: 30000, title: 'House Down Payment', yearsAhead: 3 },
	{ maxAmount: 2000000, minAmount: 500000, title: 'Retirement Savings', yearsAhead: 10 },
	{ maxAmount: 50000, minAmount: 15000, title: 'New Car Purchase', yearsAhead: 2 },
	{ maxAmount: 60000, minAmount: 20000, title: 'Wedding Fund', yearsAhead: 2 },
	{ maxAmount: 150000, minAmount: 40000, title: 'Education Fund', yearsAhead: 5 },
	{ maxAmount: 15000, minAmount: 3000, title: 'Vacation Savings', yearsAhead: 1 },
	{ maxAmount: 500000, minAmount: 100000, title: 'Investment Portfolio Growth', yearsAhead: 5 },
	{ maxAmount: 3000000, minAmount: 1000000, title: 'Early Retirement', yearsAhead: 15 },
	{ maxAmount: 80000, minAmount: 10000, title: 'Debt Payoff', yearsAhead: 3 }
];

const ADMIN_ACTIONS = [
	'VIEW_USERS',
	'VIEW_ANALYTICS',
	'EXPORT_DATA',
	'VIEW_AUDIT_LOG',
	'UPDATE_USER_ROLE',
	'BAN_USER',
	'UNBAN_USER',
	'DELETE_USER'
];

/**
 * Generate realistic transaction history for a user based on their profile
 */
function generateTransactions(
	userId: string,
	profile: UserProfile,
	userCurrency: Currency,
	userJoinDate: Date
): Array<{
	userId: string;
	date: Date;
	symbol: string;
	side: TransactionSide;
	quantity: number;
	price: number;
	priceCurrency: Currency;
	fee: number;
	feeCurrency: Currency;
	note?: string;
}> {
	const transactions = [];
	let numTransactions: number;

	// Profile-based transaction count
	switch (profile) {
		case 'active_trader':
			numTransactions = faker.number.int({ max: MOCK_TRANSACTIONS_MAX, min: MOCK_TRANSACTIONS_MAX * 0.8 });
			break;
		case 'casual_investor':
			numTransactions = faker.number.int({ max: MOCK_TRANSACTIONS_MAX * 0.6, min: MOCK_TRANSACTIONS_MIN * 1.5 });
			break;
		case 'new_user':
			numTransactions = faker.number.int({ max: MOCK_TRANSACTIONS_MIN, min: MOCK_TRANSACTIONS_MIN * 0.3 });
			break;
		case 'long_term_holder':
			numTransactions = faker.number.int({ max: MOCK_TRANSACTIONS_MIN * 2, min: MOCK_TRANSACTIONS_MIN });
			break;
	}

	// Choose a subset of symbols this user trades (realistic: not everyone trades everything)
	const userSymbols = faker.helpers.shuffle(SYMBOLS).slice(0, faker.number.int({ max: 15, min: 5 }));

	// Build positions over time
	const positions: Record<string, number> = {};

	// Calculate how many days since user joined
	const daysSinceJoin = Math.floor((Date.now() - userJoinDate.getTime()) / (1000 * 60 * 60 * 24));
	const maxDaysAgo = Math.max(1, daysSinceJoin);

	for (let i = 0; i < numTransactions; i++) {
		const symbol = faker.helpers.arrayElement(userSymbols);
		const currentPosition = positions[symbol] || 0;

		// Determine buy/sell based on position and profile
		let side: TransactionSide;
		if (currentPosition === 0) {
			side = 'BUY'; // Start a new position
		} else if (profile === 'active_trader' && faker.datatype.boolean({ probability: 0.4 })) {
			side = faker.helpers.arrayElement(['BUY', 'SELL']); // More frequent trading
		} else if (profile === 'long_term_holder') {
			side = faker.datatype.boolean({ probability: 0.85 }) ? 'BUY' : 'SELL'; // Mostly buying
		} else {
			side = faker.datatype.boolean({ probability: 0.6 }) ? 'BUY' : 'SELL';
		}

		// Generate realistic quantity
		const quantity =
			side === 'BUY'
				? faker.number.float({ fractionDigits: 2, max: 50, min: 1 })
				: Math.min(
						currentPosition,
						faker.number.float({ fractionDigits: 2, max: Math.max(1, currentPosition), min: 1 })
					);

		if (quantity <= 0 || (side === 'SELL' && quantity > currentPosition)) continue; // Skip invalid sells

		// Update position
		positions[symbol] = side === 'BUY' ? currentPosition + quantity : currentPosition - quantity;

		// Generate realistic date (after user joined, distributed over their membership period)
		const daysAgo = faker.number.int({ max: maxDaysAgo, min: 0 });
		const date = new Date(userJoinDate);
		date.setDate(date.getDate() + daysAgo);
		date.setHours(faker.number.int({ max: 16, min: 9 }), faker.number.int({ max: 59, min: 0 }), 0, 0);

		// Realistic price based on symbol
		const basePrice = symbol.includes('.L') ? 50 : 150; // London stocks typically cheaper
		const price = faker.number.float({ fractionDigits: 2, max: basePrice * 3, min: basePrice * 0.5 });

		// Currency based on symbol
		const priceCurrency = symbol.endsWith('.L') ? 'GBP' : userCurrency;

		// Realistic fees (percentage-based)
		const totalValue = quantity * price;
		const feeRate = faker.number.float({ fractionDigits: 4, max: 0.01, min: 0.001 }); // 0.1% to 1%
		const fee = Number((totalValue * feeRate).toFixed(2));

		// Occasional notes
		const note = faker.datatype.boolean({ probability: 0.15 })
			? faker.helpers.arrayElement([
					'Dollar cost averaging',
					'Taking profits',
					'Rebalancing portfolio',
					'Tax loss harvesting',
					'Adding to position',
					'Trimming position'
				])
			: undefined;

		transactions.push({
			date,
			fee,
			feeCurrency: priceCurrency,
			note,
			price,
			priceCurrency,
			quantity,
			side,
			symbol,
			userId
		});
	}

	// Sort by date (oldest first)
	transactions.sort((a, b) => a.date.getTime() - b.date.getTime());

	return transactions;
}

/**
 * Generate watchlist items based on user's transaction history
 */
function generateWatchlist(
	userId: string,
	userSymbols: string[],
	profile: UserProfile
): Array<{
	userId: string;
	symbol: string;
	starred: boolean;
	currency: Currency;
}> {
	const numItems =
		profile === 'active_trader'
			? faker.number.int({ max: MOCK_WATCHLIST_MAX, min: MOCK_WATCHLIST_MAX * 0.7 })
			: faker.number.int({ max: MOCK_WATCHLIST_MAX * 0.6, min: MOCK_WATCHLIST_MIN });

	// Include symbols from transactions plus some new ones
	const watchlistSymbols = [
		...faker.helpers.shuffle(userSymbols).slice(0, Math.min(userSymbols.length, numItems * 0.7)),
		...faker.helpers.shuffle(SYMBOLS.filter((s) => !userSymbols.includes(s))).slice(0, numItems * 0.3)
	].slice(0, numItems);

	return Array.from(new Set(watchlistSymbols)).map((symbol) => ({
		currency: symbol.endsWith('.L') ? 'GBP' : 'USD',
		starred: faker.datatype.boolean({ probability: 0.25 }),
		symbol,
		userId
	}));
}

/**
 * Generate realistic financial goals
 */
function generateGoals(userId: string, profile: UserProfile, userCurrency: Currency) {
	const numGoals =
		profile === 'new_user'
			? faker.number.int({ max: MOCK_GOALS_MIN + 1, min: MOCK_GOALS_MIN })
			: faker.number.int({ max: MOCK_GOALS_MAX, min: MOCK_GOALS_MIN });

	const goals = [];
	const selectedTemplates = faker.helpers.shuffle(GOAL_TEMPLATES).slice(0, numGoals);

	for (const template of selectedTemplates) {
		const targetAmount = faker.number.int({ max: template.maxAmount, min: template.minAmount });
		const targetDate = new Date();
		targetDate.setFullYear(targetDate.getFullYear() + template.yearsAhead);

		const note = faker.datatype.boolean({ probability: 0.4 }) ? faker.lorem.sentence() : undefined;

		goals.push({
			note,
			targetAmount,
			targetCurrency: userCurrency,
			targetDate,
			title: template.title,
			userId
		});
	}

	return goals;
}

/**
 * Generate API keys for a user
 */
async function generateApiKeys(userId: string, numKeys = 1) {
	const keys = [];

	for (let i = 0; i < numKeys; i++) {
		const rawKey = `sk_dev_${faker.string.alphanumeric({ length: 32 })}`;
		const pepper = env.PASSWORD_PEPPER ?? '';
		const hashedKey = await bcrypt.hash(`${rawKey}${pepper}`, 10);

		const enabled = faker.datatype.boolean({ probability: 0.85 });
		const rateLimitEnabled = faker.datatype.boolean({ probability: 0.6 });

		const expiresAt = faker.datatype.boolean({ probability: 0.3 }) ? faker.date.future({ years: 1 }) : null;

		keys.push({
			enabled,
			expiresAt,
			key: hashedKey,
			lastRefillAt: enabled ? faker.date.recent({ days: 7 }) : null,
			lastRequest: enabled ? faker.date.recent({ days: 3 }) : null,
			metadata: faker.datatype.boolean({ probability: 0.4 })
				? JSON.stringify({
						createdBy: faker.person.fullName(),
						environment: faker.helpers.arrayElement(['development', 'staging', 'production'])
					})
				: null,
			name: faker.helpers.arrayElement([
				'Production API Key',
				'Development Key',
				'Testing Key',
				'Mobile App Key',
				'Web Dashboard Key',
				null
			]),
			permissions: JSON.stringify({
				delete: faker.datatype.boolean({ probability: 0.3 }),
				read: true,
				write: faker.datatype.boolean({ probability: 0.7 })
			}),
			prefix: 'sk_dev_',
			rateLimitEnabled,
			rateLimitMax: rateLimitEnabled ? faker.number.int({ max: 100, min: 10 }) : null,
			rateLimitTimeWindow: rateLimitEnabled ? 60000 : null, // 1 minute
			refillAmount: rateLimitEnabled ? faker.number.int({ max: 1000, min: 100 }) : null,
			refillInterval: rateLimitEnabled ? 3600000 : null, // 1 hour
			remaining: faker.datatype.boolean({ probability: 0.5 }) ? faker.number.int({ max: 10000, min: 100 }) : null,
			requestCount: enabled ? faker.number.int({ max: 50, min: 0 }) : 0,
			start: rawKey.slice(0, 10),
			userId
		});
	}

	return keys;
}

/**
 * Generate active sessions for a user
 */
function generateSessions(userId: string, numSessions = 1) {
	const sessions = [];

	for (let i = 0; i < numSessions; i++) {
		const createdAt = faker.date.recent({ days: 30 });
		const expiresAt = new Date(createdAt);
		expiresAt.setDate(expiresAt.getDate() + 30);

		sessions.push({
			createdAt,
			device: faker.helpers.arrayElement([
				'iPhone 15 Pro',
				'MacBook Pro',
				'Windows Desktop',
				'Samsung Galaxy S24',
				'iPad Pro',
				null
			]),
			expiresAt,
			ipAddress: faker.internet.ipv4(),
			location: faker.location.city() + ', ' + faker.location.country(),
			token: faker.string.alphanumeric({ length: 64 }),
			userAgent: faker.helpers.arrayElement([
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
				'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148',
				'Mozilla/5.0 (Linux; Android 13) Chrome/120.0.0.0 Mobile'
			]),
			userId
		});
	}

	return sessions;
}

async function generateMockData() {
	console.log('🌱 Starting enhanced mock data generation...');

	if (process.env.NODE_ENV === 'production') {
		console.error('❌ This script is for development only and should not be run in production.');
		process.exit(1);
	}

	try {
		console.log('   - Cleaning up existing mock data...');
		await db.user.deleteMany({ where: { email: { endsWith: '@example.com' } } });

		const pepper = env.PASSWORD_PEPPER ?? '';
		const passwordHash = await bcrypt.hash(`password123${pepper}`, 12);

		// Create admin users if requested
		let adminUser = null;
		let superadminUser = null;

		if (MOCK_INCLUDE_ADMINS) {
			console.log('   - Creating admin users...');

			superadminUser = await db.user.create({
				data: {
					currency: 'USD',
					email: 'superadmin@example.com',
					emailVerified: true,
					emailVerifiedAt: new Date(),
					name: 'Super Admin',
					role: 'superadmin',
					theme: 'DARK'
				}
			});

			await db.account.create({
				data: {
					accountId: superadminUser.id,
					password: passwordHash,
					providerId: 'credential',
					userId: superadminUser.id
				}
			});

			adminUser = await db.user.create({
				data: {
					currency: 'USD',
					email: 'admin@example.com',
					emailVerified: true,
					emailVerifiedAt: new Date(),
					name: 'Regular Admin',
					role: 'admin',
					theme: 'LIGHT'
				}
			});

			await db.account.create({
				data: {
					accountId: adminUser.id,
					password: passwordHash,
					providerId: 'credential',
					userId: adminUser.id
				}
			});

			// Generate some audit log entries
			const targetUserIds: string[] = [];
			const auditLogs = [];

			for (let i = 0; i < 50; i++) {
				const action = faker.helpers.arrayElement(ADMIN_ACTIONS);
				const adminId = faker.helpers.arrayElement([superadminUser.id, adminUser.id]);
				const adminEmail = adminId === superadminUser.id ? superadminUser.email! : adminUser.email!;

				auditLogs.push({
					action,
					adminEmail,
					adminId,
					createdAt: faker.date.recent({ days: 30 }),
					details: JSON.stringify({
						newValue: faker.lorem.word(),
						oldValue: faker.lorem.word(),
						reason: faker.lorem.sentence()
					}),
					ipAddress: faker.internet.ipv4(),
					targetEmail: action.includes('USER') && targetUserIds.length > 0 ? faker.internet.email() : null,
					targetId:
						action.includes('USER') && targetUserIds.length > 0
							? faker.helpers.arrayElement(targetUserIds)
							: null,
					userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
				});
			}

			await db.auditLog.createMany({ data: auditLogs });
			console.log(`   - Created superadmin and admin users with ${auditLogs.length} audit log entries`);
		}

		console.log(`   - Creating ${MOCK_USERS} mock users with realistic data...`);

		for (let i = 0; i < MOCK_USERS; i++) {
			// Assign user profile
			const profile: UserProfile = faker.helpers.weightedArrayElement([
				{ value: 'casual_investor' as const, weight: 3 },
				{ value: 'active_trader' as const, weight: 2 },
				{ value: 'long_term_holder' as const, weight: 2 },
				{ value: 'new_user' as const, weight: 1 }
			]);

			const firstName = faker.person.firstName();
			const lastName = faker.person.lastName();
			const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`;
			const userCurrency = faker.helpers.arrayElement(CURRENCIES);

			// Assign realistic join dates based on profile
			let joinDate: Date;
			switch (profile) {
				case 'new_user':
					// Joined in the last 3 months
					joinDate = faker.date.recent({ days: 90 });
					break;
				case 'casual_investor':
					// Joined 3 months to 2 years ago
					joinDate = faker.date.past({ refDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), years: 2 });
					break;
				case 'active_trader':
					// Joined 6 months to 3 years ago (more established)
					joinDate = faker.date.past({ refDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000), years: 3 });
					break;
				case 'long_term_holder':
					// Joined 1 to 5 years ago (long-time users)
					joinDate = faker.date.past({ refDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), years: 5 });
					break;
			}

			const emailVerified = faker.datatype.boolean({ probability: 0.9 });
			const emailVerifiedAt = emailVerified
				? new Date(joinDate.getTime() + faker.number.int({ max: 7 * 24 * 60 * 60 * 1000, min: 0 }))
				: null;

			const user = await db.user.create({
				data: {
					banExpires: faker.datatype.boolean({ probability: 0.05 }) ? faker.date.future({ years: 1 }) : null,
					banned: faker.datatype.boolean({ probability: 0.05 }), // 5% banned users
					banReason: faker.datatype.boolean({ probability: 0.05 }) ? 'Terms of service violation' : null,
					createdAt: joinDate,
					currency: userCurrency,
					email,
					emailVerified,
					emailVerifiedAt,
					name: `${firstName} ${lastName}`,
					role: 'user',
					theme: faker.helpers.arrayElement(['LIGHT', 'DARK']),
					updatedAt: joinDate
				}
			});

			// Create credential account
			await db.account.create({
				data: {
					accountId: user.id,
					password: passwordHash,
					providerId: 'credential',
					userId: user.id
				}
			});

			// Generate transactions
			const transactions = generateTransactions(user.id, profile, userCurrency, joinDate);
			if (transactions.length > 0) {
				await db.transaction.createMany({ data: transactions });
			} // Extract unique symbols from transactions
			const userSymbols = Array.from(new Set(transactions.map((t) => t.symbol)));

			// Generate watchlist
			const watchlistItems = generateWatchlist(user.id, userSymbols, profile);
			if (watchlistItems.length > 0) {
				await db.watchlistItem.createMany({ data: watchlistItems });
			}

			// Generate goals
			const goals = generateGoals(user.id, profile, userCurrency);
			if (goals.length > 0) {
				await db.goal.createMany({ data: goals });
			}

			// Generate API keys for some users
			if (MOCK_INCLUDE_API_KEYS && faker.datatype.boolean({ probability: 0.5 })) {
				const numKeys = faker.number.int({ max: 4, min: 1 });
				const apiKeys = await generateApiKeys(user.id, numKeys);
				await db.apiKey.createMany({ data: apiKeys });
			}

			// Generate active sessions for some users
			if (MOCK_INCLUDE_SESSIONS && faker.datatype.boolean({ probability: 0.75 })) {
				const numSessions = faker.number.int({ max: 5, min: 1 });
				const sessions = generateSessions(user.id, numSessions);
				await db.session.createMany({ data: sessions });
			}

			console.log(
				`   - [${i + 1}/${MOCK_USERS}] ${email} (${profile}) - ` +
					`${transactions.length} txns, ${watchlistItems.length} watched, ${goals.length} goals`
			);
		}

		console.log('\n✓ Mock data generation completed successfully!');
		console.log('\n📊 Summary:');
		console.log(`   - Total users: ${MOCK_USERS}${MOCK_INCLUDE_ADMINS ? ' + 2 admins' : ''}`);
		console.log('   - All users can log in with password: password123');
		if (MOCK_INCLUDE_ADMINS) {
			console.log('   - Superadmin: superadmin@example.com');
			console.log('   - Admin: admin@example.com');
		}
		console.log(
			`   - Transactions, watchlists, goals, ${MOCK_INCLUDE_API_KEYS ? 'API keys, ' : ''}${MOCK_INCLUDE_SESSIONS ? 'sessions' : ''} generated`
		);
	} catch (error) {
		console.error('❌ Error generating mock data:', error);
		throw error;
	} finally {
		await db.$disconnect();
	}
}

generateMockData().catch((e) => {
	console.error(e);
	process.exit(1);
});
