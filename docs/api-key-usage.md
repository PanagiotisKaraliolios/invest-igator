# API Key Usage Examples

## Creating an API Key

1. Log in to your account at `/account`
2. Navigate to the "API Keys" tab
3. Click "Create API Key"
4. Configure:
   - **Name**: A descriptive name (e.g., "Trading Bot")
   - **Prefix**: Optional prefix for easier identification (e.g., "bot_")
   - **Expiration**: How long the key should be valid
   - **Permissions**: Select a template or configure custom permissions
   - **Rate Limiting**: Optional request limits

5. **IMPORTANT**: Copy the API key immediately - it won't be shown again!

## Using an API Key

All API requests require the `x-api-key` header with your API key.

### cURL Examples

#### Account Operations (requires `account:read`)

```bash
# Get user profile
curl https://your-domain.com/api/trpc/account.getMe \
  -H "x-api-key: your_api_key_here"

# Get two-factor auth state
curl https://your-domain.com/api/trpc/account.getTwoFactorState \
  -H "x-api-key: your_api_key_here"
```

#### FX Operations (requires `fx:read`)

```bash
# Get foreign exchange rate matrix
curl https://your-domain.com/api/trpc/fx.matrix \
  -H "x-api-key: your_api_key_here"
```

#### Watchlist Operations

```bash
# List watchlist items (requires watchlist:read)
curl https://your-domain.com/api/trpc/watchlist.list \
  -H "x-api-key: your_api_key_here"

# Add symbol to watchlist (requires watchlist:write)
curl -X POST https://your-domain.com/api/trpc/watchlist.add?batch=1 \
  -H "x-api-key: your_api_key_here" \
  -H "content-type: application/json" \
  -d '{"0":{"symbol":"AAPL"}}'

# Get price history (requires watchlist:read)
curl https://your-domain.com/api/trpc/watchlist.history?batch=1&input=%7B%220%22%3A%7B%22symbols%22%3A%5B%22AAPL%22%5D%2C%22days%22%3A30%7D%7D \
  -H "x-api-key: your_api_key_here"

# Remove from watchlist (requires watchlist:delete)
curl -X POST https://your-domain.com/api/trpc/watchlist.remove?batch=1 \
  -H "x-api-key: your_api_key_here" \
  -H "content-type: application/json" \
  -d '{"0":{"symbol":"AAPL"}}'
```

#### API Key Management (requires `apiKeys:read`, `apiKeys:write`, `apiKeys:delete`)

```bash
# List all API keys
curl https://your-domain.com/api/trpc/apiKeys.list \
  -H "x-api-key: your_api_key_here"

# Get specific API key
curl "https://your-domain.com/api/trpc/apiKeys.get?batch=1&input=%7B%220%22%3A%7B%22id%22%3A%22key_id_here%22%7D%7D" \
  -H "x-api-key: your_api_key_here"

# Delete an API key
curl -X POST "https://your-domain.com/api/trpc/apiKeys.delete?batch=1" \
  -H "x-api-key: your_api_key_here" \
  -H "content-type: application/json" \
  -d '{"0":{"keyId":"key_id_here"}}'
```

### JavaScript/TypeScript Example

```typescript
const API_KEY = 'your_api_key_here';
const API_URL = 'https://your-domain.com/api/trpc';

// Account operations
async function getUserProfile() {
  const response = await fetch(`${API_URL}/account.getMe`, {
    headers: { 'x-api-key': API_KEY }
  });
  const data = await response.json();
  return data.result.data;
}

// FX operations
async function getFxRates() {
  const response = await fetch(`${API_URL}/fx.matrix`, {
    headers: { 'x-api-key': API_KEY }
  });
  const data = await response.json();
  return data.result.data;
}

// Watchlist operations
async function getWatchlist() {
  const response = await fetch(`${API_URL}/watchlist.list`, {
    headers: { 'x-api-key': API_KEY }
  });
  const data = await response.json();
  return data.result.data;
}

async function addToWatchlist(symbol: string) {
  const response = await fetch(`${API_URL}/watchlist.add?batch=1`, {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ 0: { symbol } })
  });
  return await response.json();
}

// API key management
async function listApiKeys() {
  const response = await fetch(`${API_URL}/apiKeys.list`, {
    headers: { 'x-api-key': API_KEY }
  });
  const data = await response.json();
  return data.result.data;
}

// Usage examples
const profile = await getUserProfile();
console.log('User:', profile.name, profile.email);

const rates = await getFxRates();
console.log('USD to EUR:', rates.USD.EUR);

const watchlist = await getWatchlist();
console.log('My watchlist:', watchlist);

await addToWatchlist('MSFT');
console.log('Added MSFT to watchlist');

const apiKeys = await listApiKeys();
console.log('Active API keys:', apiKeys.length);
```

### Python Example

```python
import requests

API_KEY = 'your_api_key_here'
API_URL = 'https://your-domain.com/api/trpc'

# Account operations
def get_user_profile():
    response = requests.get(
        f'{API_URL}/account.getMe',
        headers={'x-api-key': API_KEY}
    )
    return response.json()['result']['data']

# FX operations
def get_fx_rates():
    response = requests.get(
        f'{API_URL}/fx.matrix',
        headers={'x-api-key': API_KEY}
    )
    return response.json()['result']['data']

# Watchlist operations
def get_watchlist():
    response = requests.get(
        f'{API_URL}/watchlist.list',
        headers={'x-api-key': API_KEY}
    )
    return response.json()['result']['data']

def add_to_watchlist(symbol):
    response = requests.post(
        f'{API_URL}/watchlist.add?batch=1',
        headers={
            'x-api-key': API_KEY,
            'content-type': 'application/json'
        },
        json={'0': {'symbol': symbol}}
    )
    return response.json()

# API key management
def list_api_keys():
    response = requests.get(
        f'{API_URL}/apiKeys.list',
        headers={'x-api-key': API_KEY}
    )
    return response.json()['result']['data']

# Usage examples
profile = get_user_profile()
print(f"User: {profile['name']} ({profile['email']})")

rates = get_fx_rates()
print(f"USD to EUR: {rates['USD']['EUR']}")

watchlist = get_watchlist()
print(f'Watchlist items: {len(watchlist)}')

add_to_watchlist('TSLA')
print('Added TSLA to watchlist')

api_keys = list_api_keys()
print(f'Active API keys: {len(api_keys)}')
```

## Available Permissions

When creating an API key, you'll need to configure permissions for the operations you want to allow:

| Scope | Read | Write | Delete |
|-------|------|-------|--------|
| `account` | View profile & settings | Update profile, change password | Delete account |
| `apiKeys` | List & view keys | Create & update keys | Delete keys |
| `fx` | View exchange rates | N/A | N/A |
| `watchlist` | View watchlist & history | Add & star items | Remove items |
| `portfolio` | *Coming soon* | *Coming soon* | N/A |
| `transactions` | *Coming soon* | *Coming soon* | *Coming soon* |
| `goals` | *Coming soon* | *Coming soon* | *Coming soon* |

## Error Handling

### Permission Errors (403 Forbidden)

If your API key doesn't have the required permissions:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "API key does not have permission: watchlist:write"
  }
}
```

**Solution**: Create a new API key with the appropriate permissions or update your existing key.

## Rate Limiting

If you exceed your rate limit, you'll receive a 429 error with the reset time:

```json
{
  "error": {
    "code": "TOO_MANY_REQUESTS",
    "message": "Rate limit exceeded. Try again in 45 seconds."
  }
}
```

## Security Best Practices

1. **Never commit API keys to version control**
2. **Use environment variables** to store keys
3. **Rotate keys regularly** - create new keys and delete old ones
4. **Use minimal permissions** - only grant what's needed
5. **Set expiration dates** - keys should expire automatically
6. **Enable rate limiting** - protect against abuse
7. **Monitor usage** - check remaining requests regularly
8. **Delete unused keys** - clean up keys you're no longer using

## Troubleshooting

### "Invalid API key"

- Check that you copied the entire key
- Verify the key hasn't expired
- Ensure the key is enabled

### "API key does not have permission"

- Check the permissions template you selected
- You may need to create a new key with broader permissions
- Some operations (like admin functions) require specific user roles

### "Rate limit exceeded"

- Wait for the time window to reset
- Increase rate limits when creating a new key
- Implement exponential backoff in your code
