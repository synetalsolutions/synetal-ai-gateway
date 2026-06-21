#!/usr/bin/env bash
#
# ─────────────────────────────────────────────────────────────────────────────
#  Synetal AI Gateway — Branch Protection & Repo Setup Script
# ─────────────────────────────────────────────────────────────────────────────
#
#  WHAT THIS DOES:
#    1. Requires PR reviews before merge (minimum 1 reviewer)
#    2. Dismisses stale review approvals when new commits are pushed
#    3. Requires status checks (CI) to pass before merge
#    4. Requires branches to be up-to-date before merge
#    5. Restricts who can push directly to main (admins can bypass)
#    6. Enforces linear history (no merge commits)
#    7. Enables issues, discussions, squash-merge, and auto-delete branches
#
#  PREREQUISITES:
#    - GitHub CLI: yum install gh  OR  brew install gh
#    - Authenticate:  gh auth login
#
#  USAGE:
#    chmod +x scripts/setup-branch-protection.sh
#    ./scripts/setup-branch-protection.sh
#
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────────────
REPO="synetalsolutions/synetal-ai-gateway"
BRANCH="main"
MIN_REVIEWERS="1"

echo "╔══════════════════════════════════════════════════╗"
echo "║  Synetal AI Gateway — Branch Protection Setup    ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── Check gh CLI ────────────────────────────────────────────────────────────
if ! command -v gh &>/dev/null; then
  echo "❌ GitHub CLI (gh) is not installed."
  echo "   Install:  https://github.com/cli/cli#installation"
  exit 1
fi

# ── Check auth ──────────────────────────────────────────────────────────────
if ! gh auth status &>/dev/null; then
  echo "❌ Not authenticated with GitHub."
  echo "   Run:  gh auth login"
  exit 1
fi

echo "✅ GitHub CLI authenticated as $(gh api user --jq .login)"
echo "📦 Target: github.com/$REPO → branch: $BRANCH"
echo ""

# ── 1. Branch Protection ───────────────────────────────────────────────────
echo "🔒 Setting branch protection rules on '$BRANCH'..."

gh api \
  --method PUT \
  "repos/$REPO/branches/$BRANCH/protection" \
  --field "required_status_checks[strict]=true" \
  --field "required_status_checks[contexts][]=build-and-test (20.x)" \
  --field "required_status_checks[contexts][]=build-and-test (22.x)" \
  --field "enforce_admins=true" \
  --field "required_pull_request_reviews[dismiss_stale_reviews]=true" \
  --field "required_pull_request_reviews[require_code_owner_reviews]=false" \
  --field "required_pull_request_reviews[required_approving_review_count]=$MIN_REVIEWERS" \
  --field "restrictions=" \
  --field "required_linear_history=true" \
  --field "allow_force_pushes=false" \
  --field "allow_deletions=false" \
  --silent

echo "   ✅ Branch protection enabled"
echo "      • $MIN_REVIEWERS reviewer(s) required"
echo "      • Stale reviews dismissed on new pushes"
echo "      • CI checks required: build-and-test"
echo "      • Direct pushes blocked"
echo "      • Force-push disabled"
echo "      • Branch deletion disabled"
echo "      • Linear history enforced"
echo ""

# ── 2. Repository Settings ─────────────────────────────────────────────────
echo "⚙️  Applying repository settings..."

gh repo edit "$REPO" \
  --enable-issues \
  --enable-discussions \
  --enable-projects \
  --enable-merge-commit=false \
  --enable-squash-merge \
  --enable-rebase-merge \
  --delete-branch-on-merge \
  --allow-update-branch

echo "   ✅ Issues enabled"
echo "   ✅ Discussions enabled"
echo "   ✅ Squash merge enabled (merge commit disabled)"
echo "   ✅ Auto-delete branches on merge"
echo ""

# ── 3. Topics & Description ────────────────────────────────────────────────
echo "🏷️  Applying topics and description..."

gh repo edit "$REPO" \
  --description "Cost-aware multi-model AI gateway — smart routing, circuit breaker, 26+ models from 4 providers, OpenAI-compatible" \
  --add-topic llm \
  --add-topic llm-proxy \
  --add-topic ai-gateway \
  --add-topic openai-api \
  --add-topic deepseek \
  --add-topic glm \
  --add-topic kimi \
  --add-topic load-balancing \
  --add-topic cost-optimization \
  --add-topic circuit-breaker \
  --add-topic typescript \
  --add-topic nodejs

echo "   ✅ 12 topics added"
echo ""

# ── Done ────────────────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════"
echo "✨ All done! Your repository is now protected."
echo ""
echo "Summary:"
echo "  • main branch: LOCKED (direct pushes blocked, PR required)"
echo "  • CI checks:   REQUIRED (build must pass)"
echo "  • Reviewers:   $MIN_REVIEWERS minimum"
echo "  • Issues/Discussions: ENABLED"
echo "  • Auto-delete branches on merge: ON"
echo "═══════════════════════════════════════════════════"
