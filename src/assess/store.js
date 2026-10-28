import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { exists, readText, writeText, ensureDir } from '../lib/fs.js';
import { changeDir } from '../lib/paths.js';
import { computeRecordHash, validateRecordSchema, validateChainInvariants } from './schema.js';

export const HISTORY_FILE = 'risk-history.jsonl';
export const SNAPSHOT_FILE = 'risk-assessment.yaml';

/**
 * Loads all historical assessment records for a change.
 * Enforces fail-closed chain validation on read (P1-3).
 */
export function loadRiskHistory(repoRoot, changeId) {
  if (!repoRoot || !changeId) return [];
  const cdir = changeDir(repoRoot, changeId);
  const p = path.join(cdir, HISTORY_FILE);
  if (!exists(p)) return [];

  const lines = readText(p).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const records = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line));
    } catch {
      const err = new Error(`Corrupted JSON in risk history line for ${changeId}`);
      err.code = 'TAMPER_DETECTED';
      throw err;
    }
  }

  if (records.length > 0) {
    const chainCheck = validateChainInvariants(records);
    if (!chainCheck.valid) {
      const err = new Error(`Risk history tamper detected for ${changeId}: ${chainCheck.errors.join('; ')}`);
      err.code = 'TAMPER_DETECTED';
      throw err;
    }
  }

  return records;
}

/**
 * Loads the latest assessment record for a change.
 */
export function loadLatestAssessment(repoRoot, changeId) {
  const history = loadRiskHistory(repoRoot, changeId);
  return history.length > 0 ? history[history.length - 1] : null;
}

/**
 * Loads the initial baseline assessment record for a change (seq: 1).
 */
export function loadInitialAssessment(repoRoot, changeId) {
  const history = loadRiskHistory(repoRoot, changeId);
  return history.length > 0 ? history[0] : null;
}

/**
 * Loads the maximum risk level recorded in history.
 */
export function loadMaxHistoryLevel(repoRoot, changeId) {
  const history = loadRiskHistory(repoRoot, changeId);
  if (history.length === 0) return null;
  const rank = { L0: 0, L1: 1, L2: 2, L3: 3 };
  let maxLvl = history[0].risk?.level || 'L1';
  for (const h of history) {
    const lvl = h.risk?.level;
    if (lvl && (rank[lvl] ?? 1) > (rank[maxLvl] ?? 1)) {
      maxLvl = lvl;
    }
  }
  return maxLvl;
}

/**
 * Appends an assessment record to risk-history.jsonl and overwrites risk-assessment.yaml snapshot.
 */
export function appendAssessmentRecord(repoRoot, changeId, recordData) {
  const cdir = changeDir(repoRoot, changeId);
  ensureDir(cdir);

  const history = loadRiskHistory(repoRoot, changeId);

  // Deduplicate consecutive identical stage evaluations to prevent log bloat
  if (history.length > 0) {
    const prev = history[history.length - 1];
    if (
      prev.stage === recordData.stage &&
      prev.risk?.level === recordData.risk?.level &&
      prev.verdict === recordData.verdict &&
      JSON.stringify(prev.reason_codes || []) === JSON.stringify(recordData.reason_codes || [])
    ) {
      return prev;
    }
  }

  const seq = history.length + 1;
  const prev_hash = history.length > 0 ? history[history.length - 1].hash : null;

  const record = {
    schema_version: 1,
    change_id: changeId,
    seq,
    prev_hash,
    ...recordData
  };

  // Compute immutable sha256 hash
  record.hash = computeRecordHash(record);

  // Validate single record schema
  const schemaCheck = validateRecordSchema(record);
  if (!schemaCheck.valid) {
    throw new Error(`Schema validation failed: ${schemaCheck.errors.join('; ')}`);
  }

  // Validate chain invariant
  const newChain = [...history, record];
  const chainCheck = validateChainInvariants(newChain);
  if (!chainCheck.valid) {
    throw new Error(`Chain invariant validation failed: ${chainCheck.errors.join('; ')}`);
  }

  // 1. Append to JSONL history atomically (P2-3)
  const histPath = path.join(cdir, HISTORY_FILE);
  const line = JSON.stringify(record) + '\n';
  fs.appendFileSync(histPath, line, 'utf8');

  // 2. Overwrite human-readable YAML snapshot
  const snapPath = path.join(cdir, SNAPSHOT_FILE);
  const yamlText = `# ASdlc Latest Risk Assessment Snapshot\n# Generated at: ${record.timestamp}\n# Change: ${changeId} (seq: ${record.seq})\n\n` + YAML.stringify(record);
  writeText(snapPath, yamlText);

  return record;
}
