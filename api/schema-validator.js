/**
 * CYBERVPS SPACE STATION - API SCHEMA VALIDATOR & RFC 7807 ERROR HANDLER
 * High-performance input validation and RFC 7807 Problem Details formatting
 */

class SchemaValidator {
  /**
   * Validate request data against validation rules
   * @param {Object} data - Input data (query, body, params)
   * @param {Object} schema - Validation schema rules
   */
  static validateData(data, schema) {
    const errors = [];

    if (!schema || typeof schema !== 'object') {
      return { valid: true };
    }

    // Check required fields
    if (Array.isArray(schema.required)) {
      for (const field of schema.required) {
        if (data[field] === undefined || data[field] === null || data[field] === '') {
          errors.push({
            name: field,
            reason: `Field '${field}' is strictly required.`
          });
        }
      }
    }

    // Check property types and constraints
    if (schema.properties) {
      for (const [key, rules] of Object.entries(schema.properties)) {
        const val = data[key];
        if (val === undefined || val === null) continue;

        if (rules.type) {
          switch (rules.type) {
            case 'string':
              if (typeof val !== 'string') {
                errors.push({ name: key, reason: `Field '${key}' must be a string.` });
              } else if (rules.enum && !rules.enum.includes(val)) {
                errors.push({ name: key, reason: `Field '${key}' must be one of [${rules.enum.join(', ')}].` });
              }
              break;
            case 'integer':
            case 'number':
              if (typeof val !== 'number' && isNaN(Number(val))) {
                errors.push({ name: key, reason: `Field '${key}' must be a valid number.` });
              }
              break;
            case 'boolean':
              if (typeof val !== 'boolean' && val !== 'true' && val !== 'false' && val !== 0 && val !== 1) {
                errors.push({ name: key, reason: `Field '${key}' must be a boolean.` });
              }
              break;
            case 'array':
              if (!Array.isArray(val)) {
                errors.push({ name: key, reason: `Field '${key}' must be an array.` });
              }
              break;
            case 'object':
              if (typeof val !== 'object' || Array.isArray(val)) {
                errors.push({ name: key, reason: `Field '${key}' must be an object.` });
              }
              break;
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Express / HTTP middleware for schema validation
   */
  static middleware(schema = {}) {
    return (req, res, next) => {
      const data = {
        ...(req.query || {}),
        ...(req.body || {}),
        ...(req.params || {})
      };

      const result = SchemaValidator.validateData(data, schema);
      if (!result.valid) {
        return res.writeHead(400, { 'Content-Type': 'application/problem+json' }).end(
          JSON.stringify(SchemaValidator.formatProblemDetails('Validation Failed', 400, 'One or more request parameters failed validation.', result.errors))
        );
      }
      next();
    };
  }

  /**
   * Format RFC 7807 Problem Details
   */
  static formatProblemDetails(title, status, detail, invalidParams = []) {
    return {
      type: 'https://cybervps.dev/errors/validation',
      title,
      status,
      detail,
      invalid_params: invalidParams,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = SchemaValidator;
