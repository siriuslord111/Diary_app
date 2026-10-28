/**
 * Disguise controller & calculator engine.
 * Handles the Android calculator keypad, safe expression evaluation,
 * secret unlock verification via Web Worker, first-time setup, 100-equals reset,
 * and strict auto-locking / privacy shielding.
 */

import {
  evaluateExpression,
  formatNumber,
  applyRepeatOperation,
  normalizeExpression,
  FormatError,
  DivideByZeroError
} from './parser.js';

import {
  getMeta,
  saveMeta,
  clearAllData,
  ensureStoragePersistence,
  saveAllEncryptedEntries
} from './db.js';

import {
  generateMasterKey,
  generateDeviceKey,
  deriveKeyFromSecret,
  wrapMasterKey,
  unwrapMasterKeyWithDeviceKey,
  unwrapMasterKeyWithSecret,
  importRawMasterKey,
  encryptEntry,
  decryptEntry,
  base64ToBuffer,
  DEFAULT_PBKDF2_ITERATIONS
} from './crypto.js';

class CalculatorApp {
  constructor() {
    // DOM Elements
    this.calcScreen = document.getElementById('calculator-screen');
    this.exprDisplay = document.getElementById('expr-display');
    this.resultDisplay = document.getElementById('result-display');
    this.privacyShield = document.getElementById('privacy-shield');
    this.dataViewContainer = document.getElementById('data-view-container');
    this.setupModal = document.getElementById('setup-modal');
    this.resetModal = document.getElementById('reset-modal');

    // Calculator state
    this.currentExpr = '';
    this.lastEvaluatedExpr = '';
    this.lastResult = null;
    this.lastOp = null;
    this.isResultState = false;
    this.hasEvaluated = false;

    // Secret & Reset tracking
    this.consecutiveEqualsCount = 0;
    this.unlockAttemptToken = 0;
    this.cachedMeta = null;
    this.isUnlocked = false;
    this.contentController = null;

    // First time setup state
    this.isFirstTimeSetup = false;
    this.setupStep = 1;
    this.firstSetupSecret = '';

    // Inactivity timer
    this.inactivityTimer = null;

    // Web Worker
    this.initWorker();
  }

  async init() {
    await ensureStoragePersistence();
    await this.checkSetupStatus();
    this.attachCalculatorListeners();
    this.attachPrivacyAndLifecycleListeners();
    this.updateDisplay();
  }

  // --- Worker Management ---

  initWorker() {
    try {
      this.worker = new Worker('./crypto-worker.js');
      this.worker.onmessage = async (e) => {
        const { type, rawKey, token } = e.data;
        if (type === 'UNLOCK_SUCCESS' && token === this.unlockAttemptToken) {
          try {
            const masterKey = await importRawMasterKey(rawKey);
            await this.unlockDiary(masterKey);
          } catch (err) {
            console.error('Failed to import unlocked key', err);
          }
        }
      };
    } catch (e) {
      console.warn('Worker initialization failed; falling back to async main-thread derivation', e);
      this.worker = null;
    }
  }

  // --- Setup Verification ---

  async checkSetupStatus() {
    this.cachedMeta = await getMeta();
    if (!this.cachedMeta) {
      this.isFirstTimeSetup = true;
      this.showSetupScreen();
    }
  }

  // --- Calculator Logic ---

  attachCalculatorListeners() {
    const keys = document.querySelectorAll('.calc-btn');
    keys.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = btn.getAttribute('data-action');
        const val = btn.getAttribute('data-val');
        this.handleButtonPress(action, val);
      });
    });

    // Keyboard support
    window.addEventListener('keydown', (e) => {
      if (this.isUnlocked || this.isFirstTimeSetup) return;

      if (e.key >= '0' && e.key <= '9') {
        this.handleButtonPress('digit', e.key);
      } else if (e.key === '.') {
        this.handleButtonPress('dot', '.');
      } else if (e.key === '+') {
        this.handleButtonPress('op', '+');
      } else if (e.key === '-') {
        this.handleButtonPress('op', '−');
      } else if (e.key === '*') {
        this.handleButtonPress('op', '×');
      } else if (e.key === '/') {
        e.preventDefault();
        this.handleButtonPress('op', '÷');
      } else if (e.key === '%') {
        this.handleButtonPress('percent', '%');
      } else if (e.key === '(' || e.key === ')') {
        this.handleButtonPress('paren', e.key);
      } else if (e.key === 'Enter' || e.key === '=') {
        e.preventDefault();
        this.handleButtonPress('equals', '=');
      } else if (e.key === 'Backspace') {
        this.handleButtonPress('backspace');
      } else if (e.key === 'Escape') {
        this.handleButtonPress('clear');
      }
    });
  }

  handleButtonPress(action, val) {
    if (action !== 'equals') {
      this.consecutiveEqualsCount = 0;
    }

    switch (action) {
      case 'digit':
        this.inputDigit(val);
        break;
      case 'dot':
        this.inputDot();
        break;
      case 'op':
        this.inputOperator(val);
        break;
      case 'paren':
        this.inputParen(val);
        break;
      case 'percent':
        this.inputPercent();
        break;
      case 'plusminus':
        this.inputPlusMinus();
        break;
      case 'backspace':
        this.inputBackspace();
        break;
      case 'clear':
        this.inputClear();
        break;
      case 'equals':
        this.inputEquals();
        break;
    }

    this.updateDisplay();
  }

  inputDigit(digit) {
    if (this.isResultState) {
      this.currentExpr = digit;
      this.isResultState = false;
      this.lastOp = null;
    } else {
      this.currentExpr += digit;
    }
  }

  inputDot() {
    if (this.isResultState) {
      this.currentExpr = '0.';
      this.isResultState = false;
      this.lastOp = null;
      return;
    }

    // Check last number segment to prevent multiple dots
    const parts = this.currentExpr.split(/[\+\−\×\÷\(\)]/);
    const lastPart = parts[parts.length - 1];
    if (!lastPart.includes('.')) {
      if (!lastPart || lastPart === '') {
        this.currentExpr += '0.';
      } else {
        this.currentExpr += '.';
      }
    }
  }

  inputOperator(op) {
    if (this.isResultState && this.lastResult !== null) {
      this.currentExpr = String(this.lastResult) + op;
      this.isResultState = false;
      return;
    }

    if (!this.currentExpr && op === '−') {
      this.currentExpr = '−';
      return;
    }

    if (!this.currentExpr) return;

    const lastChar = this.currentExpr.slice(-1);
    if (['+', '−', '×', '÷'].includes(lastChar)) {
      // Replace last operator
      this.currentExpr = this.currentExpr.slice(0, -1) + op;
    } else {
      this.currentExpr += op;
    }
    this.isResultState = false;
  }

  inputParen(specificParen) {
    if (this.isResultState) {
      this.currentExpr = '';
      this.isResultState = false;
    }

    if (specificParen === '(' || specificParen === ')') {
      this.currentExpr += specificParen;
      return;
    }

    // Smart parenthesis button ()
    const openCount = (this.currentExpr.match(/\(/g) || []).length;
    const closeCount = (this.currentExpr.match(/\)/g) || []).length;
    const lastChar = this.currentExpr.slice(-1);

    if (openCount > closeCount && (lastChar >= '0' && lastChar <= '9' || lastChar === ')' || lastChar === '%')) {
      this.currentExpr += ')';
    } else {
      this.currentExpr += '(';
    }
  }

  inputPercent() {
    if (!this.currentExpr) return;
    const lastChar = this.currentExpr.slice(-1);
    if ((lastChar >= '0' && lastChar <= '9') || lastChar === ')') {
      this.currentExpr += '%';
    }
  }

  inputPlusMinus() {
    if (!this.currentExpr) return;

    if (this.isResultState && this.lastResult !== null) {
      const negated = -this.lastResult;
      this.currentExpr = String(negated);
      this.lastResult = negated;
      return;
    }

    // Find the last number token
    const match = this.currentExpr.match(/([0-9\.]+)$/);
    if (match) {
      const numStr = match[1];
      const startIdx = match.index;
      const prefix = this.currentExpr.slice(0, startIdx);

      if (prefix.endsWith('(-')) {
        // Remove '(-'
        this.currentExpr = prefix.slice(0, -2) + numStr;
      } else if (prefix.endsWith('-') && (startIdx === 1 || ['+', '−', '×', '÷', '('].includes(prefix[startIdx - 2]))) {
        this.currentExpr = prefix.slice(0, -1) + numStr;
      } else {
        this.currentExpr = prefix + '(-' + numStr + ')';
      }
    }
  }

  inputBackspace() {
    if (this.isResultState) {
      this.isResultState = false;
      return;
    }
    if (this.currentExpr.length > 0) {
      this.currentExpr = this.currentExpr.slice(0, -1);
    }
  }

  inputClear() {
    this.currentExpr = '';
    this.lastResult = null;
    this.lastOp = null;
    this.isResultState = false;
    this.hasEvaluated = false;
    this.consecutiveEqualsCount = 0;
  }

  async inputEquals() {
    this.consecutiveEqualsCount++;

    // Section 7: Forgot Secret (Reset via 100 consecutive equals presses)
    if (this.consecutiveEqualsCount >= 100) {
      this.consecutiveEqualsCount = 0;
      this.showResetScreen();
      return;
    }

    // Repeated equals: repeat last operation
    if (this.isResultState && this.lastOp && this.lastResult !== null) {
      try {
        const nextVal = applyRepeatOperation(this.lastResult, this.lastOp);
        this.lastResult = nextVal;
        this.currentExpr = String(formatNumber(nextVal));
      } catch (err) {
        if (err instanceof DivideByZeroError) {
          this.lastResult = "Can't divide by zero";
        } else {
          this.lastResult = "Format error";
        }
      }
      this.updateDisplay();
      return;
    }

    if (!this.currentExpr) return;

    const exprToTest = this.currentExpr;
    const normalized = normalizeExpression(exprToTest);

    // Calculate normal result immediately without any delay
    try {
      const { result, lastOp } = evaluateExpression(exprToTest);
      this.lastResult = result;
      this.lastOp = lastOp;
      this.lastEvaluatedExpr = exprToTest;
      this.isResultState = true;
      this.hasEvaluated = true;
    } catch (err) {
      if (err instanceof DivideByZeroError) {
        this.lastResult = "Can't divide by zero";
      } else {
        this.lastResult = "Format error";
      }
      this.lastEvaluatedExpr = exprToTest;
      this.isResultState = true;
      this.hasEvaluated = true;
    }

    this.updateDisplay();

    // Section 3: Asynchronous unlock attempt (only if expression is non-empty and not in first-time setup)
    if (!this.isFirstTimeSetup && normalized.length > 0 && this.cachedMeta) {
      this.triggerUnlockAttempt(exprToTest);
    }
  }

  triggerUnlockAttempt(expr) {
    const token = ++this.unlockAttemptToken;

    if (this.worker) {
      this.worker.postMessage({
        action: 'TRY_UNLOCK',
        secret: expr,
        salt: this.cachedMeta.salt,
        iterations: this.cachedMeta.iterations,
        wrappedA: this.cachedMeta.wrappedMasterKeyA,
        ivA: this.cachedMeta.ivA,
        token: token
      });
    } else {
      // Async fallback on main thread
      setTimeout(async () => {
        try {
          const masterKey = await unwrapMasterKeyWithSecret(
            expr,
            this.cachedMeta.salt,
            this.cachedMeta.iterations,
            this.cachedMeta.wrappedMasterKeyA,
            this.cachedMeta.ivA
          );
          if (token === this.unlockAttemptToken) {
            await this.unlockDiary(masterKey);
          }
        } catch {
          // Silently ignore failed unlock
        }
      }, 0);
    }
  }

  updateDisplay() {
    if (this.isResultState) {
      this.exprDisplay.textContent = this.lastEvaluatedExpr;
      this.resultDisplay.textContent = typeof this.lastResult === 'number'
        ? formatNumber(this.lastResult)
        : this.lastResult || '';
    } else {
      this.exprDisplay.textContent = this.currentExpr || '';
      
      // Live calculation preview
      if (this.currentExpr && !['+', '−', '×', '÷'].includes(this.currentExpr.slice(-1))) {
        try {
          const { result } = evaluateExpression(this.currentExpr);
          this.resultDisplay.textContent = formatNumber(result);
          this.resultDisplay.classList.add('live-preview');
        } catch {
          this.resultDisplay.textContent = '';
          this.resultDisplay.classList.remove('live-preview');
        }
      } else {
        this.resultDisplay.textContent = '';
        this.resultDisplay.classList.remove('live-preview');
      }
    }
  }

  // --- First-Time Setup UI ---

  showSetupScreen() {
    this.setupModal.classList.remove('hidden');
    this.setupStep = 1;
    this.firstSetupSecret = '';

    const titleEl = document.getElementById('setup-title');
    const inputEl = document.getElementById('setup-input');
    const hintEl = document.getElementById('setup-hint');
    const restoreBtn = document.getElementById('setup-restore-btn');
    const nextBtn = document.getElementById('setup-next-btn');

    titleEl.textContent = 'Enter your secret calculation, then press =';
    inputEl.value = '';
    hintEl.textContent = 'Can be any calculation or digits (e.g. a PIN, number, or formula)';
    hintEl.className = 'setup-hint';

    nextBtn.onclick = () => this.handleSetupStep();
    restoreBtn.onclick = () => this.handleSetupRestore();

    inputEl.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === '=') {
        e.preventDefault();
        this.handleSetupStep();
      }
    };
  }

  async handleSetupStep() {
    const inputEl = document.getElementById('setup-input');
    const titleEl = document.getElementById('setup-title');
    const hintEl = document.getElementById('setup-hint');
    const rawVal = inputEl.value.trim();
    const normalized = normalizeExpression(rawVal);

    if (this.setupStep === 1) {
      if (normalized.length === 0) {
        hintEl.textContent = 'Please enter a calculation or number.';
        hintEl.className = 'setup-hint hint-error';
        return;
      }

      this.firstSetupSecret = rawVal;
      this.setupStep = 2;
      titleEl.textContent = 'Confirm your secret calculation, then press =';
      inputEl.value = '';
      hintEl.textContent = 'Re-enter the exact same calculation to confirm';
      hintEl.className = 'setup-hint';
      inputEl.focus();
    } else if (this.setupStep === 2) {
      if (normalizeExpression(rawVal) !== normalizeExpression(this.firstSetupSecret)) {
        hintEl.textContent = 'Calculations did not match. Please enter again.';
        hintEl.className = 'setup-hint hint-error';
        this.setupStep = 1;
        titleEl.textContent = 'Enter your secret calculation, then press =';
        inputEl.value = '';
        return;
      }

      // Initialize crypto metadata
      hintEl.textContent = 'Initializing secure vault...';
      hintEl.className = 'setup-hint';

      try {
        const masterKey = await generateMasterKey();
        const deviceKey = await generateDeviceKey();
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iterations = DEFAULT_PBKDF2_ITERATIONS;

        const wrappingKeyA = await deriveKeyFromSecret(rawVal, salt, iterations);
        const wrapA = await wrapMasterKey(masterKey, wrappingKeyA);
        const wrapB = await wrapMasterKey(masterKey, deviceKey);

        const metaRecord = {
          salt: salt,
          iterations: iterations,
          wrappedMasterKeyA: wrapA.wrapped,
          ivA: wrapA.iv,
          wrappedMasterKeyB: wrapB.wrapped,
          ivB: wrapB.iv,
          deviceKey: deviceKey,
          schemaVersion: 1
        };

        await saveMeta(metaRecord);
        this.cachedMeta = metaRecord;
        this.isFirstTimeSetup = false;
        this.setupModal.classList.add('hidden');

        // Open diary immediately
        await this.unlockDiary(masterKey);
      } catch (err) {
        console.error('Setup failed', err);
        hintEl.textContent = 'Setup error. Please try again.';
        hintEl.className = 'setup-hint hint-error';
      }
    }
  }

  handleSetupRestore() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';

    fileInput.onchange = async () => {
      if (!fileInput.files || fileInput.files.length === 0) return;
      const file = fileInput.files[0];
      const text = await file.text();

      const secret = prompt('Enter the secret calculation for this backup:');
      if (!secret) return;

      try {
        const backupData = JSON.parse(text);
        const salt = base64ToBuffer(backupData.salt);
        const wrappedA = base64ToBuffer(backupData.wrappedMasterKeyA);
        const ivA = base64ToBuffer(backupData.ivA);
        const iterations = backupData.iterations || DEFAULT_PBKDF2_ITERATIONS;

        // Unwrap master key
        const masterKey = await unwrapMasterKeyWithSecret(secret, salt, iterations, wrappedA, ivA);

        // Generate a new device key for this install
        const deviceKey = await generateDeviceKey();
        const wrapB = await wrapMasterKey(masterKey, deviceKey);

        const metaRecord = {
          salt: salt,
          iterations: iterations,
          wrappedMasterKeyA: wrappedA,
          ivA: ivA,
          wrappedMasterKeyB: wrapB.wrapped,
          ivB: wrapB.iv,
          deviceKey: deviceKey,
          schemaVersion: 1
        };

        await saveMeta(metaRecord);
        this.cachedMeta = metaRecord;

        // Restore encrypted entries
        if (backupData.entries && backupData.entries.length > 0) {
          const entriesToSave = backupData.entries.map(e => ({
            id: e.id,
            iv: base64ToBuffer(e.iv),
            ciphertext: base64ToBuffer(e.ciphertext)
          }));
          await saveAllEncryptedEntries(entriesToSave);
        }

        this.isFirstTimeSetup = false;
        this.setupModal.classList.add('hidden');
        await this.unlockDiary(masterKey);
      } catch (e) {
        console.error('Restore failed', e);
        alert('Could not restore backup. Check secret calculation and file format.');
      }
    };

    fileInput.click();
  }

  // --- Reset UI (= x100) ---

  showResetScreen() {
    this.resetModal.classList.remove('hidden');

    const titleEl = document.getElementById('reset-title');
    const bodyEl = document.getElementById('reset-body');
    const confirmBtn = document.getElementById('reset-confirm-btn');
    const cancelBtn = document.getElementById('reset-cancel-btn');

    titleEl.textContent = 'Reset Secret Calculation';
    bodyEl.innerHTML = `
      <p style="margin-bottom:12px; line-height:1.5;">Set a new secret calculation? Your existing entries will be preserved.</p>
    `;
    confirmBtn.textContent = 'Continue';
    confirmBtn.style.display = 'inline-block';

    cancelBtn.onclick = () => {
      this.resetModal.classList.add('hidden');
    };

    confirmBtn.onclick = async () => {
      const meta = await getMeta();
      if (!meta || !meta.deviceKey || !meta.wrappedMasterKeyB) {
        // Nothing to recover
        bodyEl.innerHTML = `
          <p style="margin-bottom:12px; line-height:1.5; color:#f28b82;">
            No recovery key found on this device. Site data may have been cleared.
          </p>
        `;
        confirmBtn.style.display = 'none';
        
        const actionsDiv = document.createElement('div');
        actionsDiv.style.marginTop = '16px';
        actionsDiv.innerHTML = `
          <button class="save-pill-btn" id="reset-restore-btn" style="width:100%; margin-bottom:8px;">Restore from Backup</button>
          <button class="cal-pill-btn" id="reset-fresh-btn" style="width:100%;">Start Fresh (Clear Data)</button>
        `;
        bodyEl.appendChild(actionsDiv);

        actionsDiv.querySelector('#reset-restore-btn').onclick = () => {
          this.resetModal.classList.add('hidden');
          this.handleSetupRestore();
        };

        actionsDiv.querySelector('#reset-fresh-btn').onclick = async () => {
          await clearAllData();
          this.cachedMeta = null;
          this.resetModal.classList.add('hidden');
          this.isFirstTimeSetup = true;
          this.showSetupScreen();
        };
        return;
      }

      // Recover master key using device key
      try {
        const masterKey = await unwrapMasterKeyWithDeviceKey(meta.deviceKey, meta.wrappedMasterKeyB, meta.ivB);
        this.promptNewSecretForReset(masterKey, meta);
      } catch (err) {
        console.error('Device recovery failed', err);
        alert('Failed to recover master key using device key.');
        this.resetModal.classList.add('hidden');
      }
    };
  }

  promptNewSecretForReset(masterKey, meta) {
    const bodyEl = document.getElementById('reset-body');
    const confirmBtn = document.getElementById('reset-confirm-btn');

    bodyEl.innerHTML = `
      <label class="input-label">New Secret Calculation</label>
      <input type="text" id="reset-new-1" class="generic-input" placeholder="Any number or calculation" autocomplete="off" />

      <label class="input-label" style="margin-top:12px;">Confirm New Secret Calculation</label>
      <input type="text" id="reset-new-2" class="generic-input" placeholder="Repeat new calculation" autocomplete="off" />

      <div id="reset-error-msg" class="inline-error"></div>
    `;

    confirmBtn.textContent = 'Save & Open';

    confirmBtn.onclick = async () => {
      const errBox = document.getElementById('reset-error-msg');
      const val1 = document.getElementById('reset-new-1').value.trim();
      const val2 = document.getElementById('reset-new-2').value.trim();
      const norm1 = normalizeExpression(val1);

      if (norm1.length === 0) {
        errBox.textContent = 'Please enter a calculation or number.';
        return;
      }

      if (normalizeExpression(val1) !== normalizeExpression(val2)) {
        errBox.textContent = 'Calculations do not match.';
        return;
      }

      try {
        const newSalt = crypto.getRandomValues(new Uint8Array(16));
        const newWrappingKey = await deriveKeyFromSecret(norm1, newSalt, meta.iterations);
        const { wrapped, iv } = await wrapMasterKey(masterKey, newWrappingKey);

        meta.salt = newSalt;
        meta.wrappedMasterKeyA = wrapped;
        meta.ivA = iv;

        await saveMeta(meta);
        this.cachedMeta = meta;

        this.resetModal.classList.add('hidden');
        await this.unlockDiary(masterKey);
      } catch (e) {
        console.error('Reset save error', e);
        errBox.textContent = 'Failed to re-wrap key.';
      }
    };
  }

  // --- Unlock & Lock Lifecycle ---

  async unlockDiary(masterKey) {
    if (this.isUnlocked) return;
    this.isUnlocked = true;

    // Reset calculator inputs
    this.currentExpr = '';
    this.lastResult = null;
    this.updateDisplay();

    // Hide calculator and display privacy shield while mounting
    this.calcScreen.classList.add('hidden');
    this.dataViewContainer.classList.remove('hidden');

    // Dynamically load neutral module
    try {
      const { ContentController } = await import('./data-view.js');
      this.contentController = new ContentController(this.dataViewContainer, masterKey, {
        onLock: () => this.lockApp()
      });
      await this.contentController.init();

      // Push history state so Android back button can be trapped
      history.pushState({ unlocked: true }, '');

      this.resetInactivityTimer();
    } catch (err) {
      console.error('Failed to load content controller', err);
      this.lockApp();
    }
  }

  lockApp() {
    if (!this.isUnlocked) return;
    this.isUnlocked = false;

    // Clear inactivity timer
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }

    // Purge content controller and decrypted memory
    if (this.contentController) {
      this.contentController.destroy();
      this.contentController = null;
    }

    // Clear UI and swap back to calculator
    this.dataViewContainer.innerHTML = '';
    this.dataViewContainer.classList.add('hidden');
    this.calcScreen.classList.remove('hidden');

    this.consecutiveEqualsCount = 0;
    this.currentExpr = '';
    this.lastResult = null;
    this.lastOp = null;
    this.isResultState = false;
    this.updateDisplay();
  }

  // --- Privacy & Auto-Lock Handlers ---

  attachPrivacyAndLifecycleListeners() {
    const activateShield = () => {
      if (this.isUnlocked) {
        this.privacyShield.classList.add('active');
      }
    };

    const deactivateShield = () => {
      this.privacyShield.classList.remove('active');
    };

    // Instant lock on tab hide / app backgrounding
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        activateShield();
        this.lockApp();
      } else {
        deactivateShield();
      }
    });

    // Instant lock on window blur / loss of focus
    window.addEventListener('blur', () => {
      activateShield();
      this.lockApp();
    });

    // Page hide / freeze
    window.addEventListener('pagehide', () => {
      activateShield();
      this.lockApp();
    });

    // Android back button: intercept popstate
    window.addEventListener('popstate', (e) => {
      if (this.isUnlocked) {
        this.lockApp();
      }
    });

    // 1-minute inactivity timer
    const resetTimer = () => {
      if (this.isUnlocked) {
        this.resetInactivityTimer();
      }
    };

    ['pointerdown', 'touchstart', 'mousedown', 'keydown', 'scroll'].forEach(evt => {
      window.addEventListener(evt, resetTimer, { passive: true });
    });
  }

  resetInactivityTimer() {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    this.inactivityTimer = setTimeout(() => {
      this.lockApp();
    }, 60000); // 1 minute
  }
}

// Bootstrap
window.addEventListener('DOMContentLoaded', () => {
  const app = new CalculatorApp();
  app.init();
});
