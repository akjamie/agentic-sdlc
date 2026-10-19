import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintSpecText, countBlockers } from '../src/lib/speclint.js';

const GOOD = `# Spec Delta

## Purpose
This capability lets learners export their data in a portable and verifiable format.

## ADDED Requirements

### Requirement: Export
The system SHALL export data as a signed CSV.

#### Scenario: Export succeeds
- **GIVEN** a logged-in learner
- **WHEN** the learner taps Export
- **THEN** a signed CSV download starts

**Acceptance criteria**
- [ ] AC1: starts a CSV download (test: ui/test/export.spec)
- [ ] AC2: the file is signed (test: ui/test/sign.spec)

## Test Strategy
Unit tests for serialization, a UI test for the download, and a signature verification test.
`;

const codes = (text) => lintSpecText(text).map((f) => f.code);

test('a well-formed spec has zero findings', () => {
  assert.deepEqual(lintSpecText(GOOD), []);
  assert.equal(countBlockers(lintSpecText(GOOD)), 0);
});

test('R1: missing/short Purpose', () => {
  assert.ok(codes(GOOD.replace(/## Purpose\n[^\n]+/, '## Purpose\nToo short.')).includes('R1-purpose'));
});

test('R7: missing Test Strategy', () => {
  const t = GOOD.replace(/## Test Strategy[\s\S]*$/, '');
  assert.ok(codes(t).includes('R7-test-strategy'));
});

test('R2: requirement without SHALL/MUST', () => {
  assert.ok(codes(GOOD.replace('The system SHALL export', 'The system exports')).includes('R2-normative'));
});

test('R3: requirement without a scenario', () => {
  const t = GOOD.replace(/#### Scenario:[\s\S]*?\n\n\*\*Acceptance/, '**Acceptance');
  assert.ok(codes(t).includes('R3-scenario'));
});

test('R4: scenario missing THEN / GIVEN', () => {
  assert.ok(codes(GOOD.replace('- **THEN** a signed CSV download starts', '- download starts')).includes('R4-then'));
  assert.ok(codes(GOOD.replace('- **GIVEN** a logged-in learner\n', '')).includes('R4-given'));
});

test('R5: requirement without acceptance criteria', () => {
  const t = GOOD.replace(/\*\*Acceptance criteria\*\*[\s\S]*?\n\n## Test/, '## Test');
  assert.ok(codes(t).includes('R5-ac'));
});

test('R5: requirement has more scenarios than acceptance criteria (R5-scenario-coverage)', () => {
  const extraScenarios = `#### Scenario: Edge case 1
- **GIVEN** an error state
- **WHEN** export fails
- **THEN** error is logged

#### Scenario: Edge case 2
- **GIVEN** timeout
- **WHEN** export takes too long
- **THEN** warning is displayed
`;
  const t = GOOD.replace('#### Scenario: Export succeeds', `${extraScenarios}\n#### Scenario: Export succeeds`);
  assert.ok(codes(t).includes('R5-scenario-coverage'));
});

test('R6: AC without a (test: ...) mapping', () => {
  const t = GOOD.replace('(test: ui/test/export.spec)', '');
  assert.ok(codes(t).includes('R6-ac-test'));
});

test('stable: identical input yields identical, sorted findings', () => {
  const a = lintSpecText(GOOD.replace('(test: ui/test/export.spec)', ''));
  const b = lintSpecText(GOOD.replace('(test: ui/test/export.spec)', ''));
  assert.deepEqual(a, b);
  const keys = a.map((f) => `${f.location}||${f.code}||${f.message}`);
  assert.deepEqual(keys, [...keys].sort());
});

test('REMOVED requirement needs a Reason (R8, major)', () => {
  const t = `${GOOD}\n## REMOVED Requirements\n\n### Requirement: Legacy\nNo reason here.\n`;
  assert.ok(codes(t).includes('R8-removed-reason'));
});
