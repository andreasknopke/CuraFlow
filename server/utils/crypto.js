/**
 * Secure encryption utilities for DB tokens
 * Uses AES-256-GCM with JWT_SECRET as encryption key
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Derive a 256-bit key from JWT_SECRET using SHA-256
 * @returns {Buffer} 32-byte key
 */
const getEncryptionKey = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required for encryption');
  }
  // Use SHA-256 to derive a 32-byte key from the secret
  return crypto.createHash('sha256').update(secret).digest();
};

/**
 * Encrypt data using AES-256-GCM
 * @param {string} plaintext - The data to encrypt
 * @returns {string} Base64-encoded encrypted data (iv:authTag:ciphertext)
 */
export const encryptToken = (plaintext) => {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH
  });
  
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  const authTag = cipher.getAuthTag();
  
  // Combine iv + authTag + ciphertext, all base64 encoded
  const combined = Buffer.concat([
    iv,
    authTag,
    Buffer.from(encrypted, 'base64')
  ]).toString('base64');
  
  return combined;
};

/**
 * Decrypt data that was encrypted with encryptToken
 * @param {string} encryptedData - Base64-encoded encrypted data
 * @returns {string} Decrypted plaintext
 */
export const decryptToken = (encryptedData) => {
  const key = getEncryptionKey();
  
  // Decode the combined buffer
  const combined = Buffer.from(encryptedData, 'base64');
  
  // Extract iv, authTag, and ciphertext
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH
  });
  
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(ciphertext, undefined, 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
};

/**
 * Check if a token is in the old base64 format (unencrypted)
 * Old tokens are just base64-encoded JSON starting with { when decoded
 * @param {string} token - The token to check
 * @returns {boolean} True if it's an old unencrypted token
 */
export const isLegacyToken = (token) => {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    // Check if it looks like DB config (has host, user, database)
    return parsed && parsed.host && parsed.user && parsed.database;
  } catch {
    return false;
  }
};

/**
 * Parse a DB token - handles both legacy (base64) and encrypted formats
 * @param {string} token - The token to parse
 * @returns {object|null} Parsed DB config or null if invalid
 */
export const parseDbToken = (token) => {
  try {
    // First, check if it's a legacy unencrypted token
    if (isLegacyToken(token)) {
      console.warn('Warning: Legacy unencrypted DB token detected. Please regenerate token for security.');
      const decoded = Buffer.from(token, 'base64').toString('utf-8');
      return JSON.parse(decoded);
    }
    
    // Try to decrypt as new encrypted format
    const decrypted = decryptToken(token);
    return JSON.parse(decrypted);
  } catch (error) {
    console.error('Failed to parse DB token:', error.message);
    return null;
  }
};
