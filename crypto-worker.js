/**
 * Web Worker for background key derivation and unlock verification.
 * Runs PBKDF2 and AES-GCM unwrap completely off the main thread.
 */

function normalizeSecret(str) {
  if (!str) return '';
  return str
    .replace(/\s+/g, '')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-');
}

self.onmessage = async (e) => {
  const { action, secret, salt, iterations, wrappedA, ivA, token } = e.data;

  if (action === 'TRY_UNLOCK') {
    try {
      const normalized = normalizeSecret(secret);
      const enc = new TextEncoder();
      const secretBytes = enc.encode(normalized);

      // Import secret into PBKDF2 key
      const baseKey = await crypto.subtle.importKey(
        'raw',
        secretBytes,
        'PBKDF2',
        false,
        ['deriveKey']
      );

      // Derive AES-GCM wrapping key
      const wrappingKey = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: salt,
          iterations: iterations,
          hash: 'SHA-256'
        },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['unwrapKey']
      );

      // Attempt unwrap of Master Key copy (a)
      const masterKey = await crypto.subtle.unwrapKey(
        'raw',
        wrappedA,
        wrappingKey,
        { name: 'AES-GCM', iv: ivA },
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt', 'wrapKey']
      );

      // Export raw master key to pass safely back to main thread
      const rawKey = await crypto.subtle.exportKey('raw', masterKey);

      self.postMessage(
        { type: 'UNLOCK_SUCCESS', rawKey, token },
        [rawKey]
      );
    } catch {
      // Failed unlock: MAC tag mismatch or bad format
      self.postMessage({ type: 'UNLOCK_FAILED', token });
    }
  }
};
