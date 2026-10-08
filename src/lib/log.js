const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

const paint = (code, text) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);

export const log = {
  info: (msg = '') => process.stdout.write(`${msg}\n`),
  step: (msg) => process.stdout.write(`${paint(36, '•')} ${msg}\n`),
  ok: (msg) => process.stdout.write(`${paint(32, '\u2713')} ${msg}\n`),
  warn: (msg) => process.stderr.write(`${paint(33, '!')} ${msg}\n`),
  error: (msg) => process.stderr.write(`${paint(31, '\u00d7')} ${msg}\n`),
  plain: (msg) => process.stdout.write(`${msg}\n`),
};

export const dim = (text) => paint(90, text);
export const bold = (text) => paint(1, text);
