import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists, readText } from '../lib/fs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCHEMA_PATH = path.resolve(__dirname, '../../assets/schema/risk-assessment.schema.json');

/**
 * Canonicalize JSON according to RFC 8785 (JCS principles):
 * Deterministic key sorting, compact representation, no extra whitespace.
 */
export function canonicalJson(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k]));
  return '{' + pairs.join(',') + '}';
}

/**
 * Computes sha256 hash of a record excluding the 'hash' field itself.
 */
export function computeRecordHash(record) {
  const clone = { ...record };
  delete clone.hash;
  const canonical = canonicalJson(clone);
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Validates a single record against the JSON Schema principles.
 * Returns { valid: boolean, errors: string[] }
 */
export function validateRecordSchema(record) {
  const errors = [];
  if (!record || typeof record !== 'object') {
    return { valid: false, errors: ['Record must be an object'] };
  }

  const requiredFields = [
    'schema_version', 'change_id', 'seq', 'prev_hash', 'hash',
    'timestamp', 'actor', 'stage', 'role', 'status', 'verdict',
    'change_type', 'source', 'risk', 'vectors', 'governance',
    'reason_codes', 'transition'
  ];

  for (const f of requiredFields) {
    if (record[f] === undefined) {
      errors.push(`Missing required field: ${f}`);
    }
  }

  if (record.schema_version !== 1) {
    errors.push(`schema_version must be 1, got ${record.schema_version}`);
  }

  const validLevels = ['L0', 'L1', 'L2', 'L3'];
  if (record.risk && !validLevels.includes(record.risk.level)) {
    errors.push(`Invalid risk level: ${record.risk.level}`);
  }

  const validTypes = ['chore', 'fix', 'change', 'feature'];
  if (!validTypes.includes(record.change_type)) {
    errors.push(`Invalid change_type: ${record.change_type}`);
  }

  const validStages = ['new', 'spec', 'impl'];
  if (!validStages.includes(record.stage)) {
    errors.push(`Invalid stage: ${record.stage}`);
  }

  const validStatuses = ['provisional', 'needs_input', 'ready', 'defaulted'];
  if (!validStatuses.includes(record.status)) {
    errors.push(`Invalid status: ${record.status}`);
  }

  if (record.status === 'defaulted' && !record.defaulted_cause) {
    errors.push('status defaulted requires non-null defaulted_cause');
  }

  if (record.hash && computeRecordHash(record) !== record.hash) {
    errors.push(`Hash mismatch: computed ${computeRecordHash(record)} vs declared ${record.hash}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validates a sequence of historical records (Cross-Record Invariants §8.3):
 * 1. seq is continuous starting from 1
 * 2. prev_hash equals previous record's hash (first record is null)
 * 3. Level only increases (monotonic) unless waiver or recovered_from_default
 */
export function validateChainInvariants(records = []) {
  const errors = [];
  if (!Array.isArray(records) || records.length === 0) {
    return { valid: false, errors: ['History is empty'] };
  }

  const rank = { L0: 0, L1: 1, L2: 2, L3: 3 };

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const expectedSeq = i + 1;
    if (rec.seq !== expectedSeq) {
      errors.push(`Record at index ${i} has seq ${rec.seq}, expected ${expectedSeq}`);
    }

    if (i === 0) {
      if (rec.prev_hash !== null) {
        errors.push(`Initial record must have prev_hash: null, got ${rec.prev_hash}`);
      }
    } else {
      const prev = records[i - 1];
      if (rec.prev_hash !== prev.hash) {
        errors.push(`Record ${rec.seq} prev_hash (${rec.prev_hash}) does not match previous hash (${prev.hash})`);
      }

      const prevRank = rank[prev.risk.level] ?? 1;
      const curRank = rank[rec.risk.level] ?? 1;
      const allowedDemote = Boolean(rec.transition?.waiver || rec.transition?.recovered_from_default);

      if (curRank < prevRank && !allowedDemote) {
        errors.push(`Illegal demotion from ${prev.risk.level} to ${rec.risk.level} without waiver or default recovery`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
