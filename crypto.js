/**
 * Web Crypto API implementation for the disguised diary.
 * 256-bit AES-GCM master key with dual wrapping:
 * (a) PBKDF2-derived key from secret calculation
 * (b) Non-extractable device key stored in IndexedDB
 */

import { normalizeExpression } from './parser.js';

export const DEFAULT_PBKDF2_ITERATIONS = 600000;

/**
 * Generates a fresh 256-bit AES-GCM master key (extractable so it can be wrapped and exported)
 */
export async function generateMasterKey() {
  return await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // extractable
    ['encrypt', 'decrypt', 'wrapKey']
  );
}

/**
 * Generates a random non-extractable device key stored in IndexedDB
 */
export async function generateDeviceKey() {
  return await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['wrapKey', 'unwrapKey']
  );
}

/**
 * Derives an AES-GCM wrapping key from the secret calculation using PBKDF2
 */
export async function deriveKeyFromSecret(secretExpr, salt, iterations = DEFAULT_PBKDF2_ITERATIONS) {
  const normalized = normalizeExpression(secretExpr);
  const enc = new TextEncoder();
  const secretBytes = enc.encode(normalized);

  const baseKey = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: iterations,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  );
}

/**
 * Wraps the master key using an AES-GCM wrapping key
 */
export async function wrapMasterKey(masterKey, wrappingKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.wrapKey(
    'raw',
    masterKey,
    wrappingKey,
    { name: 'AES-GCM', iv: iv }
  );
  return { wrapped, iv };
}

/**
 * Unwraps the master key using the secret calculation
 */
export async function unwrapMasterKeyWithSecret(secretExpr, salt, iterations, wrappedKey, iv) {
  const wrappingKey = await deriveKeyFromSecret(secretExpr, salt, iterations);
  return await crypto.subtle.unwrapKey(
    'raw',
    wrappedKey,
    wrappingKey,
    { name: 'AES-GCM', iv: iv },
    { name: 'AES-GCM', length: 256 },
    true, // master key must remain extractable for backup wrapping
    ['encrypt', 'decrypt', 'wrapKey']
  );
}

/**
 * Unwraps the master key using the device key (copy b)
 */
export async function unwrapMasterKeyWithDeviceKey(deviceKey, wrappedKey, iv) {
  return await crypto.subtle.unwrapKey(
    'raw',
    wrappedKey,
    deviceKey,
    { name: 'AES-GCM', iv: iv },
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt', 'wrapKey']
  );
}

/**
 * Imports raw master key bytes into a CryptoKey
 */
export async function importRawMasterKey(rawBytes) {
  return await crypto.subtle.importKey(
    'raw',
    rawBytes,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt', 'wrapKey']
  );
}

/**
 * Encrypts entry plaintext JSON object using master key
 * Returns { id, iv, ciphertext }
 */
export async function encryptEntry(entryObj, masterKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const plaintext = enc.encode(JSON.stringify(entryObj));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    masterKey,
    plaintext
  );

  return {
    id: entryObj.id,
    iv: iv,
    ciphertext: ciphertext
  };
}

/**
 * Decrypts an encrypted entry using master key
 * Returns entryObj: { id, createdAt, editedAt, text }
 */
export async function decryptEntry(encryptedRecord, masterKey) {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: encryptedRecord.iv },
    masterKey,
    encryptedRecord.ciphertext
  );

  const dec = new TextDecoder();
  const jsonStr = dec.decode(decrypted);
  return JSON.parse(jsonStr);
}

/**
 * Helper to convert Uint8Array / ArrayBuffer to Base64
 */
export function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Helper to convert Base64 to Uint8Array
 */
export function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
