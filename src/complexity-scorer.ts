/**
 * Complexity Scorer — The Brain of Cost-Aware Routing
 *
 * Analyzes every incoming request and assigns a complexity score (0-100).
 * The score determines which "cost tier" the request goes to:
 *
 *   Score 0-25   → TIER_1 (Cheap)    : Simple greetings, definitions, formatting
 *                    → DeepSeek Flash / Xiaomi MiMo / GLM Flash
 *
 *   Score 26-60  → TIER_2 (Medium)   : Moderate code gen, explanations, analysis
 *                    → DeepSeek Pro / Kimi
 *
 *   Score 61-100 → TIER_3 (Premium)  : Complex refactoring, architecture, deep reasoning
 *                    → GLM-5.2 / Kimi (best available)
 *
 * This ensures Cursor's "say hi" messages don't hit the expensive GLM API,
 * while real programming tasks still get the strongest models.
 *
 * Like Kafka's message priority routing — automated, real-time, per-message.
 */

import { PromptType } from "./smart-router";

export type CostTier = "cheap" | "medium" | "premium";

export interface ComplexityScore {
  score: number;           // 0-100 (higher = more complex)
  tier: CostTier;          // Which cost tier this maps to
  factors: string[];       // Why this score was assigned (for logging)
  tokenEstimate: number;   // Estimated input tokens
}

// ─── Scoring Factors ──────────────────────────────────────────────────────

interface ScoringFactor {
  test: (text: string, msgCount: number, tokenEst: number) => boolean;
  points: number;
  label: string;
}

/**
 * Check for trivial/simple requests that can go to cheap models.
 * Examples: "hi", "thanks", "what is X", "list Y", formatting tweaks
 */
const SIMPLICITY_FACTORS: ScoringFactor[] = [
  // Very short messages = likely simple
  {
    test: (_text, _msgCount, tokenEst) => tokenEst < 50,
    points: -40,
    label: "Very short message",
  },
  // Greetings / acknowledgments
  {
    test: (text) => /^(hi|hello|hey|ok|okay|yes|no|thanks|thank you|sure|got it|cool|nice|great)\b/.test(text.trim()),
    points: -50,
    label: "Greeting/acknowledgment",
  },
  // Simple definition questions
  {
    test: (text) => /\b(what is|what's|define|who is|when|where|list|name)\b/.test(text)
           && text.length < 200,
    points: -30,
    label: "Simple question",
  },
  // Whitespace/formatting fixes
  {
    test: (text) => /\b(format|indent|lint|prettier|eslint)\b/.test(text)
           && text.length < 200,
    points: -20,
    label: "Formatting task",
  },
];

/**
 * Check for complex requests that need premium models.
 * Examples: architecture design, multi-file refactoring, security analysis
 */
const COMPLEXITY_FACTORS: ScoringFactor[] = [
  // Large context = complex (lots of code/files)
  {
    test: (_text, _msgCount, tokenEst) => tokenEst > 50_000,
    points: 30,
    label: "Large context (50K+ tokens)",
  },
  // Multiple files / codebase-level work
  {
    test: (text) => /\b(refactor|architecture|redesign|migrate|rewrite|overhaul)\b/.test(text),
    points: 25,
    label: "Architecture/refactoring",
  },
  // Security / performance critical
  {
    test: (text) => /\b(security|vulnerability|cve|exploit|injection|xss|csrf|rce)\b/.test(text),
    points: 20,
    label: "Security critical",
  },
  {
    test: (text) => /\b(performance|optimize|benchmark|profile|memory leak|cpu|latency)\b/.test(text),
    points: 15,
    label: "Performance optimization",
  },
  // Complex debugging
  {
    test: (text) => /\b(race condition|deadlock|concurrency|async|thread|mutex)\b/.test(text),
    points: 20,
    label: "Concurrency/async complexity",
  },
  // Database / system design
  {
    test: (text) => /\b(database|schema|migration|query optimization|index|transaction)\b/.test(text),
    points: 15,
    label: "Database design",
  },
  // Multi-step / complex instructions
  {
    test: (text) => {
      // Count action verbs — more actions = more complex
      const actions = text.match(/\b(implement|create|build|add|remove|update|delete|deploy|configure|setup|install)\b/gi);
      return actions !== null && actions.length >= 3;
    },
    points: 15,
    label: "Multi-step task (3+ actions)",
  },
  // Long code blocks (significant code to write/modify)
  {
    test: (text) => {
      const codeBlocks = text.match(/```[\s\S]*?```/g);
      if (!codeBlocks) return false;
      const totalCodeLen = codeBlocks.reduce((sum, b) => sum + b.length, 0);
      return totalCodeLen > 5000; // 5000+ chars of code
    },
    points: 20,
    label: "Large code blocks (5K+ chars)",
  },
  // System-level work
  {
    test: (text) => /\b(docker|kubernetes|terraform|ansible|nginx|apache|systemd|pm2)\b/.test(text),
    points: 10,
    label: "Infrastructure/DevOps",
  },
];

// ─── Token Estimation ─────────────────────────────────────────────────────

/**
 * Rough token estimate: ~4 chars per token for English text.
 * This is fast and good enough for routing decisions.
 */
function estimateTokens(messages: Array<{ role: string; content?: unknown }>): number {
  let totalChars = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      totalChars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && part.text) totalChars += part.text.length;
        if (part.type === "image_url") totalChars += 1000; // images cost tokens
      }
    }
  }
  return Math.ceil(totalChars / 4);
}

// ─── Main Scoring Function ────────────────────────────────────────────────

/**
 * Score request complexity (0-100).
 *
 * Algorithm:
 * 1. Start at base score 30 (medium — most Cursor requests need decent models)
 * 2. Adjust based on prompt type
 * 3. Apply simplicity factors (negative points)
 * 4. Apply complexity factors (positive points)
 * 5. Clamp to 0-100
 *
 * @param messages Chat messages from request
 * @param promptType Pre-detected prompt type from smart-router
 * @returns ComplexityScore with score, tier, factors, and token estimate
 */
export function scoreComplexity(
  messages: Array<{ role: string; content?: unknown }>,
  promptType: PromptType
): ComplexityScore {
  // Extract all text
  const allText = messages
    .map((m) => {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text || "")
          .join(" ");
      }
      return "";
    })
    .join(" ");

  const tokenEstimate = estimateTokens(messages);
  const msgCount = messages.length;
  const factors: string[] = [];

  // ── Base score by prompt type ──
  let baseScore: number;
  switch (promptType) {
    case "fast":     baseScore = 10; break;  // Simple/greeting → cheap
    case "general":  baseScore = 25; break;  // Questions → cheap-medium
    case "code":     baseScore = 40; break;  // Code → medium (default Cursor work)
    case "reasoning": baseScore = 50; break;  // Math/logic → medium-premium
    case "vision":   baseScore = 45; break;  // Vision → medium-premium
    default:         baseScore = 30;
  }
  factors.push(`Base(${promptType}): ${baseScore}`);

  // ── Simplicity deductions ──
  let score = baseScore;
  for (const factor of SIMPLICITY_FACTORS) {
    if (factor.test(allText, msgCount, tokenEstimate)) {
      score += factor.points;
      factors.push(`${factor.label}: ${factor.points > 0 ? "+" : ""}${factor.points}`);
    }
  }

  // ── Complexity additions ──
  for (const factor of COMPLEXITY_FACTORS) {
    if (factor.test(allText, msgCount, tokenEstimate)) {
      score += factor.points;
      factors.push(`${factor.label}: +${factor.points}`);
    }
  }

  // ── Message count factor ──
  // Long conversations (many messages) tend to need better models
  // for maintaining context and understanding
  if (msgCount > 20) {
    score += 10;
    factors.push(`Long conversation (${msgCount} msgs): +10`);
  } else if (msgCount > 40) {
    score += 20;
    factors.push(`Very long conversation (${msgCount} msgs): +20`);
  }

  // ── Token volume factor ──
  // Requests with lots of code/context are more demanding
  if (tokenEstimate > 100_000) {
    score += 15;
    factors.push(`Huge context (${(tokenEstimate / 1000).toFixed(0)}K tokens): +15`);
  }

  // ── Clamp to 0-100 ──
  score = Math.max(0, Math.min(100, score));

  // ── Map to cost tier ──
  let tier: CostTier;
  if (score <= 25) {
    tier = "cheap";
  } else if (score <= 60) {
    tier = "medium";
  } else {
    tier = "premium";
  }

  return { score, tier, factors, tokenEstimate };
}

/**
 * Get a human-readable tier description for logging.
 */
export function tierLabel(tier: CostTier): string {
  switch (tier) {
    case "cheap":   return "💰 CHEAP";
    case "medium":  return "💵 MEDIUM";
    case "premium": return "💎 PREMIUM";
  }
}
