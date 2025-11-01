# Admin User Setup for Production

This guide covers how to create admin users in production Docker deployments.

## Method 1: Environment Variables (Recommended for Docker)

The application includes an automatic seeder that runs on container startup.

### Setup

Add these environment variables to your Docker deployment:

```bash
# Required: Admin user email
ADMIN_EMAIL=admin@example.com

# Required for NEW users: Admin password
ADMIN_PASSWORD=your-secure-password-here

# Optional: Admin display name (defaults to "Admin")
ADMIN_NAME=Administrator
```

### How It Works

1. On container startup, after running migrations, the seeder (`prisma/seed.ts`) runs automatically
2. If `ADMIN_EMAIL` is set:
   - **User exists**: Ensures they have admin role
   - **User doesn't exist**: Creates new user with email/password auth and admin role
3. The seed is idempotent - safe to run multiple times

### Docker Compose Example

```yaml
services:
  app:
    image: your-registry/invest-igator:latest
    environment:
      DATABASE_URL: postgresql://user:pass@db:5432/investigator
      ADMIN_EMAIL: admin@example.com
      ADMIN_PASSWORD: ${ADMIN_PASSWORD} # Use secrets!
      ADMIN_NAME: Administrator
      # ... other env vars
```

### Docker Run Example

```bash
docker run -d \
  -e DATABASE_URL=postgresql://user:pass@host/db \
  -e ADMIN_EMAIL=admin@example.com \
  -e ADMIN_PASSWORD=secure-password \
  -e ADMIN_NAME=Administrator \
  your-registry/invest-igator:latest
```

### Security Notes

- **Never commit passwords to version control**
- Use Docker secrets or encrypted environment variables
- Change the default admin password after first login
- Remove `ADMIN_PASSWORD` env var after initial setup if desired (won't affect existing users)

## Method 2: Manual Script (Alternative)

If you prefer to manually create admin users after deployment:

### 1. Connect to your running container

```bash
docker exec -it <container-name> /bin/sh
```

### 2. Run the set-admin script

```bash
# For existing users
bun scripts/set-admin.ts user@example.com
```

### 3. For new users

First create the account through the signup flow, then promote to admin:

```bash
bun scripts/set-admin.ts newadmin@example.com
```

## Method 3: Database Query (Emergency Access)

If you need emergency admin access, you can update the role directly:

```sql
-- Connect to your database
UPDATE "User" SET role = 'admin' WHERE email = 'user@example.com';
```

## Verification

After setting up an admin user:

1. Log in with the admin credentials
2. Navigate to `/admin`
3. You should see the admin dashboard with user management tools

## Troubleshooting

### Seed doesn't run

Check container logs:

```bash
docker logs <container-name>
```

Look for:

```text
Running database seed...
✓ Created admin user: admin@example.com
```

### User exists but isn't admin

The seeder automatically upgrades existing users. Check logs for:

```text
✓ Updated existing user "admin@example.com" to admin role
```

### Password doesn't work

Ensure `PASSWORD_PEPPER` environment variable matches between seed creation and runtime:

- Same value must be used when creating the user and when authenticating
- If you changed it, you'll need to recreate the user or reset the password

## Production Best Practices

1. **Use environment variable management**:
   - Docker secrets
   - Kubernetes secrets
   - Cloud provider secret managers (AWS Secrets Manager, etc.)

2. **Rotate credentials**:
   - Change admin password regularly
   - Use strong, unique passwords

3. **Audit admin access**:
   - Monitor admin actions
   - Limit number of admin users
   - Review admin user list periodically via the admin dashboard

4. **Separate environments**:
   - Use different admin credentials for staging vs production
   - Never reuse passwords across environments
