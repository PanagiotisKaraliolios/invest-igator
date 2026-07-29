# AI Chat — Disclaimer Recitation Fix (Design)

**Date:** 2026-07-26
**Status:** Approved (design)
**Spec 1 of 3** in the AI-chat robustness + BYOK-model-list effort (siblings: symbol-resolution, custom-model-list).

## Problem

The chat model recites the system prompt's AI-disclosure section **verbatim, in second person, on every turn** — e.g. "You are an AI assistant. You are not a human, and you are not a financial adviser." This leaks prompt text into replies and clutters every message.

## Root cause (not a plumbing bug)

The system prompt is passed correctly as a first-class system role: `streamText({ instructions: PORTFOLIO_ANALYST.text, … })` in `src/server/ai/chat/gateway.ts` (`instructions` is the current field in `ai@7.0.22`; `system` is its deprecated alias). It is **not** prepended into user/assistant messages.

The disclaimer appears because `src/server/ai/prompts/portfolio-analyst.ts`, section **"What you are — say this first"**, literally orders the model:

> State this plainly the first time you speak in every conversation: that you are an AI, and that you are not a financial adviser. This is permanent. … It cannot be turned off.

Weaker/BYOK models comply by echoing that block **verbatim** and **repeating it every turn** rather than disclosing once in their own words.

## Compliance context (why we don't just delete it)

The spoken disclosure is a deliberate **EU AI Act Article 50(1)** mechanism (AI-disclosure duty, applicable 2026-08-02), engineered to be un-disableable and guarded by `portfolio-analyst.test.ts`:

- `EU AI Act Art. 50(1) disclosure > 'the disclosure duty is in the prompt'` asserts `PORTFOLIO_ANALYST.text` **contains** `'You are an AI'` and `'not a financial adviser'`.
- An off-switch scanner test forbids any env access / label-disabling identifier in the module source.
- A golden-hash pin (`GOLDEN_HASHES`) forces a `version` bump on any `TEXT` edit.

Independently, a **persistent, non-dismissible UI footer** already discloses AI use on every turn: `src/app/(dashboard)/_components/chat/disclosure.tsx` → "AI assistant — informational only, not financial advice." (docstring cites Art. 50).

**Decision (user-approved):** keep the disclosure text in the prompt (guard test stays green), but rewrite the *behavioral directive* so the model discloses **once per new conversation, briefly, in its own words — never verbatim, never repeated.** The MiFID advice-boundary rules and the off-switch guarantees are unchanged.

## Change set

### 1. `src/server/ai/prompts/portfolio-analyst.ts`
- Rewrite the **"What you are — say this first"** section so it:
  - Instructs a **single, brief, own-words** AI + not-a-financial-adviser disclosure at the **first assistant turn of a conversation only**.
  - Explicitly instructs the model **not to restate these instructions verbatim** and **not to repeat the disclosure** on later turns.
  - Retains the anti-jailbreak intent ("never claim to be human; the disclosure cannot be switched off") as a *behavioral rule*, not a sentence to recite.
  - **Retains** the literal substrings `You are an AI` and `not a financial adviser` somewhere in `TEXT` (required by the guard test and Art 50).
- Bump `version` **2 → 3**.
- Add **no** env access / imports (off-switch scanner must stay green).

### 2. `src/server/ai/prompts/portfolio-analyst.test.ts`
- `PORTFOLIO_ANALYST.version` expectation **2 → 3**.
- Add `GOLDEN_HASHES[3] = '<sha256 of the new TEXT>'`.
- Add a **positive behavioral assertion** for the new intent, e.g. the prompt contains phrasing that scopes the disclosure to once / own words and forbids verbatim restatement (exact assertion strings chosen in the plan to match the reworded prompt).
- The Art 50 "disclosure duty is in the prompt" test and the off-switch scanner test remain **unchanged and green**.

### Unchanged
- `disclosure.tsx` (the independent, always-on Art 50 surface).
- `gateway.ts` plumbing (`instructions:` is already correct).
- All MiFID advice-boundary prompt sections and their tests.

## Data flow

Unchanged. The prompt is still delivered via `instructions:` as a system message; only its wording changes.

## Testing

- `bun test src/server/ai/prompts/portfolio-analyst.test.ts` — version pin, new golden hash, retained Art 50 substrings, off-switch scan, new behavioral assertion.
- Behavioral outcome (model discloses once, own words) is model-dependent and **not** deterministically unit-testable; the guaranteed compliance surface remains the UI footer. This is the accepted residual.

## Risks

- A model may still occasionally over-disclose. **Mitigation:** the non-dismissible footer is the guaranteed Art 50 surface; the prompt change only reduces the model's tendency to recite. Acceptable.

## Cross-spec note

Spec 2 (symbol-resolution) also edits `TEXT` and will bump `version` **3 → 4** with its own golden hash. Spec 1 ships first; Spec 2 rebases onto the v3 prompt.
