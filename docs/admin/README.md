# Admin Interface

This application includes an administrator interface for managing users and viewing application statistics.

## Features

- **User Statistics Dashboard**: View total users, active users, recent signups, and banned users
- **User Management**: Search, view, and manage all users
- **Role Management**: Promote users to admin or demote to regular user
- **Ban/Unban Users**: Temporarily or permanently restrict user access
- **User Deletion**: Remove user accounts and all associated data

## Access

The admin dashboard is available at `/admin` and is only accessible to users with the `admin` role.

## Creating Your First Admin

After setting up the application, you need to create at least one admin user:

1. **Create a regular user account** through the signup flow
2. **Run the set-admin script** with the user's email:

```bash
bun scripts/set-admin.ts your-email@example.com
```

This will grant admin privileges to the specified user.

## Admin Capabilities

### Statistics View

- Total registered users
- Currently active users (with valid sessions)
- New signups in the last 7 days
- Number of banned users

### User Management

- **Search**: Find users by email
- **View Details**: Email, name, role, status, verification status, join date
- **Change Role**: Promote to admin or demote to user
- **Ban/Unban**: Restrict or restore user access
- **Impersonate**: Temporarily access the application as another user for troubleshooting
- **Delete**: Permanently remove user accounts

### Security

- Admin routes are protected at the server level
- Only users with `role: 'admin'` or `role: 'superadmin'` can access admin pages
- All admin actions are performed through Better Auth's admin plugin
- Role hierarchy prevents admins from managing superadmins
- Users cannot perform actions on their own accounts (delete, ban, demote, impersonate)
- Impersonation sessions are clearly marked with a banner and can be stopped at any time
- Superadmin accounts cannot be impersonated for security
- Deleted users have all associated data removed (cascade deletion)

## Technical Details

This implementation uses:

- **tRPC Admin Router**: Type-safe admin procedures with React Query integration
  - `admin.listUsers` - Query for paginated user list with search
  - `admin.setRole` - Mutation to change user roles
  - `admin.banUser` / `admin.unbanUser` - Mutations to ban/unban users
  - `admin.removeUser` - Mutation to delete users
  - `admin.impersonateUser` - Mutation to impersonate a user for troubleshooting
  - `admin.stopImpersonation` - Mutation to end impersonation session
  - `admin.getStats` - Query for admin statistics
- **Better Auth Admin Plugin**: Server and client plugins for admin functionality with access control
- **Access Control System**: Three-tier role hierarchy (superadmin > admin > user) with explicit permissions
- **Database Fields**:
  - `User.role` (default: 'user', can be 'admin' or 'superadmin')
  - `User.banned` (boolean)
  - `User.banReason` (optional text)
  - `User.banExpires` (optional datetime)
  - `Session.impersonatedBy` (tracks impersonation sessions)
- **Protected Routes**: Server-side session checks ensure only admins can access
- **React Query**: All admin actions use tRPC with automatic cache invalidation
- **Impersonation Banner**: Visual indicator when an admin is impersonating a user

## API Usage

### Server-Side (RSC)

```typescript
import { api } from '@/trpc/server';

// Get admin statistics
const stats = await api.admin.getStats();
```

### Client-Side (React Query)

```typescript
import { api } from '@/trpc/react';

// Query users
const { data } = api.admin.listUsers.useQuery({
  limit: 10,
  offset: 0,
  searchValue: 'john@example.com'
});

// Mutations
const utils = api.useUtils();
const setRole = api.admin.setRole.useMutation({
  onSuccess: () => utils.admin.listUsers.invalidate()
});

setRole.mutate({ userId: '123', role: 'admin' });

// Impersonate user
const impersonate = api.admin.impersonateUser.useMutation({
  onSuccess: () => router.push('/portfolio')
});

impersonate.mutate({ userId: '123' });

// Stop impersonation
const stopImpersonation = api.admin.stopImpersonation.useMutation({
  onSuccess: () => router.push('/admin')
});

stopImpersonation.mutate();
```

## Impersonation Feature

Admins can impersonate users to troubleshoot issues from the user's perspective:

### How It Works

1. **Start Impersonation**: Click "Impersonate User" in the user actions menu
2. **Impersonated Session**: You'll be redirected to the portfolio page as that user
3. **Visual Indicator**: An orange banner at the top shows you're impersonating
4. **Stop Impersonation**: Click "Stop Impersonation" in the banner to return to your admin account

### Restrictions

- Cannot impersonate yourself
- Cannot impersonate superadmin accounts
- Only superadmins can impersonate admin accounts
- Regular admins can only impersonate regular users

### Use Cases

- Reproduce bugs reported by specific users
- Verify user-specific data and permissions
- Test features from a user's perspective
- Troubleshoot portfolio or transaction issues

## Future Enhancements

Potential additions:

- Audit log of admin actions
- Bulk user operations
- Advanced filtering and export
- Custom permission sets beyond admin/user
