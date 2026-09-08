/**
 * Date-Restricted License Key Logic (extracted for testing)
 * 
 * This module re-implements the date-restricted license generation logic
 * from app.js in a testable manner using Node.js crypto module.
 */
import { createHmac } from 'crypto';

/**
 * Validates that a date string is in ISO 8601 date format (YYYY-MM-DD)
 * and represents a real calendar date.
 * Mirrors isValidISODate() in app.js.
 * 
 * @param {string} dateStr - The date string to validate
 * @returns {boolean} True if valid ISO date format
 */
export function isValidISODate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  var regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;
  var parts = dateStr.split('-');
  var year = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10);
  var day = parseInt(parts[2], 10);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  var d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

/**
 * Validates date-restricted license inputs.
 * Mirrors validateDateRestrictedInputs() in app.js.
 * 
 * @param {string} fromDate - The "Valid From" date (YYYY-MM-DD)
 * @param {string} toDate - The "Valid To" date (YYYY-MM-DD)
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateDateRestrictedInputs(fromDate, toDate) {
  if (!fromDate) {
    return { valid: false, error: 'Please enter a Valid From date.' };
  }
  if (!toDate) {
    return { valid: false, error: 'Please enter a Valid To date.' };
  }
  if (!isValidISODate(fromDate)) {
    return { valid: false, error: 'Please enter a valid date.' };
  }
  if (!isValidISODate(toDate)) {
    return { valid: false, error: 'Please enter a valid date.' };
  }
  // toDate must be on or after fromDate (same-day licenses are valid)
  if (toDate < fromDate) {
    return { valid: false, error: 'Valid To date must be on or after the Valid From date.' };
  }
  return { valid: true };
}

/**
 * Converts an array of character codes to a string.
 * Mirrors _getSecretFromCodes() in app.js.
 * 
 * @param {number[]} codes - Array of character codes
 * @returns {string} The decoded secret string
 */
export function getSecretFromCodes(codes) {
  return codes.map(function(c) { return String.fromCharCode(c); }).join('');
}

/**
 * Computes HMAC-SHA256 hex digest for a message using a secret key (char codes).
 * Mirrors hmacHex() in app.js but uses Node.js crypto instead of Web Crypto API.
 * 
 * @param {string} message - The message to sign
 * @param {number[]} secretCodes - Array of character codes for the secret key
 * @returns {string} Hex-encoded HMAC-SHA256 digest (64 characters)
 */
export function hmacHex(message, secretCodes) {
  var secret = getSecretFromCodes(secretCodes);
  var hmac = createHmac('sha256', secret);
  hmac.update(message, 'utf8');
  return hmac.digest('hex');
}

/**
 * Generates a perpetual license key.
 * Mirrors generateLicense() in app.js.
 * 
 * Computes HMAC-SHA256 over the user name only,
 * builds payload { n: name, h: hmacHex },
 * and returns base64-encoded JSON payload.
 * 
 * @param {string} name - User name
 * @param {number[]} secretCodes - Array of character codes for HMAC secret
 * @returns {string} Base64-encoded JSON payload
 */
export function generateLicense(name, secretCodes) {
  var hash = hmacHex(name, secretCodes);
  var payload = JSON.stringify({ n: name, h: hash });
  return btoa(payload);
}

/**
 * Generates a date-restricted license key.
 * Mirrors generateDateRestrictedLicense() in app.js.
 * 
 * Computes HMAC-SHA256 over concatenation of name + fromDate + toDate,
 * builds payload { n: name, f: fromDate, t: toDate, h: hmacHex },
 * and returns base64-encoded JSON payload.
 * 
 * @param {string} name - User name
 * @param {number[]} secretCodes - Array of character codes for HMAC secret
 * @param {string} fromDate - Valid From date in YYYY-MM-DD format
 * @param {string} toDate - Valid To date in YYYY-MM-DD format
 * @returns {string} Base64-encoded JSON payload
 */
export function generateDateRestrictedLicense(name, secretCodes, fromDate, toDate) {
  var message = name + fromDate + toDate;
  var hash = hmacHex(message, secretCodes);
  var payload = JSON.stringify({ n: name, f: fromDate, t: toDate, h: hash });
  return btoa(payload);
}
