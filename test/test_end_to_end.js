import { installMockIDB } from './mock_idb.js';
installMockIDB();

import {
  getMeta,
  saveMeta,
  getAllEncryptedEntries,
  saveEncryptedEntry,
  deleteEncryptedEntry,
  saveAllEncryptedEntries,
  clearAllData
} from '../db.js';

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
} from '../crypto.js';

import {
  evaluateExpression,
  formatNumber,
  applyRepeatOperation,
  normalizeExpression
} from '../parser.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${msg}`);
  }
}

async function runEndToEnd() {
  console.log('--- Starting Comprehensive End-to-End Verification ---');

  // ==========================================
  // 1. Calculator Expression & Safe Math
  // ==========================================
  console.log('1. Testing Calculator Arithmetic & Disguise...');
  assert(evaluateExpression('12.5 + 7.5').result === 20, 'Decimal addition 12.5 + 7.5 = 20');
  assert(evaluateExpression('200 * 15%').result === 30, 'Percentage calculation 200 * 15% = 30');
  assert(evaluateExpression('(10 + 5) * 2').result === 30, 'Parentheses precedence (10 + 5) * 2 = 30');

  // Repeated equals
  const eqBase = evaluateExpression('5 + 4');
  assert(eqBase.result === 9, '5 + 4 = 9');
  const rep1 = applyRepeatOperation(eqBase.result, eqBase.lastOp);
  assert(rep1 === 13, 'Repeated = gives 13');
  const rep2 = applyRepeatOperation(rep1, eqBase.lastOp);
  assert(rep2 === 17, 'Repeated = gives 17');

  // Divide by zero
  let divZero = false;
  try {
    evaluateExpression('42 / 0');
  } catch (e) {
    if (e.message === "Can't divide by zero") divZero = true;
  }
  assert(divZero, 'Division by zero gives "Can\'t divide by zero"');

  // ==========================================
  // 2. First-Time Setup Flow
  // ==========================================
  console.log('2. Testing First-Time Setup Flow...');
  const secretInitial = '450*20-150';
  const normSecret = normalizeExpression(secretInitial);
  assert(normSecret.length >= 8, 'Secret meets >= 8 characters');
  assert(/[0-9]/.test(normSecret), 'Secret contains digits');
  assert(/[+\-*\/%]/.test(normSecret), 'Secret contains operators');

  const salt1 = crypto.getRandomValues(new Uint8Array(16));
  const testIterations = 5000; // Fast for testing

  const masterKey = await generateMasterKey();
  const deviceKey = await generateDeviceKey();
  const wrapKeyA1 = await deriveKeyFromSecret(normSecret, salt1, testIterations);

  const wrapA1 = await wrapMasterKey(masterKey, wrapKeyA1);
  const wrapB1 = await wrapMasterKey(masterKey, deviceKey);

  const initialMeta = {
    salt: salt1,
    iterations: testIterations,
    wrappedMasterKeyA: wrapA1.wrapped,
    ivA: wrapA1.iv,
    wrappedMasterKeyB: wrapB1.wrapped,
    ivB: wrapB1.iv,
    deviceKey: deviceKey,
    schemaVersion: 1
  };
  await saveMeta(initialMeta);

  const savedMeta = await getMeta();
  assert(savedMeta !== null && savedMeta.schemaVersion === 1, 'Metadata correctly saved in IndexedDB');

  // ==========================================
  // 3. Unlock Attempts (Wrong vs Correct)
  // ==========================================
  console.log('3. Testing Secret Unlock Verification...');
  // Wrong secret
  let wrongFailed = false;
  try {
    await unwrapMasterKeyWithSecret('450*20-151', savedMeta.salt, savedMeta.iterations, savedMeta.wrappedMasterKeyA, savedMeta.ivA);
  } catch {
    wrongFailed = true;
  }
  assert(wrongFailed, 'Wrong secret calculation fails silently with MAC verification failure');

  // Correct secret
  const unlockedMasterKey = await unwrapMasterKeyWithSecret(
    secretInitial,
    savedMeta.salt,
    savedMeta.iterations,
    savedMeta.wrappedMasterKeyA,
    savedMeta.ivA
  );
  assert(unlockedMasterKey !== null, 'Correct secret unlocks Master Key copy (a)');

  // ==========================================
  // 4. Diary Entries (Multiple on Same Day)
  // ==========================================
  console.log('4. Testing Multiple Entries on Same Day & 12-Hour Times...');
  // Same day: 28 Oct 2026
  const baseDay = new Date(2026, 9, 28, 9, 42, 0); // 9:42 AM
  const entry1 = {
    id: 'entry-1',
    createdAt: baseDay.getTime(),
    editedAt: baseDay.getTime(),
    text: 'Morning entry at 9:42 AM.'
  };

  const midDay = new Date(2026, 9, 28, 14, 15, 0); // 2:15 PM
  const entry2 = {
    id: 'entry-2',
    createdAt: midDay.getTime(),
    editedAt: midDay.getTime(),
    text: 'Afternoon coffee break.'
  };

  const evening = new Date(2026, 9, 28, 21, 30, 0); // 9:30 PM
  const entry3 = {
    id: 'entry-3',
    createdAt: evening.getTime(),
    editedAt: evening.getTime(),
    text: 'Evening reflections.'
  };

  const enc1 = await encryptEntry(entry1, unlockedMasterKey);
  const enc2 = await encryptEntry(entry2, unlockedMasterKey);
  const enc3 = await encryptEntry(entry3, unlockedMasterKey);

  await saveEncryptedEntry(enc1);
  await saveEncryptedEntry(enc2);
  await saveEncryptedEntry(enc3);

  // Verify storage has NO plaintext
  const dbRecords = await getAllEncryptedEntries();
  assert(dbRecords.length === 3, 'Three entries stored in IndexedDB');
  const diskJson = JSON.stringify(dbRecords);
  assert(!diskJson.includes('Morning entry') && !diskJson.includes('Afternoon') && !diskJson.includes('Evening'),
    'Zero unencrypted entry text on disk');

  // Decrypt into memory
  const memoryEntries = [];
  for (const rec of dbRecords) {
    const dec = await decryptEntry(rec, unlockedMasterKey);
    memoryEntries.push(dec);
  }
  // Sort earliest first
  memoryEntries.sort((a, b) => a.createdAt - b.createdAt);

  assert(memoryEntries[0].id === 'entry-1', 'Earliest entry is first (9:42 AM)');
  assert(memoryEntries[1].id === 'entry-2', 'Second entry is middle (2:15 PM)');
  assert(memoryEntries[2].id === 'entry-3', 'Third entry is last (9:30 PM)');

  // Verify 12-hour format
  const t1 = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(memoryEntries[0].createdAt));
  const t2 = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(memoryEntries[1].createdAt));
  assert(t1 === '9:42 AM', 'Time 12-hour format is 9:42 AM');
  assert(t2 === '2:15 PM', 'Time 12-hour format is 2:15 PM');

  // ==========================================
  // 5. Entry Editing & Deletion
  // ==========================================
  console.log('5. Testing Entry Edit & Delete...');
  // Edit entry 2 text and move date to yesterday (27 Oct 2026)
  const yesterday = new Date(2026, 9, 27, 11, 0, 0);
  entry2.text = 'Edited afternoon entry moved to yesterday.';
  entry2.createdAt = yesterday.getTime();
  entry2.editedAt = Date.now();

  const enc2Updated = await encryptEntry(entry2, unlockedMasterKey);
  await saveEncryptedEntry(enc2Updated);

  // Delete entry 3
  await deleteEncryptedEntry('entry-3');

  const afterEditRecords = await getAllEncryptedEntries();
  assert(afterEditRecords.length === 2, 'Entry 3 deleted successfully, 2 records remain');

  // ==========================================
  // 6. Change Secret Calculation
  // ==========================================
  console.log('6. Testing Change Secret Calculation...');
  const newSecret = '9876/4-123';
  const newSalt = crypto.getRandomValues(new Uint8Array(16));
  const newWrapKeyA = await deriveKeyFromSecret(newSecret, newSalt, testIterations);

  const newWrapA = await wrapMasterKey(unlockedMasterKey, newWrapKeyA);
  savedMeta.salt = newSalt;
  savedMeta.wrappedMasterKeyA = newWrapA.wrapped;
  savedMeta.ivA = newWrapA.iv;
  await saveMeta(savedMeta);

  // Old secret fails
  let oldSecretFailed = false;
  try {
    await unwrapMasterKeyWithSecret(secretInitial, savedMeta.salt, savedMeta.iterations, savedMeta.wrappedMasterKeyA, savedMeta.ivA);
  } catch {
    oldSecretFailed = true;
  }
  assert(oldSecretFailed, 'Old secret fails to unlock after secret change');

  // New secret succeeds
  const reUnlockedMaster = await unwrapMasterKeyWithSecret(newSecret, savedMeta.salt, savedMeta.iterations, savedMeta.wrappedMasterKeyA, savedMeta.ivA);
  assert(reUnlockedMaster !== null, 'New secret unlocks master key');

  // Old entries still decrypt without re-encryption!
  const remainingRecs = await getAllEncryptedEntries();
  const testDec1 = await decryptEntry(remainingRecs.find(r => r.id === 'entry-1'), reUnlockedMaster);
  assert(testDec1.text === 'Morning entry at 9:42 AM.', 'Existing entry still decrypts without re-encryption');

  // ==========================================
  // 7. Forgot Secret (= x100 Reset)
  // ==========================================
  console.log('7. Testing Forgot Secret (= x100) Reset with Device Key...');
  // Device key from DB unwraps copy B
  const resetRecoveredMaster = await unwrapMasterKeyWithDeviceKey(savedMeta.deviceKey, savedMeta.wrappedMasterKeyB, savedMeta.ivB);
  assert(resetRecoveredMaster !== null, 'Master key recovered using device key (copy b)');

  // User sets new secret during reset
  const resetSecret = '777*11-222';
  const resetSalt = crypto.getRandomValues(new Uint8Array(16));
  const resetWrapKey = await deriveKeyFromSecret(resetSecret, resetSalt, testIterations);
  const resetWrapA = await wrapMasterKey(resetRecoveredMaster, resetWrapKey);

  savedMeta.salt = resetSalt;
  savedMeta.wrappedMasterKeyA = resetWrapA.wrapped;
  savedMeta.ivA = resetWrapA.iv;
  await saveMeta(savedMeta);

  const resetUnlocked = await unwrapMasterKeyWithSecret(resetSecret, savedMeta.salt, savedMeta.iterations, savedMeta.wrappedMasterKeyA, savedMeta.ivA);
  const checkEntry1 = await decryptEntry(remainingRecs.find(r => r.id === 'entry-1'), resetUnlocked);
  assert(checkEntry1.text === 'Morning entry at 9:42 AM.', 'Entries intact after device-key reset');

  // ==========================================
  // 8. Backup Export and Restore
  // ==========================================
  console.log('8. Testing Backup Export & Restore on Fresh Install...');
  const exportRecs = await getAllEncryptedEntries();
  const backupPayload = {
    version: 1,
    exportedAt: Date.now(),
    iterations: savedMeta.iterations,
    salt: bufferToBase64(savedMeta.salt),
    wrappedMasterKeyA: bufferToBase64(savedMeta.wrappedMasterKeyA),
    ivA: bufferToBase64(savedMeta.ivA),
    entries: exportRecs.map(e => ({
      id: e.id,
      iv: bufferToBase64(e.iv),
      ciphertext: bufferToBase64(e.ciphertext)
    }))
  };

  // Simulate fresh install: clear all local storage
  await clearAllData();
  const clearedMeta = await getMeta();
  assert(clearedMeta === null, 'IndexedDB cleared for fresh install test');

  // Restore from backup
  const restSalt = base64ToBuffer(backupPayload.salt);
  const restWrappedA = base64ToBuffer(backupPayload.wrappedMasterKeyA);
  const restIvA = base64ToBuffer(backupPayload.ivA);
  const restIter = backupPayload.iterations;

  // Unwrap with backup secret
  const restoredMasterKey = await unwrapMasterKeyWithSecret(resetSecret, restSalt, restIter, restWrappedA, restIvA);
  assert(restoredMasterKey !== null, 'Backup master key successfully unwrapped with secret');

  // Generate new device key for fresh phone/install
  const newDeviceKey = await generateDeviceKey();
  const newWrapB = await wrapMasterKey(restoredMasterKey, newDeviceKey);

  const restoredMeta = {
    salt: restSalt,
    iterations: restIter,
    wrappedMasterKeyA: restWrappedA,
    ivA: restIvA,
    wrappedMasterKeyB: newWrapB.wrapped,
    ivB: newWrapB.iv,
    deviceKey: newDeviceKey,
    schemaVersion: 1
  };
  await saveMeta(restoredMeta);

  // Restore entries
  const restoredEntries = backupPayload.entries.map(e => ({
    id: e.id,
    iv: base64ToBuffer(e.iv),
    ciphertext: base64ToBuffer(e.ciphertext)
  }));
  await saveAllEncryptedEntries(restoredEntries);

  // Verify restored entries decrypt
  const freshDbEntries = await getAllEncryptedEntries();
  assert(freshDbEntries.length === 2, 'Restored 2 entries from backup into clean DB');
  const restoredDec1 = await decryptEntry(freshDbEntries.find(e => e.id === 'entry-1'), restoredMasterKey);
  assert(restoredDec1.text === 'Morning entry at 9:42 AM.', 'Restored entry text matches exactly');

  console.log(`\nAll End-to-End Tests Succeeded: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

await runEndToEnd();

