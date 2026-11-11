/**
 * Typed application errors. Controllers/services throw these; the central error handler maps them to
 * HTTP responses — replacing the previous pattern of string-matching on error.message.
 */
class AppError extends Error {
  constructor(message, status = 500, code = "INTERNAL_ERROR", details) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

class BadRequestError extends AppError {
  constructor(message = "Bad request", details) {
    super(message, 400, "BAD_REQUEST", details);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, 401, "UNAUTHORIZED");
  }
}

class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, 404, "NOT_FOUND");
  }
}

class TooManyRequestsError extends AppError {
  constructor(message = "Too many requests") {
    super(message, 429, "RATE_LIMITED");
  }
}

class ServiceUnavailableError extends AppError {
  constructor(message = "Service unavailable") {
    super(message, 503, "SERVICE_UNAVAILABLE");
  }
}

module.exports = {
  AppError,
  BadRequestError,
  UnauthorizedError,
  NotFoundError,
  TooManyRequestsError,
  ServiceUnavailableError,
};
