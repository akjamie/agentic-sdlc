import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PULL_REQUEST_THREADS_QUERY,
  extractAddressedThreadIds,
  isBotOrSelfAuthor,
  filterUnaddressedThreads,
  classifyReviewComment,
  triagePullRequest,
  applySuggestionToLines,
  buildThreadResolutionPlan,
  checkAntiThrashingCircuitBreaker,
} from '../src/lib/triage.js';

test('Tier 1 filtering: ignores resolved, commit-trailer-addressed, and bot threads; captures human COMMENTED reviews', () => {
  assert.match(PULL_REQUEST_THREADS_QUERY, /reviewThreads\(first: 100\)/);

  const commitMessages = ['fix(auth): handle edge case (ref: #PRRT_already_done)'];
  assert.deepEqual([...extractAddressedThreadIds(commitMessages)], ['PRRT_already_done']);
  assert.equal(isBotOrSelfAuthor('github-actions[bot]'), true);
  assert.equal(isBotOrSelfAuthor('asdlc-bot'), true);
  assert.equal(isBotOrSelfAuthor('alice-reviewer'), false);

  const threads = [
    {
      id: 'PRRT_resolved',
      isResolved: true,
      path: 'src/a.js',
      line: 10,
      comments: { nodes: [{ author: { login: 'alice' }, body: 'Fix this' }] },
    },
    {
      id: 'PRRT_already_done',
      isResolved: false,
      path: 'src/a.js',
      line: 12,
      comments: { nodes: [{ author: { login: 'alice' }, body: 'Fix edge case' }] },
    },
    {
      id: 'PRRT_bot_reply',
      isResolved: false,
      path: 'src/a.js',
      line: 15,
      comments: {
        nodes: [
          { author: { login: 'alice' }, body: 'Fix X' },
          { author: { login: 'asdlc-bot[bot]' }, body: 'Fixed X' },
        ],
      },
    },
    {
      id: 'PRRT_human_open',
      isResolved: false,
      path: 'src/auth.js',
      line: 42,
      comments: { nodes: [{ author: { login: 'bob-tl' }, body: 'Please add null check here' }] },
    },
  ];

  const unaddressed = filterUnaddressedThreads(threads, { commitMessages });
  assert.equal(unaddressed.length, 1);
  assert.equal(unaddressed[0].id, 'PRRT_human_open');
  assert.equal(unaddressed[0].latestAuthor, 'bob-tl');
});

test('Tier 2 classification: accurately classifies Categories A, B, C, D and enforces Conservative Intent Invariant on mixed signals', () => {
  // Category A: Explicit imperative
  const catA = classifyReviewComment('Please add a test for null user token');
  assert.equal(catA.category, 'A');
  assert.equal(catA.intent, 'ACTION_REQUIRED');
  assert.equal(catA.requiresCodeOrSpecEdit, true);

  // Conservative Intent Invariant: LGTM + action demand MUST NOT drop
  const mixed = classifyReviewComment('LGTM, but please fix the missing null check on line 18');
  assert.equal(mixed.category, 'A');
  assert.equal(mixed.intent, 'ACTION_REQUIRED');
  assert.equal(mixed.actionable, true);

  // Category B: Suggestion block
  const catB = classifyReviewComment('Use const here:\n```suggestion\nconst timeoutMs = 5000;\n```', { path: 'src/cfg.js', line: 3 });
  assert.equal(catB.category, 'B');
  assert.equal(catB.intent, 'SUGGESTION_BLOCK');
  assert.equal(catB.suggestedText, 'const timeoutMs = 5000;');

  // Category C: Informational question (zero code mutation)
  const catC = classifyReviewComment('Why did we choose SHA256 over HMAC here?');
  assert.equal(catC.category, 'C');
  assert.equal(catC.intent, 'INFORMATIONAL_QUESTION');
  assert.equal(catC.requiresCodeOrSpecEdit, false);

  // Category D: Non-actionable praise
  const catD = classifyReviewComment('Looks good to me!');
  assert.equal(catD.category, 'D');
  assert.equal(catD.intent, 'NON_ACTIONABLE');
  assert.equal(catD.actionable, false);
});

test('triagePullRequest: flags hasHumanFeedback even when reviewDecision is COMMENTED (never missed)', () => {
  const result = triagePullRequest({
    reviewDecision: 'COMMENTED',
    reviewThreads: {
      nodes: [
        {
          id: 'PRRT_1',
          isResolved: false,
          path: 'src/api.js',
          line: 20,
          comments: { nodes: [{ author: { login: 'reviewer1' }, body: 'Should throw 404 instead of 500' }] },
        },
        {
          id: 'PRRT_2',
          isResolved: false,
          path: 'src/api.js',
          line: 30,
          comments: { nodes: [{ author: { login: 'reviewer2' }, body: 'Nice approach!' }] },
        },
      ],
    },
  });

  assert.equal(result.hasHumanFeedback, true);
  assert.equal(result.requiresFixCommit, true);
  assert.equal(result.actionableThreads.length, 1);
  assert.equal(result.nonActionableThreads.length, 1);
});

test('Tier 3 resolution: applies Category B suggestion patch, builds GraphQL reply/resolve mutations, and leaves Category C unresolved', () => {
  const original = 'let timeout = 1000;\nexport default timeout;\n';
  const patched = applySuggestionToLines(original, { line: 1, suggestedText: 'const timeout = 5000;' });
  assert.equal(patched, 'const timeout = 5000;\nexport default timeout;\n');

  const planB = buildThreadResolutionPlan({
    id: 'PRRT_sugg_1',
    classification: { intent: 'SUGGESTION_BLOCK' },
  }, { commitSha: 'abcdef123456', summary: 'apply timeout suggestion' });
  assert.match(planB.commitMessage, /\(ref: #PRRT_sugg_1\)/);
  assert.equal(planB.shouldResolve, true);
  assert.equal(planB.resolveMutation.variables.threadId, 'PRRT_sugg_1');

  const planC = buildThreadResolutionPlan({
    id: 'PRRT_q_1',
    classification: { intent: 'INFORMATIONAL_QUESTION' },
  }, { answerBody: 'SHA256 matches content-addressable storage requirements.' });
  assert.equal(planC.commitMessage, null);
  assert.equal(planC.shouldResolve, false);
  assert.equal(planC.resolveMutation, null);
  assert.match(planC.replyMutation.variables.body, /content-addressable/);
});

test('Anti-Thrashing Circuit Breaker: allows rounds 1-3 and trips cleanly on round 4 with human arbitration escalation', () => {
  const unresolved = [
    { id: 'PRRT_loop', path: 'src/service.js', line: 88, latestAuthor: 'lead', latestBody: 'Still failing concurrency check' },
  ];

  for (const round of [1, 2, 3]) {
    const res = checkAntiThrashingCircuitBreaker({ currentRound: round, maxRounds: 3, unresolvedThreads: unresolved, changeId: 'feat-auth', prNumber: 42 });
    assert.equal(res.tripped, false);
  }

  const tripped = checkAntiThrashingCircuitBreaker({ currentRound: 4, maxRounds: 3, unresolvedThreads: unresolved, changeId: 'feat-auth', prNumber: 42 });
  assert.equal(tripped.tripped, true);
  assert.equal(tripped.exitCode, 2);
  assert.equal(tripped.label, 'asdlc:needs-human-arbitration');
  assert.equal(tripped.status, 'PAUSED_NEEDS_HUMAN_ARBITRATION');
  assert.match(tripped.synthesisReport, /Anti-Thrashing Circuit Breaker Tripped/);
  assert.match(tripped.synthesisReport, /PRRT_loop/);
});

