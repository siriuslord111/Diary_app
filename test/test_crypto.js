import {
  generateMasterKey,
  generateDeviceKey,
  deriveKeyFromSecret,
  wrapMasterKey,
  unwrapMasterKeyWithSecret,
  unwrapMasterKeyWithDeviceKey,
  encryptEntry,
  decryptEntry,
  bufferToBase64,
  base64ToBuffer
} from './crypto.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

async function runTests() {
  console.log('Running Cryptography Engine Tests...');

  const secret1 = '2500*4+999';
  const wrongSecret = '2500*4+998';
  const secret2 = '9876/4-123';
  const salt = crypto.getRandomValues(new Uint8Array(16));
  // Use lower iterations for fast unit test
  const iterations = 5000;

  // 1. Generate master and device keys
  const masterKey = await generateMasterKey();
  const deviceKey = await generateDeviceKey();
  assert(masterKey !== null, 'Master key generated');
  assert(deviceKey !== null, 'Device key generated');

  // 2. Wrap master key with secret1 derived key (copy a)
  const wrappingKey1 = await deriveKeyFromSecret(secret1, salt, iterations);
  const wrapA = await wrapMasterKey(masterKey, wrappingKey1);
  assert(wrapA.wrapped.byteLength > 0, 'Master key wrapped copy A');

  // 3. Wrap master key with device key (copy b)
  const wrapB = await wrapMasterKey(masterKey, deviceKey);
  assert(wrapB.wrapped.byteLength > 0, 'Master key wrapped copy B');

  // 4. Create and encrypt sample diary entry
  const entry1 = {
    id: 'test-id-1',
    createdAt: Date.now(),
    editedAt: Date.now(),
    text: 'My secret memory for today.'
  };
  const encrypted1 = await encryptEntry(entry1, masterKey);
  assert(encrypted1.ciphertext.byteLength > 0, 'Entry encrypted with master key');

  // 5. Test unwrapping copy A with CORRECT secret
  const unwrappedMaster1 = await unwrapMasterKeyWithSecret(secret1, salt, iterations, wrapA.wrapped, wrapA.iv);
  assert(unwrappedMaster1 !== null, 'Unwrapped master key with correct secret');

  const decrypted1 = await decryptEntry(encrypted1, unwrappedMaster1);
  assert(decrypted1.text === entry1.text, 'Decrypted entry matches original text');

  // 6. Test unwrapping copy A with WRONG secret (must fail)
  let wrongFailed = false;
  try {
    await unwrapMasterKeyWithSecret(wrongSecret, salt, iterations, wrapA.wrapped, wrapA.iv);
  } catch {
    wrongFailed = true;
  }
  assert(wrongFailed, 'Unwrap with wrong secret threw error (tamper/invalid MAC)');

  // 7. Test unwrapping copy B with DEVICE key (Reset flow)
  const recoveredMaster = await unwrapMasterKeyWithDeviceKey(deviceKey, wrapB.wrapped, wrapB.iv);
  assert(recoveredMaster !== null, 'Recovered master key with device key');

  const decryptedRecovered = await decryptEntry(encrypted1, recoveredMaster);
  assert(decryptedRecovered.text === entry1.text, 'Entry decrypted using recovered master key');

  // 8. Re-wrap master key with new secret2 (Secret change)
  const newSalt = crypto.getRandomValues(new Uint8Array(16));
  const wrappingKey2 = await deriveKeyFromSecret(secret2, newSalt, iterations);
  const wrapA2 = await wrapMasterKey(recoveredMaster, wrappingKey2);

  // Unwrapping with new secret2 must succeed
  const unwrappedMaster2 = await unwrapMasterKeyWithSecret(secret2, newSalt, iterations, wrapA2.wrapped, wrapA2.iv);
  const decrypted2 = await decryptEntry(encrypted1, unwrappedMaster2);
  assert(decrypted2.text === entry1.text, 'Old entry still decrypts perfectly with re-wrapped master key without re-encrypting entries');

  // 9. Base64 helpers
  const originalBytes = new Uint8Array([1, 2, 3, 255, 0, 128]);
  const b64 = bufferToBase64(originalBytes);
  const decodedBytes = base64ToBuffer(b64);
  assert(decodedBytes.length === originalBytes.length && decodedBytes[3] === 255, 'Base64 roundtrip matches');

  console.log(`\nCrypto tests finished: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
