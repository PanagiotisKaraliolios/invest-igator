# Invest-igator API - Postman Collections

This directory contains Postman collections for testing and exploring the Invest-igator API.

## 📦 Files

- **Invest-igator-API.postman_collection.json** - Complete API collection with all endpoints
- **Invest-igator.postman_environment.json** - Environment template with variables

## 🚀 Quick Start

### 1. Import into Postman

1. Open Postman Desktop or Web
2. Click **Import** button (top left)
3. Drag and drop both JSON files or click "Upload Files"
4. Both the collection and environment will be imported

### 2. Configure Environment

1. Click on **Environments** in the left sidebar
2. Select **Invest-igator Environment**
3. Update the variables:
   - `baseUrl`: Your API URL (e.g., `http://localhost:3000` for local dev or `https://yourdomain.com` for production)
   - `authToken`: Leave empty initially (will be set after login)
   - `apiKey`: Optional - for API key authentication
   - `userEmail`: Your test user email

### 3. Select Environment

- Click the environment dropdown in the top-right corner
- Select **Invest-igator Environment**

### 4. Authentication Flow

The API uses session-based authentication via Better Auth:

1. **Sign Up** (if you don't have an account):
   - Open `Auth` → `Sign Up`
   - Update the request body with your email, password, and name
   - Send the request

2. **Sign In**:
   - Open `Auth` → `Better Auth - Sign In (Credentials)`
   - Update the request body with your email and password
   - Send the request
   - The session cookie will be automatically stored

3. **Access Protected Endpoints**:
   - Once signed in, you can use any protected endpoint
   - The session cookie is automatically included in requests

## 📚 API Structure

The collection is organized into the following sections:

### Auth (Public)
- Check email existence
- Sign up
- Password reset flow
- Better Auth login/logout

### Account (Protected)
- Get/update user profile
- Upload profile picture
- Change/set password
- Two-factor authentication
- Email management
- OAuth connections
- Account deletion

### Watchlist (Protected)
- Add/remove symbols
- List watchlist items
- Search symbols
- Get price history
- Get corporate events (dividends, splits)
- Star/unstar symbols

### Transactions (Protected)
- Create/update/delete transactions
- List with filters and pagination
- Bulk operations
- CSV import/export
- Duplicate detection

### Portfolio (Protected)
- Get portfolio structure (holdings, weights, values)
- Calculate performance (TWR/MWR returns)

### Goals (Protected)
- Create/update/delete financial goals
- List goals with progress

### API Keys (Protected)
- Create/list/update/delete API keys
- Verify keys
- Clean up expired keys

### Admin (Protected - Admin/Superadmin only)
- User management
- Role assignment
- Ban/unban users
- Statistics
- Audit logs

### Currency (Protected)
- Get/set preferred currency

### Theme (Protected)
- Get/set theme preference (light/dark)

### FX (Protected)
- Get currency conversion matrix

## 🔐 Authentication Methods

### 1. Session Authentication (Recommended)
- Use the Better Auth endpoints to sign in
- Session cookies are automatically managed by Postman
- No additional configuration needed

### 2. API Key Authentication (Programmatic Access)
- Create an API key via `API Keys` → `Create API Key`
- Copy the returned key (shown only once!)
- Set the `apiKey` environment variable
- Add the API key to request headers:
  ```
  Authorization: Bearer {{apiKey}}
  ```

## 🔧 Customizing Requests

All requests use environment variables where possible. To customize:

1. Open any request
2. Modify the request body/parameters
3. Variables like `{{baseUrl}}` are automatically replaced

### Example: Testing with Different Data

**Add a Symbol to Watchlist:**
```json
{
  "symbol": "TSLA",
  "displaySymbol": "Tesla Inc.",
  "description": "Electric vehicle manufacturer",
  "type": "Stock"
}
```

**Create a Transaction:**
```json
{
  "date": "2024-11-01",
  "type": "BUY",
  "symbol": "AAPL",
  "quantity": 100,
  "price": 175.50,
  "currency": "USD",
  "fees": 9.99,
  "notes": "Q4 investment"
}
```

## 📖 API Endpoint Format

All tRPC endpoints follow this pattern:
```
POST {{baseUrl}}/api/trpc/{router}.{procedure}?batch=1
```

**Important:** All tRPC endpoints require the `batch=1` query parameter.

Examples:
- `POST /api/trpc/account.getMe?batch=1` - Get current user
- `POST /api/trpc/watchlist.list?batch=1` - List watchlist items
- `POST /api/trpc/transactions.create?batch=1` - Create transaction

### tRPC Batch Input Format

tRPC uses a batch format for HTTP requests. All inputs must be wrapped in the following structure:

**For procedures with object inputs:**
```json
{
  "0": {
    "json": {
      "date": "2024-11-01",
      "type": "BUY",
      "symbol": "AAPL"
    }
  }
}
```

**For procedures with simple inputs (string, number, enum):**
```json
{
  "0": {
    "json": "value"
  }
}
```

Examples:
- `auth.checkEmail`: `{"0": {"json": "user@example.com"}}`
- `currency.setCurrency`: `{"0": {"json": "USD"}}`
- `theme.setTheme`: `{"0": {"json": "dark"}}`

**For procedures with no input (queries):**
- Leave body empty or set to `{}`

## 🧪 Testing Workflow

### Basic Testing Flow:

1. **Authentication**
   - Sign up or sign in
   - Verify session with `Account` → `Get Current User Profile`

2. **Watchlist**
   - Search for symbols
   - Add symbols to watchlist
   - Get price history
   - Star favorite symbols

3. **Transactions**
   - Create buy/sell transactions
   - List transactions with filters
   - Export to CSV

4. **Portfolio**
   - View portfolio structure
   - Calculate performance metrics

5. **Goals**
   - Create financial goals
   - Track progress

### Admin Testing (Requires Admin Role):

1. **User Management**
   - List all users
   - Change user roles
   - Ban/unban users

2. **Audit Logs**
   - View admin actions
   - Filter by date/action type

## 🌐 Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `baseUrl` | API base URL | `http://localhost:3000` |
| `authToken` | Bearer token (if using token auth) | Auto-populated |
| `apiKey` | API key for programmatic access | Create via API Keys endpoint |
| `userEmail` | Test user email | `user@example.com` |

## 📝 Notes

- **tRPC Inputs**: All inputs are sent as JSON in the request body
- **Authentication**: Most endpoints require authentication (session or API key)
- **Pagination**: Many list endpoints support `page` and `perPage` parameters
- **Error Handling**: Errors return appropriate HTTP status codes with JSON error messages

## 🔍 Exploring the API

### OpenAPI Documentation
You can also access the OpenAPI schema at:
```
GET {{baseUrl}}/api/docs
```

This returns a comprehensive OpenAPI 3.0 schema with all endpoints documented.

### Using Scalar API Reference
The app includes [@scalar/nextjs-api-reference](https://github.com/scalar/scalar) for interactive API documentation. Visit `{{baseUrl}}/api/reference` (e.g., `http://localhost:3000/api/reference` for local development) to explore the API interactively.

## 🐛 Troubleshooting

### Authentication Issues
- Make sure you're signed in via `Better Auth - Sign In`
- Check that cookies are enabled in Postman
- Verify the `baseUrl` is correct

### 401 Unauthorized
- Session may have expired - sign in again
- API key may be invalid or expired
- Endpoint may require specific permissions

### 403 Forbidden
- Admin endpoints require admin/superadmin role
- Some operations require specific permissions

### Connection Refused
- Ensure the development server is running (`bun run dev`)
- Check the `baseUrl` is correct

## 💡 Tips

1. **Save Responses**: Click "Save Response" to keep example responses
2. **Use Variables**: Create additional environment variables for common test data
3. **Collections Variables**: Use collection variables for data shared across requests
4. **Pre-request Scripts**: Add scripts to generate dynamic data
5. **Tests**: Add test scripts to validate responses automatically
6. **Folders**: Organize requests into additional folders as needed

## 🤝 Contributing

When adding new endpoints:
1. Add the request to the appropriate folder
2. Include a detailed description
3. Provide example request/response bodies
4. Update this README if needed

## 📚 Additional Resources

- [Invest-igator Repository](https://github.com/PanagiotisKaraliolios/invest-igator)
- [tRPC Documentation](https://trpc.io/)
- [Better Auth Documentation](https://www.better-auth.com/)
- [Postman Documentation](https://learning.postman.com/)
