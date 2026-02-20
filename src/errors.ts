/**
 * Base error class for all errors originating from the FileMaker IdP package.
 */
export class FileMakerIdPError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileMakerIdPError";
    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when FileMaker Server rejects credentials (HTTP 401) or when
 * the user's credentials cannot be validated.
 */
export class FileMakerAuthError extends FileMakerIdPError {
  constructor(message = "Invalid FileMaker credentials") {
    super(message);
    this.name = "FileMakerAuthError";
  }
}

/**
 * Thrown when a Data API query fails (e.g. layout not found, no records returned,
 * unexpected response shape).
 */
export class FileMakerQueryError extends FileMakerIdPError {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "FileMakerQueryError";
    this.statusCode = statusCode;
  }
}

/**
 * Thrown by `loadConfigFromEnv()` when required environment variables are missing
 * or have invalid values.
 */
export class ConfigurationError extends FileMakerIdPError {
  public readonly missingVars: string[];

  constructor(missingVars: string[]) {
    super(
      `Missing required environment variables: ${missingVars.join(", ")}`
    );
    this.name = "ConfigurationError";
    this.missingVars = missingVars;
  }
}
