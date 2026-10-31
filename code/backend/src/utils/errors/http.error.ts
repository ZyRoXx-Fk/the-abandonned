import { ApiError } from "./api.error.js";
export { ApiError };

export class NotFound extends ApiError {
  constructor(message: string = "Resource not found") {
    super(404, message);
    this.name = "NotFound";
  }
}

export class BadRequest extends ApiError {
  constructor(message: string = "Bad request") {
    super(400, message);
    this.name = "BadRequest";
  }
}

export class Unauthorized extends ApiError {
  constructor(message: string = "Unauthorized") {
    super(401, message);
    this.name = "Unauthorized";
  }
}

export class Forbidden extends ApiError {
  constructor(message: string = "Forbidden") {
    super(403, message);
    this.name = "Forbidden";
  }
}

export class Conflict extends ApiError {
  constructor(message: string = "Conflict") {
    super(409, message);
    this.name = "Conflict";
  }
}

export class InternalServerError extends ApiError {
  constructor(message: string = "Internal server error") {
    super(500, message);
    this.name = "InternalServerError";
  }
}

export class ServiceUnavailable extends ApiError {
  constructor(message: string = "Service unavailable") {
    super(503, message);
    this.name = "ServiceUnavailable";
  }
}
