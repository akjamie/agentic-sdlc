export const SECRET_PATTERNS = [
  // Cloud AKs
  { name: 'ALIBABA_AK', pattern: /\bLTAI[0-9A-Za-z]{12,20}\b/, redact: (s) => `${s.slice(0, 4)}****` },
  { name: 'AWS_AK', pattern: /\bAKIA[0-9A-Z]{16}\b/, redact: (s) => `${s.slice(0, 4)}****` },
  { name: 'TENCENT_AK', pattern: /\bAKID[0-9A-Za-z]{13,20}\b/, redact: (s) => `${s.slice(0, 4)}****` },
  // Private keys
  { name: 'PRIVATE_KEY', pattern: /-----BEGIN (?:RSA|EC|OPENSSH|DSA|PRIVATE) .*PRIVATE KEY-----/, redact: () => '-----BEGIN PRIVATE KEY-----****' },
  // Platform tokens
  { name: 'GITHUB_PAT', pattern: /\b(?:ghp_[0-9A-Za-z]{36}|github_pat_[0-9A-Za-z_]{50,})\b/, redact: (s) => `${s.slice(0, 4)}****` },
  { name: 'SLACK_TOKEN', pattern: /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/, redact: (s) => `${s.slice(0, 5)}****` },
  { name: 'OPENAI_TOKEN', pattern: /\bsk-[A-Za-z0-9]{20,}\b/, redact: (s) => `${s.slice(0, 3)}****` },
  // Secret assignments & connection strings with plaintext passwords
  { name: 'SECRET_ASSIGNMENT', pattern: /(?:access[-_]?key[-_]?secret|secret[-_]?key|private[-_]?key)\s*[:=]\s*['"]?([A-Za-z0-9+/=_-]{16,})['"]?/i, redact: () => 'secret_key=****' },
  { name: 'JDBC_PASSWORD', pattern: /jdbc:.*password=([^\s;&'"]+)/i, redact: () => 'jdbc:...password=****' },
  { name: 'MONGO_PASSWORD', pattern: /mongodb(?:\+srv)?:\/\/[^:]+:([^@\s]+)@/i, redact: () => 'mongodb://...:****@' },
];

export const IGNORE_SECRET_INTERPOLATION = /\$\{[^}]+\}|\{\{[^}]+\}|\$[A-Z0-9_]+|ENC\([^)]+\)|vault:|kms:|<YOUR_|<CHANGE_ME>|\b(?:dummy|mock)\b/i;

export function scanDiffForSecrets(diffOrText) {
  if (!diffOrText || typeof diffOrText !== 'string') return [];
  const findings = [];
  const lines = diffOrText.split('\n');
  for (let idx = 0; idx < lines.length; idx += 1) {
    const rawLine = lines[idx];
    // In diff mode, only scan added '+' lines (not +++ headers)
    const content = rawLine.startsWith('+') && !rawLine.startsWith('+++') ? rawLine.slice(1) : rawLine;
    if (IGNORE_SECRET_INTERPOLATION.test(content)) continue;
    for (const rule of SECRET_PATTERNS) {
      const m = content.match(rule.pattern);
      if (m) {
        findings.push({
          rule: rule.name,
          redacted: rule.redact(m[0]),
          line: idx + 1,
        });
      }
    }
  }
  return findings;
}
