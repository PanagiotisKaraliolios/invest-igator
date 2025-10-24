import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

/**
 * Generate OpenAPI path items for tRPC procedures.
 * For now, we cover the Account router comprehensively.
 * NOTE: tRPC over HTTP typically uses a single POST endpoint per procedure path
 * (e.g., /api/trpc/account.getMe). Inputs are represented as JSON bodies.
 */
function generateTRPCPaths() {
	// Helpers
	const okResponse = {
		properties: { ok: { enum: [true], type: 'boolean' } },
		required: ['ok'],
		type: 'object'
	} as const;

	const standardErrors: Record<string, any> = {
		'400': {
			content: {
				'application/json': {
					schema: {
						properties: {
							error: { type: 'string' },
							message: { type: 'string' }
						},
						required: ['error'],
						type: 'object'
					}
				}
			},
			description: 'Bad Request'
		},
		'401': {
			content: {
				'application/json': {
					schema: {
						properties: {
							error: { type: 'string' },
							message: { type: 'string' }
						},
						required: ['error'],
						type: 'object'
					}
				}
			},
			description: 'Unauthorized'
		},
		'404': {
			content: {
				'application/json': {
					schema: {
						properties: {
							error: { type: 'string' },
							message: { type: 'string' }
						},
						required: ['error'],
						type: 'object'
					}
				}
			},
			description: 'Not Found'
		},
		'409': {
			content: {
				'application/json': {
					schema: {
						properties: {
							error: { type: 'string' },
							message: { type: 'string' }
						},
						required: ['error'],
						type: 'object'
					}
				}
			},
			description: 'Conflict'
		},
		'500': {
			content: {
				'application/json': {
					schema: {
						properties: {
							error: { type: 'string' },
							message: { type: 'string' }
						},
						required: ['error'],
						type: 'object'
					}
				}
			},
			description: 'Internal Server Error'
		}
	};

	const postOp = (op: {
		summary: string;
		description?: string;
		requestSchema?: any;
		responseSchema?: any;
		tags?: string[];
		security?: any[];
	}) => ({
		post: {
			description: op.description,
			summary: op.summary,
			tags: op.tags ?? ['Account'],
			...(op.security ? { security: op.security } : {}),
			...(op.requestSchema
				? {
						requestBody: {
							content: {
								'application/json': {
									schema: op.requestSchema
								}
							},
							required: true
						}
					}
				: {}),
			responses: {
				'200': {
					content: {
						'application/json': {
							schema: op.responseSchema ?? { type: 'object' }
						}
					},
					description: 'Successful response'
				},
				...standardErrors
			}
		}
	});

	// Account router endpoints
	const accountPaths: Record<string, any> = {
		'/api/trpc/account.cancelTwoFactorSetup': postOp({
			description: 'Cancels a pending 2FA setup if not yet enabled. Deletes any pending TwoFactor records.',
			responseSchema: okResponse,
			summary: 'Cancel in-progress two-factor setup'
		}),
		'/api/trpc/account.changePassword': postOp({
			description: 'Change the current user password (credential accounts only).',
			requestSchema: {
				properties: {
					currentPassword: { minLength: 1, type: 'string' },
					newPassword: { maxLength: 200, minLength: 8, type: 'string' }
				},
				required: ['currentPassword', 'newPassword'],
				type: 'object'
			},
			responseSchema: okResponse,
			summary: 'Change password'
		}),
		'/api/trpc/account.confirmEmailChange': postOp({
			description: 'Confirm an email change using a verification token.',
			requestSchema: {
				properties: { token: { minLength: 10, type: 'string' } },
				required: ['token'],
				type: 'object'
			},
			responseSchema: okResponse,
			summary: 'Confirm email change'
		}),
		'/api/trpc/account.deleteAccount': postOp({
			description: 'Permanently delete the user account and all associated data.',
			requestSchema: {
				properties: { confirm: { enum: [true], type: 'boolean' } },
				required: ['confirm'],
				type: 'object'
			},
			responseSchema: okResponse,
			summary: 'Delete account'
		}),
		'/api/trpc/account.disconnectOAuthAccount': postOp({
			description: 'Disconnect a linked OAuth provider account. Prevents removing the last auth method.',
			requestSchema: {
				properties: { accountId: { minLength: 1, type: 'string' } },
				required: ['accountId'],
				type: 'object'
			},
			responseSchema: okResponse,
			summary: 'Disconnect OAuth account'
		}),
		'/api/trpc/account.getMe': postOp({
			description: 'Retrieve the current user profile information including email, avatar, and password status.',
			responseSchema: {
				properties: {
					avatar: { nullable: true, type: 'string' },
					email: { type: 'string' },
					emailVerified: { type: 'boolean' },
					hasPassword: { type: 'boolean' },
					id: { type: 'string' },
					name: { type: 'string' }
				},
				required: ['id', 'email', 'name', 'emailVerified', 'hasPassword'],
				type: 'object'
			},
			summary: 'Get current user profile'
		}),
		'/api/trpc/account.getTwoFactorState': postOp({
			description: 'Retrieve the user two-factor authentication state.',
			responseSchema: {
				properties: {
					confirmedAt: { format: 'date-time', nullable: true, type: 'string' },
					enabled: { type: 'boolean' },
					hasPassword: { type: 'boolean' },
					hasSecret: { type: 'boolean' },
					pending: { type: 'boolean' },
					recoveryCodesRemaining: { type: 'number' }
				},
				required: ['enabled', 'pending', 'hasSecret', 'hasPassword', 'recoveryCodesRemaining'],
				type: 'object'
			},
			summary: 'Get two-factor state'
		}),
		'/api/trpc/account.listOAuthAccounts': postOp({
			description: 'List all connected OAuth provider accounts for the current user.',
			responseSchema: {
				items: {
					properties: {
						accountId: { type: 'string' },
						id: { type: 'string' },
						providerId: { type: 'string' }
					},
					required: ['id', 'providerId', 'accountId'],
					type: 'object'
				},
				type: 'array'
			},
			summary: 'List connected OAuth accounts'
		}),
		'/api/trpc/account.requestEmailChange': postOp({
			description:
				'Initiate an email change for the current user. If a password is set, current password is required.',
			requestSchema: {
				properties: {
					currentPassword: { type: 'string' },
					newEmail: { format: 'email', type: 'string' }
				},
				required: ['newEmail'],
				type: 'object'
			},
			responseSchema: okResponse,
			summary: 'Request email change'
		}),
		'/api/trpc/account.requestEmailVerification': postOp({
			description:
				'Send an email verification link. Prefer Better Auth native verification for new implementations.',
			responseSchema: okResponse,
			summary: 'Request email verification (deprecated)'
		}),
		'/api/trpc/account.setPassword': postOp({
			description: 'Set a password for an account that does not yet have one (e.g., OAuth-only users).',
			requestSchema: {
				properties: { newPassword: { maxLength: 200, minLength: 8, type: 'string' } },
				required: ['newPassword'],
				type: 'object'
			},
			responseSchema: okResponse,
			summary: 'Set password (OAuth users)'
		}),
		'/api/trpc/account.updateProfile': postOp({
			description: 'Update the user profile (name and avatar). Empty string for image removes the avatar.',
			requestSchema: {
				properties: {
					image: {
						oneOf: [
							{ format: 'uri', type: 'string' },
							{ enum: [''], type: 'string' }
						]
					},
					name: { maxLength: 100, minLength: 1, type: 'string' }
				},
				required: ['name'],
				type: 'object'
			},
			responseSchema: okResponse,
			summary: 'Update profile'
		}),
		'/api/trpc/account.uploadProfilePicture': postOp({
			description: 'Upload a profile picture from a data URL. Server compresses and resizes to 512x512 JPEG.',
			requestSchema: {
				properties: {
					dataUrl: {
						pattern: '^data:image\\/(png|jpeg|jpg|gif|webp);base64,',
						type: 'string'
					}
				},
				required: ['dataUrl'],
				type: 'object'
			},
			responseSchema: {
				properties: { url: { format: 'uri', type: 'string' } },
				required: ['url'],
				type: 'object'
			},
			summary: 'Upload profile picture'
		})
	};

	// Auth router endpoints (public)
	const authPaths: Record<string, any> = {
		'/api/trpc/auth.checkEmail': postOp({
			description: 'Check whether a user with the given email exists (always safe to call).',
			requestSchema: { format: 'email', type: 'string' },
			responseSchema: {
				properties: { exists: { type: 'boolean' } },
				required: ['exists'],
				type: 'object'
			},
			summary: 'Check if email exists',
			tags: ['Auth']
		}),
		'/api/trpc/auth.requestPasswordReset': postOp({
			description: 'Send a password reset email if the account exists. Always returns ok to prevent enumeration.',
			requestSchema: {
				properties: { email: { format: 'email', type: 'string' } },
				required: ['email'],
				type: 'object'
			},
			responseSchema: okResponse,
			summary: 'Request password reset',
			tags: ['Auth']
		}),
		'/api/trpc/auth.resetPassword': postOp({
			description: "Reset a user's password using a valid token. Validates token type and expiration.",
			requestSchema: {
				properties: {
					password: { maxLength: 200, minLength: 8, type: 'string' },
					token: { minLength: 10, type: 'string' }
				},
				required: ['token', 'password'],
				type: 'object'
			},
			responseSchema: okResponse,
			summary: 'Reset password',
			tags: ['Auth']
		}),
		'/api/trpc/auth.signup': postOp({
			description: 'Create a new user account with email and password. confirmPassword is accepted but ignored.',
			requestSchema: {
				properties: {
					confirmPassword: { type: 'string' },
					email: { format: 'email', type: 'string' },
					name: { minLength: 1, type: 'string' },
					password: { minLength: 1, type: 'string' }
				},
				required: ['email', 'name', 'password'],
				type: 'object'
			},
			responseSchema: okResponse,
			summary: 'Sign up',
			tags: ['Auth']
		})
	};

	// Currency router endpoints (protected)
	const currencyEnum = ['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB'] as const;
	const currencyPaths: Record<string, any> = {
		'/api/trpc/currency.getCurrency': postOp({
			description: "Retrieve the user's preferred currency.",
			responseSchema: {
				properties: {
					currency: { enum: [...currencyEnum], nullable: true, type: 'string' }
				},
				required: ['currency'],
				type: 'object'
			},
			summary: 'Get preferred currency',
			tags: ['Currency']
		}),
		'/api/trpc/currency.setCurrency': postOp({
			description: "Set the user's preferred currency. Also mirrored to cookie for SSR rendering.",
			requestSchema: { enum: [...currencyEnum], type: 'string' },
			responseSchema: okResponse,
			summary: 'Set preferred currency',
			tags: ['Currency']
		})
	};

	return {
		...accountPaths,
		...authPaths,
		...currencyPaths
	};
}

/**
 * API Documentation endpoint that serves a unified OpenAPI schema
 * combining Better Auth endpoints with comprehensive tRPC endpoint descriptions
 */
export async function GET(request: NextRequest) {
	try {
		// Generate Better Auth OpenAPI schema
		const betterAuthSchema = await auth.api.generateOpenAPISchema();

		// Create a combined OpenAPI schema that includes Better Auth
		// and fully documents all tRPC endpoints
		const unifiedSchema = {
			...betterAuthSchema,
			info: {
				...betterAuthSchema.info,
				contact: {
					name: 'Invest-igator Support',
					url: 'https://github.com/PanagiotisKaraliolios/invest-igator'
				},
				description:
					'Unified API documentation for Invest-igator. Includes Better Auth endpoints for authentication and comprehensive tRPC endpoints for application functionality including portfolio tracking, watchlist management, transaction handling, and more.',
				title: 'Invest-igator API Documentation',
				version: '1.0.0'
			},
			paths: {
				...betterAuthSchema.paths,
				// tRPC endpoints - organized by router
				...generateTRPCPaths()
			},
			// Add tRPC routers as tags
			tags: [
				...(betterAuthSchema.tags || []),
				{
					description: 'Type-safe RPC endpoints using tRPC. Use @/trpc/react for client-side calls.',
					name: 'tRPC'
				},
				{
					description: 'User account settings, profile, password management, 2FA, and OAuth connections',
					name: 'Account'
				},
				{
					description: 'Authentication - signup, login, password reset',
					name: 'Auth'
				},
				{
					description: 'User currency preference management',
					name: 'Currency'
				},
				{
					description: 'Foreign exchange rates and conversion',
					name: 'FX'
				},
				{
					description: 'Financial goals tracking and management',
					name: 'Goals'
				},
				{
					description: 'Portfolio analytics, holdings, and performance metrics (TWR/MWR)',
					name: 'Portfolio'
				},
				{
					description: 'User theme (light/dark mode) preferences',
					name: 'Theme'
				},
				{
					description: 'Investment transaction management with CSV import/export',
					name: 'Transactions'
				},
				{
					description: 'Watchlist management with market data and corporate events',
					name: 'Watchlist'
				}
			]
		};

		return NextResponse.json(unifiedSchema);
	} catch (error) {
		console.error('Error generating API documentation:', error);
		return NextResponse.json(
			{
				error: 'Failed to generate API documentation',
				message: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
}
