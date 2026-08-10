// Lightweight token estimator — no external dependencies.
// Uses a simple heuristic: ~4 chars per token for English text,
// with adjustments for code, math, and special characters.
// This is approximate (GPT-4 tokenizer averages ~4 chars/token but varies).
// For a precise count we'd need tiktoken.js (~1 MB), which is overkill here.

export function estimateTokens(text: string): number {
  if (!text) return 0;
  let tokens = 0;
  // Split into chunks: words, punctuation, whitespace
  const chunks = text.match(/(\s+|[a-zA-Z0-9]+|[^\sa-zA-Z0-9]+)/g) || [];
  for (const chunk of chunks) {
    if (/^\s+$/.test(chunk)) {
      // whitespace — usually merged with previous token
      tokens += chunk.length > 4 ? 1 : 0;
    } else if (/^[a-zA-Z0-9]+$/.test(chunk)) {
      // word — count as 1 token per ~4 chars (rough avg)
      tokens += Math.max(1, Math.ceil(chunk.length / 4));
    } else {
      // punctuation / symbols — each typically 1 token, but some pairs merge
      tokens += Math.ceil(chunk.length / 2);
    }
  }
  return Math.max(1, tokens);
}

export function estimateConversationTokens(messages: Array<{ role: string; content: string }>): number {
  let total = 0;
  for (const m of messages) {
    total += 4; // role + formatting overhead per message
    total += estimateTokens(m.content);
  }
  total += 3; // priming
  return total;
}

export function formatTokenCount(n: number): string {
  if (n < 1000) return n + " tok";
  if (n < 1_000_000) return (n / 1000).toFixed(1) + "K tok";
  return (n / 1_000_000).toFixed(2) + "M tok";
}
