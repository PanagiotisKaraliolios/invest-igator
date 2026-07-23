# AI transaction entry (natural language)

Tell the assistant a trade in plain language and it records it — after you confirm.

> *"I bought 10 Apple at 150 yesterday"* → the assistant resolves the symbol, shows a **Confirm
> card** (AAPL · BUY · 10 @ 150 USD · yesterday's date), and records the transaction **only when you
> click Confirm**.

## How it works

1. The `transactions.create` tool resolves your input (symbol via the market-data lookup, currency
   from the security's listing currency or your account default, relative dates like "yesterday"),
   builds a preview, and signs a short-lived confirmation token. **It writes nothing.**
2. The chat renders a read-only Confirm / Cancel card.
3. **Confirm** calls a session-authenticated mutation that re-validates the signed token (integrity,
   120-second expiry, that it belongs to you, single-use) and then writes the transaction. The
   assistant itself never triggers the write — only your click does.

## Requirements

- Set **`AI_MUTATION_SECRET`** (≥32 chars, e.g. `openssl rand -base64 32`) in the server environment.
  Without it, the tool is unavailable and any confirmation fails closed — nothing can be written.

## Scope and limits

- **Create only.** Editing or removing transactions is done through the normal transactions UI.
- **Chat only.** The MCP server stays read-only; this write tool is never exposed there.
- **Confirm required.** No transaction is ever recorded without your explicit click.
- **120-second window.** If a confirmation card expires, just ask the assistant again — it prepares a
  fresh one.
- If you want to change a detail before confirming ("no, it was 12 shares"), tell the assistant — it
  produces a new preview. The card itself is read-only so the confirmation always matches exactly
  what was signed.

## Not investment advice

Recording a trade you state you made is data entry, not a recommendation. The tool is purely
transactional and never suggests what to buy or sell.
