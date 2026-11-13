import { spawnSync } from 'node:child_process';
import { resolveGitHostAndRepo } from './githost.js';
import { resolveGitCredentials } from './auth.js';

/**
 * GraphQL query for fetching PR review threads, review decision, and commit anchor.
 */
export const PULL_REQUEST_THREADS_QUERY = `
query PullRequestReviewThreads($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewDecision
      headRefOid
      commits(last: 1) { nodes { commit { committedDate, oid } } }
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          originalLine
          comments(first: 20) {
            nodes {
              id
              databaseId
              author { login }
              body
              createdAt
            }
          }
        }
      }
    }
  }
}
`.trim();

const DEFAULT_AGENT_LOGINS = [
  'asdlc-bot',
  'asdlc-bot[bot]',
  'github-actions',
  'github-actions[bot]',
  'dependabot[bot]',
];

const THREAD_TRAILER_RE = /\bref:\s*#([A-Za-z0-9_=-]+)/g;
const SUGGESTION_BLOCK_RE = /```suggestion\r?\n([\s\S]*?)```/;

const ACTION_IMPERATIVE_RE = /\b(please|fix|add|remove|delete|rename|change|update|handle|refactor|avoid|should|must|need to|needs to|missing|bug|error|broken|fail|invalid|nullable|null check|throw|catch|test)\b/i;
const MIXED_SIGNAL_RE = /\b(lgtm|looks good|nice|great|good)\b.*\b(but|however|except|though|although|nit|please)\b/i;
const QUESTION_RE = /(\?|\b(why|how|what if|could you explain|can you explain|what does|is this|are we|should this)\b)/i;
const PRAISE_ONLY_RE = /^(?:lgtm|looks good(?: to me)?|nice(?: work| approach| job)?|good(?: job| catch| work)?|great|awesome|ship it|\+1|👍|🎉|🚀|✅)[!.\s]*$/i;

/**
 * Extracts review thread IDs already resolved via commit trailers (`ref: #<threadId>`).
 */
export function extractAddressedThreadIds(commitMessages = []) {
  const ids = new Set();
  for (const msg of commitMessages) {
    if (!msg) continue;
    for (const match of String(msg).matchAll(THREAD_TRAILER_RE)) {
      ids.add(match[1]);
    }
  }
  return ids;
}

/**
 * Returns true if the comment author is an automated bot or self-agent account.
 */
export function isBotOrSelfAuthor(login, { agentLogins = DEFAULT_AGENT_LOGINS } = {}) {
  if (!login) return true;
  const norm = String(login).trim().toLowerCase();
  if (norm.endsWith('[bot]')) return true;
  return agentLogins.some((a) => String(a).toLowerCase() === norm);
}

/**
 * Tier 1 Ingestion Filter:
 * Selects unresolved threads not already referenced in commit trailers whose latest comment
 * was authored by a human reviewer (never bots/self, preventing infinite loops).
 */
export function filterUnaddressedThreads(threads = [], { commitMessages = [], agentLogins = DEFAULT_AGENT_LOGINS } = {}) {
  const addressedIds = extractAddressedThreadIds(commitMessages);
  const candidates = [];

  for (const thread of threads) {
    if (!thread || thread.isResolved === true) continue;
    if (thread.id && addressedIds.has(thread.id)) continue;

    const nodes = thread.comments?.nodes || thread.comments || [];
    if (!Array.isArray(nodes) || nodes.length === 0) continue;

    const latestComment = nodes[nodes.length - 1];
    const authorLogin = latestComment?.author?.login ?? latestComment?.author ?? '';
    if (isBotOrSelfAuthor(authorLogin, { agentLogins })) continue;

    candidates.push({
      ...thread,
      latestComment,
      latestBody: String(latestComment?.body ?? ''),
      latestAuthor: authorLogin,
    });
  }

  return candidates;
}

/**
 * Tier 2 4-Way Semantic Intent Classifier:
 * - Category B: SUGGESTION_BLOCK (GitHub ```suggestion``` block)
 * - Category A: ACTION_REQUIRED (imperative demand, defect, or conservative mixed-signal fallback)
 * - Category C: INFORMATIONAL_QUESTION (architectural/rationale inquiry; zero code mutation)
 * - Category D: NON_ACTIONABLE (pure praise / acknowledgment)
 */
export function classifyReviewComment(body, { path = null, line = null } = {}) {
  const text = String(body ?? '').trim();

  // Category B: Native suggestion diff block
  const suggMatch = text.match(SUGGESTION_BLOCK_RE);
  if (suggMatch) {
    return {
      category: 'B',
      intent: 'SUGGESTION_BLOCK',
      actionable: true,
      requiresCodeOrSpecEdit: true,
      suggestedText: suggMatch[1].replace(/\r\n/g, '\n').replace(/\n$/, ''),
      path,
      line,
      body: text,
    };
  }

  // Category A: Mixed-signal conservative guard ("LGTM, but fix X") or explicit action imperative
  if (MIXED_SIGNAL_RE.test(text) || ACTION_IMPERATIVE_RE.test(text)) {
    return {
      category: 'A',
      intent: 'ACTION_REQUIRED',
      actionable: true,
      requiresCodeOrSpecEdit: true,
      suggestedText: null,
      path,
      line,
      body: text,
    };
  }

  // Category D: Pure non-actionable praise
  if (!text || PRAISE_ONLY_RE.test(text)) {
    return {
      category: 'D',
      intent: 'NON_ACTIONABLE',
      actionable: false,
      requiresCodeOrSpecEdit: false,
      suggestedText: null,
      path,
      line,
      body: text,
    };
  }

  // Category C: Informational rationale question
  if (QUESTION_RE.test(text)) {
    return {
      category: 'C',
      intent: 'INFORMATIONAL_QUESTION',
      actionable: true,
      requiresCodeOrSpecEdit: false,
      suggestedText: null,
      path,
      line,
      body: text,
    };
  }

  // Conservative Intent Invariant: ambiguous unmatched text defaults to ACTION_REQUIRED
  return {
    category: 'A',
    intent: 'ACTION_REQUIRED',
    actionable: true,
    requiresCodeOrSpecEdit: true,
    suggestedText: null,
    path,
    line,
    body: text,
  };
}

/**
 * Evaluates a full Pull Request payload through Tier 1 filtering + Tier 2 classification.
 * Captures actionable feedback regardless of whether reviewDecision is COMMENTED or CHANGES_REQUESTED.
 */
export function triagePullRequest(prPayload = {}, { commitMessages = [], agentLogins = DEFAULT_AGENT_LOGINS } = {}) {
  const threads = prPayload.reviewThreads?.nodes || prPayload.reviewThreads || [];
  const unaddressed = filterUnaddressedThreads(threads, { commitMessages, agentLogins });

  const actionableThreads = [];
  const suggestionThreads = [];
  const questionThreads = [];
  const nonActionableThreads = [];

  for (const thread of unaddressed) {
    const classification = classifyReviewComment(thread.latestBody, {
      path: thread.path || null,
      line: thread.line ?? thread.originalLine ?? null,
    });
    const item = { ...thread, classification };
    if (classification.intent === 'SUGGESTION_BLOCK') {
      suggestionThreads.push(item);
    } else if (classification.intent === 'ACTION_REQUIRED') {
      actionableThreads.push(item);
    } else if (classification.intent === 'INFORMATIONAL_QUESTION') {
      questionThreads.push(item);
    } else {
      nonActionableThreads.push(item);
    }
  }

  // Also triage top-level issue/PR discussion comments if provided
  const topComments = [];
  for (const c of (prPayload.issueComments || [])) {
    const login = c?.author?.login ?? c?.author ?? '';
    if (isBotOrSelfAuthor(login, { agentLogins })) continue;
    const cls = classifyReviewComment(c.body);
    if (cls.actionable) {
      topComments.push({ id: c.id, author: login, body: c.body, classification: cls });
    }
  }

  const reviewDecision = prPayload.reviewDecision || null;
  const hasHumanFeedback = reviewDecision === 'CHANGES_REQUESTED'
    || actionableThreads.length > 0
    || suggestionThreads.length > 0
    || questionThreads.length > 0
    || topComments.some((c) => c.classification.requiresCodeOrSpecEdit);

  return {
    reviewDecision,
    unaddressedCount: unaddressed.length,
    actionableThreads,
    suggestionThreads,
    questionThreads,
    nonActionableThreads,
    topComments,
    hasHumanFeedback,
    requiresFixCommit: actionableThreads.length > 0 || suggestionThreads.length > 0 || topComments.some((c) => c.classification.requiresCodeOrSpecEdit),
  };
}

/**
 * Applies a Category B GitHub suggestion block to file contents cleanly in memory.
 * Lines are 1-indexed inclusive.
 */
export function applySuggestionToLines(fileContent, { startLine = null, endLine = null, line = null, suggestedText = '' } = {}) {
  const normalized = String(fileContent ?? '').replace(/\r\n/g, '\n');
  const hadTrailingNewline = normalized.endsWith('\n');
  const lines = normalized.split('\n');
  if (hadTrailingNewline) lines.pop();

  const start = Number(startLine ?? line ?? 1);
  const end = Number(endLine ?? line ?? start);
  const replacementLines = String(suggestedText ?? '').replace(/\r\n/g, '\n').split('\n');

  if (start < 1 || end < start || start > lines.length) {
    throw new Error(`Invalid suggestion line range [${start}, ${end}] for file with ${lines.length} lines`);
  }

  const updated = [
    ...lines.slice(0, start - 1),
    ...replacementLines,
    ...lines.slice(end),
  ];

  return updated.join('\n') + (hadTrailingNewline ? '\n' : '');
}

/**
 * Tier 3 Resolution Plan:
 * Generates traceable commit trailer, GraphQL reply mutation, and optional thread resolution mutation.
 * Category C informational answers reply without committing or force-resolving the thread.
 */
export function buildThreadResolutionPlan(triagedThread, { commitSha = null, summary = '', answerBody = null } = {}) {
  const intent = triagedThread?.classification?.intent;
  const threadId = triagedThread.id;

  if (intent === 'INFORMATIONAL_QUESTION') {
    const replyBody = answerBody || summary || 'Answered in technical explanation above.';
    return {
      threadId,
      commitMessage: null,
      shouldResolve: false,
      replyMutation: {
        query: 'mutation ReplyThread($threadId: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) { comment { id } } }',
        variables: { threadId, body: replyBody },
      },
      resolveMutation: null,
    };
  }

  const shortSha = commitSha ? String(commitSha).slice(0, 7) : 'HEAD';
  const cleanSummary = summary || 'address PR review feedback';
  const commitMessage = `fix(review): ${cleanSummary} (ref: #${threadId})`;
  const replyBody = `Resolved in commit \`${shortSha}\`: ${cleanSummary}`;

  return {
    threadId,
    commitMessage,
    shouldResolve: true,
    replyMutation: {
      query: 'mutation ReplyThread($threadId: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) { comment { id } } }',
      variables: { threadId, body: replyBody },
    },
    resolveMutation: {
      query: 'mutation ResolveThread($threadId: ID!) { resolveReviewThread(input: { threadId: $threadId }) { thread { isResolved } } }',
      variables: { threadId },
    },
  };
}

/**
 * Enforces the Anti-Thrashing 3-Round Circuit Breaker:
 * If unresolved feedback persists beyond `maxRounds` (default: 3), halts automated mutation,
 * produces a structured synthesis report for Human Tech Lead adjudication, and attaches `asdlc:needs-human-arbitration`.
 */
export function checkAntiThrashingCircuitBreaker({
  currentRound = 1,
  maxRounds = 3,
  unresolvedThreads = [],
  changeId = 'unknown',
  prNumber = null,
} = {}) {
  if (currentRound <= maxRounds || unresolvedThreads.length === 0) {
    return {
      tripped: false,
      currentRound,
      maxRounds,
      remainingCount: unresolvedThreads.length,
    };
  }

  const prLabel = prNumber ? `PR #${prNumber}` : 'Active PR';
  const bullets = unresolvedThreads.map((t, idx) => {
    const loc = t.path ? `\`${t.path}${t.line ? `:${t.line}` : ''}\`` : 'General thread';
    const bodySnippet = String(t.latestBody ?? t.body ?? '').replace(/\s+/g, ' ').slice(0, 140);
    return `${idx + 1}. **${loc}** (thread \`${t.id || 'n/a'}\`, @${t.latestAuthor || 'reviewer'}): "${bodySnippet}"`;
  });

  const synthesisReport = [
    `## Escalation: Anti-Thrashing Circuit Breaker Tripped (${changeId})`,
    '',
    `- **PR**: ${prLabel}`,
    `- **Automated Rounds Attempted**: ${maxRounds} (Round ${currentRound} exceeded cap)`,
    `- **Status**: \`PAUSED_NEEDS_HUMAN_ARBITRATION\``,
    `- **Label Applied**: \`asdlc:needs-human-arbitration\``,
    '',
    '### Remaining Unresolved Review Threads',
    ...bullets,
    '',
    '> Automated edits have paused to prevent infinite feedback loops. Please review the remaining items above and post your adjudication.',
    '',
  ].join('\n');

  return {
    tripped: true,
    exitCode: 2,
    label: 'asdlc:needs-human-arbitration',
    status: 'PAUSED_NEEDS_HUMAN_ARBITRATION',
    currentRound,
    maxRounds,
    synthesisReport,
  };
}

function resolveOwnerRepo(repoRoot, explicitRepo = null) {
  if (explicitRepo) {
    const parsed = resolveGitHostAndRepo(explicitRepo, { repoRoot });
    return { owner: parsed.owner, repo: parsed.repo, host: parsed.host };
  }
  try {
    const gitRes = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: repoRoot, encoding: 'utf8', timeout: 5000 });
    if (gitRes.status === 0 && gitRes.stdout) {
      const parsed = resolveGitHostAndRepo(gitRes.stdout.trim(), { repoRoot });
      return { owner: parsed.owner, repo: parsed.repo, host: parsed.host };
    }
  } catch {
    // ignore
  }
  return { owner: null, repo: null, host: 'github.com' };
}

/**
 * Fetches full PR review context (review threads, issue comments, review decision) via GraphQL
 * using gh CLI or direct API fetchFn.
 */
export async function fetchGitHubPrReviewContext(prNumber, {
  repoRoot = process.cwd(),
  repo = null,
  host = null,
  env = process.env,
  fetchFn = null,
  ghRunner = null,
} = {}) {
  const num = Number(String(prNumber).replace(/^#/, ''));
  if (!Number.isFinite(num) || num <= 0) {
    return {};
  }

  const { owner, repo: repoName, host: targetHost } = resolveOwnerRepo(repoRoot, repo);
  const effectiveHost = host || targetHost || 'github.com';

  // 1. If fetchFn is provided, call GraphQL API directly
  if (typeof fetchFn === 'function') {
    const creds = await resolveGitCredentials({ env, host: effectiveHost, fetchFn });
    const apiEndpoint = effectiveHost === 'github.com' ? 'https://api.github.com/graphql' : `https://${effectiveHost}/api/graphql`;
    const headers = {
      Authorization: `Bearer ${creds?.token || ''}`,
      'Content-Type': 'application/json',
      'User-Agent': 'agentic-sdlc',
    };
    try {
      const res = await fetchFn(apiEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: PULL_REQUEST_THREADS_QUERY,
          variables: { owner: owner || 'unknown', repo: repoName || 'unknown', number: num },
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const pr = json?.data?.repository?.pullRequest;
        return {
          prNumber: num,
          headRefOid: pr?.headRefOid || null,
          reviewDecision: pr?.reviewDecision || null,
          reviewThreads: pr?.reviewThreads?.nodes || [],
          issueComments: [],
        };
      }
    } catch {
      // fallback
    }
  }

  // 2. Default: Use GitHub CLI (`gh api graphql`)
  try {
    const runGh = ghRunner || ((cmd, args) => spawnSync(cmd, args, { cwd: repoRoot, encoding: 'utf8', env, timeout: 15000 }));
    if (owner && repoName) {
      const gqlRes = runGh('gh', [
        'api',
        'graphql',
        '-H', 'Accept: application/vnd.github.v3+json',
        '-F', `owner=${owner}`,
        '-F', `repo=${repoName}`,
        '-F', `number=${num}`,
        '-f', `query=${PULL_REQUEST_THREADS_QUERY}`,
      ]);
      if (gqlRes && gqlRes.status === 0 && gqlRes.stdout) {
        const json = JSON.parse(gqlRes.stdout);
        const pr = json?.data?.repository?.pullRequest;
        const threads = pr?.reviewThreads?.nodes || [];
        const viewRes = runGh('gh', ['pr', 'view', String(num), '--json', 'title,headRefName,labels,state,comments']);
        let parsedView = {};
        if (viewRes && viewRes.status === 0 && viewRes.stdout) {
          parsedView = JSON.parse(viewRes.stdout);
        }
        return {
          prNumber: num,
          title: parsedView.title || null,
          headRefName: parsedView.headRefName || null,
          labels: parsedView.labels || [],
          state: parsedView.state || 'OPEN',
          headRefOid: pr?.headRefOid || null,
          reviewDecision: pr?.reviewDecision || null,
          reviewThreads: threads,
          issueComments: parsedView.comments || [],
        };
      }
    }

    // Fallback: gh pr view json if graphql fails
    const viewRes = runGh('gh', ['pr', 'view', String(num), '--json', 'title,headRefName,labels,state,comments']);
    if (viewRes && viewRes.status === 0 && viewRes.stdout) {
      const parsedView = JSON.parse(viewRes.stdout);
      return {
        prNumber: num,
        title: parsedView.title || null,
        headRefName: parsedView.headRefName || null,
        labels: parsedView.labels || [],
        state: parsedView.state || 'OPEN',
        reviewThreads: [],
        issueComments: parsedView.comments || [],
      };
    }
  } catch {
    // offline / missing gh
  }

  return { prNumber: num, reviewThreads: [], issueComments: [] };
}

/**
 * Replies to an inline PR review thread and resolves the conversation via GraphQL.
 */
export async function replyAndResolveGitHubThread(threadId, replyBody = '', options = {}) {
  let effectiveThreadId = threadId;
  let effectiveReplyBody = replyBody;
  let opts = options;

  if (typeof threadId === 'object' && threadId !== null) {
    effectiveThreadId = threadId.threadId || threadId.id;
    effectiveReplyBody = threadId.replyBody || threadId.body || '';
    opts = { ...threadId, ...options };
  }

  if (!effectiveThreadId) return { ok: false };
  const {
    repoRoot = process.cwd(),
    host = 'github.com',
    env = process.env,
    fetchFn = null,
    ghRunner = null,
  } = opts;

  const replyMutation = 'mutation ReplyThread($threadId: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) { comment { id } } }';
  const resolveMutation = 'mutation ResolveThread($threadId: ID!) { resolveReviewThread(input: { threadId: $threadId }) { thread { isResolved } } }';

  if (typeof fetchFn === 'function') {
    const creds = await resolveGitCredentials({ env, host, fetchFn });
    const apiEndpoint = host === 'github.com' ? 'https://api.github.com/graphql' : `https://${host}/api/graphql`;
    const headers = { Authorization: `Bearer ${creds?.token || ''}`, 'Content-Type': 'application/json' };
    try {
      await fetchFn(apiEndpoint, { method: 'POST', headers, body: JSON.stringify({ query: replyMutation, variables: { threadId: effectiveThreadId, body: effectiveReplyBody } }) });
      await fetchFn(apiEndpoint, { method: 'POST', headers, body: JSON.stringify({ query: resolveMutation, variables: { threadId: effectiveThreadId } }) });
      return { ok: true, replied: true, resolved: true, threadId: effectiveThreadId };
    } catch {
      return { ok: false, threadId: effectiveThreadId };
    }
  }

  try {
    const runGh = ghRunner || ((cmd, args) => spawnSync(cmd, args, { cwd: repoRoot, encoding: 'utf8', env, timeout: 15000 }));
    runGh('gh', ['api', 'graphql', '-f', `query=${replyMutation}`, '-F', `threadId=${effectiveThreadId}`, '-F', `body=${effectiveReplyBody}`]);
    runGh('gh', ['api', 'graphql', '-f', `query=${resolveMutation}`, '-F', `threadId=${effectiveThreadId}`]);
    return { ok: true, replied: true, resolved: true, threadId: effectiveThreadId };
  } catch {
    return { ok: false, threadId: effectiveThreadId };
  }
}

