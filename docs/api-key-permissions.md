# API Key Permissions System

## Overview

The API key permissions system provides granular access control for API keys. Each key can be configured with specific permissions that control which resources and actions it can access.

## Permission Structure

Permissions are organized by **scope** (resource type) and **actions** (what can be done):

```typescript
{
  "watchlist": ["read", "write", "delete"],
  "portfolio": ["read", "write"],
  "transactions": ["read"]
}
```

### Available Scopes

- `account` - Account management (read, write, delete)
- `admin` - Admin operations (read, write) - requires admin role
- `apiKeys` - API key management (read, write, delete)
- `fx` - Foreign exchange rates (read)
- `goals` - Financial goals (read, write, delete)
- `portfolio` - Portfolio data (read, write)
- `transactions` - Transaction records (read, write, delete)
- `watchlist` - Watchlist management (read, write, delete)

### Scope Actions by Router

| Scope | Read Operations | Write Operations | Delete Operations |
|-------|----------------|------------------|-------------------|
| `account` | getMe, getTwoFactorState, listOAuthAccounts | updateProfile, uploadProfilePicture, setPassword, changePassword, requestEmailChange, confirmEmailChange, requestEmailVerification, cancelTwoFactorSetup, disconnectOAuthAccount | deleteAccount |
| `apiKeys` | list, get, verify | create, update | delete, deleteExpired |
| `fx` | matrix | N/A | N/A |
| `watchlist` | list, history, events, search | add, toggleStar | remove |
| `portfolio` | *Coming soon* | *Coming soon* | N/A |
| `transactions` | *Coming soon* | *Coming soon* | *Coming soon* |
| `goals` | *Coming soon* | *Coming soon* | *Coming soon* |
| `admin` | *Coming soon* | *Coming soon* | N/A |

## Permission Templates

Pre-configured templates for common use cases:

### Read-Only

Read access to all resources.

```json
{
  "account": ["read"],
  "fx": ["read"],
  "goals": ["read"],
  "portfolio": ["read"],
  "transactions": ["read"],
  "watchlist": ["read"]
}
```

### Full Access

Full access to all non-admin resources.

```json
{
  "account": ["read", "write", "delete"],
  "apiKeys": ["read", "write", "delete"],
  "fx": ["read"],
  "goals": ["read", "write", "delete"],
  "portfolio": ["read", "write"],
  "transactions": ["read", "write", "delete"],
  "watchlist": ["read", "write", "delete"]
}
```

### Portfolio Manager

Manage portfolio, transactions, and watchlist. View FX rates. No account management.

```json
{
  "fx": ["read"],
  "portfolio": ["read", "write"],
  "transactions": ["read", "write", "delete"],
  "watchlist": ["read", "write", "delete"]
}
```

### Custom

Build your own permission set with granular control.

## Usage in tRPC Procedures

### Method 1: Using `withPermissions` helper

```typescript
import { withPermissions } from '@/server/api/trpc';

export const myRouter = createTRPCRouter({
  list: withPermissions('watchlist', 'read')
    .query(async ({ ctx }) => {
      // This will only run if the API key has watchlist:read permission
      // Regular sessions (non-API key) bypass permission checks
      return ctx.db.watchlistItem.findMany({
        where: { userId: ctx.session.user.id }
      });
    }),

  create: withPermissions('watchlist', 'write')
    .input(z.object({ symbol: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Requires watchlist:write permission
      return ctx.db.watchlistItem.create({
        data: {
          symbol: input.symbol,
          userId: ctx.session.user.id
        }
      });
    }),

  delete: withPermissions('watchlist', 'delete')
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Requires watchlist:delete permission
      return ctx.db.watchlistItem.delete({
        where: { id: input.id, userId: ctx.session.user.id }
      });
    })
});
```

### Method 2: Manual permission checking

```typescript
import { protectedProcedure } from '@/server/api/trpc';
import { TRPCError } from '@trpc/server';

export const myRouter = createTRPCRouter({
  sensitiveOperation: protectedProcedure
    .mutation(async ({ ctx }) => {
      // Check if using API key and if it has permission
      if (ctx.apiKeyPermissions) {
        const hasPermission = ctx.apiKeyPermissions.portfolio?.includes('write');
        
        if (!hasPermission) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'API key does not have permission: portfolio:write'
          });
        }
      }

      // Proceed with operation
      return doSensitiveOperation();
    })
});
```

## Important Notes

1. **Regular sessions bypass permissions** - API key permissions only apply when authenticated via `x-api-key` header. Users logged in normally have full access to their own resources.

2. **Permission format** - Permissions are stored as JSON in the database:

   ```json
   {"watchlist": ["read", "write"], "portfolio": ["read"]}
   ```

3. **Null permissions** - If an API key has `null` permissions, it has no access to any protected resources.

4. **Action granularity** - Common actions:
   - `read` - List, get, query operations
   - `write` - Create, update operations  
   - `delete` - Delete operations

5. **Context availability** - `ctx.apiKeyPermissions` is available in all `protectedProcedure` and `withPermissions` procedures.

## Migration Guide for Existing Routers

To add permission checking to an existing router:

```typescript
// Before
export const watchlistRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    // ...
  })
});

// After
export const watchlistRouter = createTRPCRouter({
  list: withPermissions('watchlist', 'read').query(async ({ ctx }) => {
    // ...
  })
});
```

Replace `protectedProcedure` with `withPermissions(scope, action)` for each procedure that should enforce API key permissions.
