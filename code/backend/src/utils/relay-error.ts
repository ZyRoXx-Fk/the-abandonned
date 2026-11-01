import type { RelayErrorCode } from "../schemas/relay.schema.js";

export class RelayError extends Error {
  public readonly code: RelayErrorCode;
  public readonly details?: unknown;

  constructor(code: RelayErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "RelayError";
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, RelayError);
  }
}
