export class AsdlcError extends Error {
  constructor(message, { code = 'ASDLC_ERROR', exitCode = 1, detail, hint } = {}) {
    super(message);
    this.name = 'AsdlcError';
    this.code = code;
    this.exitCode = exitCode;
    this.detail = detail;
    this.hint = hint;
  }
}

export function fail(message, opts) {
  throw new AsdlcError(message, opts);
}

export function assert(condition, message, opts) {
  if (!condition) fail(message, opts);
}
