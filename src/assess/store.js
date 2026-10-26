import path from 'node:path';
import YAML from 'yaml';
import { exists, readText, writeText, ensureDir } from '../lib/fs.js';
import { changeDir } from '../lib/paths.js';
import { computeRecordHash, validateRecordSchema, validateChainInvariants } from './schema.js';

export const HISTORY_FILE = 'risk-history.jsonl';
export const SNAPSHOT_FILE = 'risk-assessment.yaml';

/**
 * Loads all historical assessment records for a change.
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
      // Ignore corrupt line or let invariant catch it
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
 * Appends an assessment record to risk-history.jsonl and overwrites risk-assessment.yaml snapshot.
 */
export function appendAssessmentRecord(repoRoot, changeId, recordData) {
  const cdir = changeDir(repoRoot, changeId);
  ensureDir(cdir);

  const history = loadRiskHistory(repoRoot, changeId);
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

  // 1. Append to JSONL history
  const histPath = path.join(cdir, HISTORY_FILE);
  const line = JSON.stringify(record) + '\n';
  const existing = exists(histPath) ? readText(histPath) : '';
  writeText(histPath, existing + line);

  // 2. Overwrite human-readable YAML snapshot
  const snapPath = path.join(cdir, SNAPSHOT_FILE);
  const yamlText = `# ASdlc Latest Risk Assessment Snapshot\n# Generated at: ${record.timestamp}\n# Change: ${changeId} (seq: ${record.seq})\n\n` + YAML.stringify(record);
  writeText(snapPath, yamlText);

  return record;
}
