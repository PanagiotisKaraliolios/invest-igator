# API Security Documentation

This document outlines the security measures implemented in the invest-igator API and provides guidelines for maintaining security.

## Overview

The invest-igator API is built using tRPC v11 with comprehensive security measures including:
- Input validation and sanitization
- Authentication and authorization via Better Auth
- API key-based access with fine-grained permissions
- Rate limiting and quota management
- Audit logging for administrative actions

## Security Fixes Applied (November 2024)

### 1. Flux Injection Prevention (Critical)

**Issue**: User input was being directly interpolated into InfluxDB Flux queries without proper escaping, allowing potential injection attacks.

**Fix**: 
- Added `escapeFluxString()` helper function to properly escape double quotes and backslashes
- Added `isValidSymbol()` validator to restrict symbol characters to alphanumeric, dots, hyphens, underscores, and carets
- Applied validation and escaping to all Flux queries in the watchlist router

**Affected Procedures**:
- `watchlist.events` - Historical corporate events (dividends, splits, capital gains)
- `watchlist.history` - Historical price data queries
- `watchlist.add`, `watchlist.remove`, `watchlist.toggleStar` - Symbol mutations

**Example**:
```typescript
// Before (vulnerable)
const flux = `... r.symbol == "${sym}"`;

// After (secure)
if (!isValidSymbol(sym)) {
  throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid symbol format' });
}
const escapedSym = escapeFluxString(sym);
const flux = `... r.symbol == "${escapedSym}"`;
```

### 2. Enhanced Input Validation

**Issue**: Insufficient validation on user inputs could lead to:
- Database query abuse
- Denial of service via large payloads
- Injection attacks via malformed IDs

**Fix**: Added comprehensive validation across all routers:

#### Admin Router
- UUID validation for all `userId` parameters
- Max length constraints: `searchValue` (200), `banReason` (500), `action` (100)

#### Watchlist Router
- Symbol max length: 20 characters
- Days parameter capped to 7300 (20 years) to prevent DoS
- Symbol format validation before database operations

#### Transactions Router
- UUID validation for all transaction IDs
- Max length for notes: 1000 characters
- Max length for symbols: 20 characters
- Bulk delete limited to 100 IDs per request

#### Goals Router
- UUID validation for all goal IDs
- Max lengths: `title` (200), `note` (1000), `targetDate` (10)

### 3. API Key Security Improvements

**Issue**: 
- Race condition in the verify procedure could lead to incorrect request counting
- Refill logic checked remaining count before performing refills

**Fix**:
- Implemented atomic updates for usage statistics
- Fixed refill logic to update counts before validation
- Improved transaction handling to prevent double-counting

**Before**:
```typescript
// Check remaining
if (apiKey.remaining <= 0) { return error; }

// Later: refill if due
if (isRefillDue(...)) {
  await update({ remaining: apiKey.remaining + refillAmount });
}
```

**After**:
```typescript
// Refill first if due
let currentRemaining = apiKey.remaining;
if (isRefillDue(...)) {
  currentRemaining = currentRemaining + (apiKey.refillAmount ?? 0);
}

// Then check
if (currentRemaining <= 0) { return error; }

// Atomic update in single query
await ctx.db.apiKey.update({
  data: {
    remaining: shouldRefill 
      ? currentRemaining + refillAmount - 1 
      : currentRemaining - 1,
    // ... other fields
  },
  where: { id: apiKey.id }
});
```

## Security Features

### Authentication & Authorization

1. **Session-based Authentication**
   - Better Auth with JWT sessions
   - Secure cookie handling with httpOnly flag
   - CSRF protection via same-site cookies

2. **API Key Authentication**
   - SHA-256 hashed keys stored in database
   - Support for expiration dates
   - Fine-grained permission system
   - Rate limiting per key

3. **Role-based Access Control**
   - Three roles: `user`, `admin`, `superadmin`
   - Admin procedures protected by middleware
   - Audit logging for admin actions

### Input Validation

All API procedures use Zod schemas for type-safe validation:

```typescript
// Example: Strong validation for symbol input
symbol: z.string()
  .min(1)
  .max(20)
  .refine(isValidSymbol, { 
    message: 'Invalid symbol format' 
  })
```

### Rate Limiting

API keys support two rate limiting strategies:

1. **Fixed Window**: Resets after time window expires
2. **Token Bucket**: Gradual refill at configured intervals

Configuration per API key:
- `rateLimitMax`: Maximum requests in window
- `rateLimitTimeWindow`: Window duration in milliseconds
- `refillAmount`: Tokens to add per refill (optional)
- `refillInterval`: Refill period in milliseconds (optional)

### Permission System

API keys can have scoped permissions:

```json
{
  "watchlist": ["read", "write", "delete"],
  "portfolio": ["read"],
  "transactions": ["read", "write"]
}
```

The `withPermissions()` middleware enforces these:

```typescript
export const procedure = withPermissions('watchlist', 'write')
  .input(...)
  .mutation(async ({ ctx, input }) => { ... });
```

## Best Practices

### For Developers

1. **Always validate user input**
   ```typescript
   .input(z.object({
     id: z.string().uuid(),           // Validate format
     name: z.string().min(1).max(200), // Set bounds
     amount: z.number().positive()     // Validate range
   }))
   ```

2. **Use parameterized queries**
   - For Prisma: Always use the query builder, never string interpolation
   - For InfluxDB: Use `escapeFluxString()` for any user-provided values

3. **Implement proper authorization checks**
   ```typescript
   // Verify ownership before operations
   const resource = await ctx.db.resource.findUnique({
     where: { id: input.id }
   });
   if (!resource || resource.userId !== ctx.session.user.id) {
     throw new TRPCError({ code: 'NOT_FOUND' });
   }
   ```

4. **Handle sensitive errors carefully**
   ```typescript
   // Bad: Leaks information
   throw new Error(`User ${email} not found in database table users`);
   
   // Good: Generic message
   throw new TRPCError({ 
     code: 'NOT_FOUND', 
     message: 'Resource not found' 
   });
   ```

5. **Log security events**
   ```typescript
   // For admin actions
   await ctx.db.auditLog.create({
     data: {
       action: 'DELETE_USER',
       adminId: ctx.session.user.id,
       targetId: input.userId,
       details: JSON.stringify({ reason: input.reason })
     }
   });
   ```

### For API Consumers

1. **Protect API keys**
   - Never commit keys to version control
   - Use environment variables
   - Rotate keys regularly
   - Use minimal permissions needed

2. **Handle rate limits gracefully**
   ```typescript
   try {
     await api.procedure.mutate(data);
   } catch (error) {
     if (error.code === 'TOO_MANY_REQUESTS') {
       // Parse reset time and retry after
       const resetTime = parseResetTime(error.message);
       await sleep(resetTime);
       // Retry request
     }
   }
   ```

3. **Use HTTPS in production**
   - API keys and sessions sent over encrypted connections only
   - Set `BETTER_AUTH_URL` to `https://` in production

## Security Checklist for New Features

When adding new API procedures:

- [ ] Input validation with Zod schemas
- [ ] UUID validation for all ID parameters
- [ ] Max length constraints on strings
- [ ] Range validation on numbers
- [ ] Authorization checks (ownership verification)
- [ ] Proper error messages (no information leakage)
- [ ] Rate limiting consideration
- [ ] Audit logging for sensitive operations
- [ ] SQL/NoSQL injection prevention
- [ ] XSS prevention (if rendering user content)

## Threat Model

### Threats Mitigated

1. **Injection Attacks**
   - SQL Injection: ✅ Mitigated via Prisma ORM
   - Flux Injection: ✅ Mitigated via escaping and validation
   - NoSQL Injection: N/A (not using NoSQL)

2. **Authentication/Authorization**
   - Broken Authentication: ✅ Mitigated via Better Auth
   - Broken Access Control: ✅ Mitigated via role checks and ownership verification
   - Session Fixation: ✅ Mitigated via Better Auth session management

3. **Abuse & DoS**
   - Rate Limiting: ✅ Implemented for API keys
   - Request Size Limits: ✅ Via max length constraints
   - Resource Exhaustion: ✅ Via pagination and query limits

4. **Information Disclosure**
   - Account Enumeration: ✅ Mitigated via consistent responses
   - Error Information Leakage: ✅ Generic error messages
   - Audit Trail: ✅ Implemented for admin actions

### Remaining Considerations

1. **Application-level Rate Limiting**
   - Currently only API keys have rate limits
   - Consider adding rate limits for regular user sessions
   - Recommendation: Use middleware like `express-rate-limit`

2. **CORS Configuration**
   - Review CORS settings in production
   - Ensure only trusted origins are allowed
   - Set appropriate `Access-Control-Allow-Credentials`

3. **Monitoring & Alerting**
   - Consider adding monitoring for:
     - Failed authentication attempts
     - Unusual API usage patterns
     - Admin action anomalies
   - Set up alerts for security events

4. **Dependency Security**
   - Regularly update dependencies
   - Use `npm audit` or `bun audit` to check for vulnerabilities
   - Review security advisories for critical packages

5. **Data Privacy**
   - Consider implementing data retention policies
   - Ensure GDPR compliance for EU users
   - Provide data export functionality

## Incident Response

If a security vulnerability is discovered:

1. **Assess the Impact**
   - Determine what data/systems are affected
   - Identify if active exploitation is occurring

2. **Contain the Threat**
   - Deploy hotfix if possible
   - Temporarily disable affected endpoints if needed
   - Revoke compromised API keys/sessions

3. **Investigate**
   - Review audit logs
   - Check for signs of exploitation
   - Document timeline of events

4. **Remediate**
   - Apply permanent fix
   - Update security documentation
   - Add tests to prevent regression

5. **Communicate**
   - Notify affected users
   - Document lessons learned
   - Update security advisories

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [tRPC Security Best Practices](https://trpc.io/docs/server/authorization)
- [Better Auth Documentation](https://www.better-auth.com/)
- [InfluxDB Security](https://docs.influxdata.com/influxdb/v2.7/security/)
- [Prisma Security](https://www.prisma.io/docs/concepts/components/prisma-client/security)

## Version History

- **2024-11-01**: Initial security review and fixes
  - Fixed Flux injection vulnerabilities
  - Enhanced input validation across all routers
  - Fixed API key verification race condition
  - Added comprehensive security documentation
