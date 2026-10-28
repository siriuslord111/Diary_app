/**
 * Neutral content module for the private diary.
 * Loaded dynamically only after successful authentication.
 * Manages decrypted in-memory entries, calendar index, entry editor, and settings.
 * Cleans up and purges all memory upon unmount.
 */

import {
  encryptEntry,
  decryptEntry,
  deriveKeyFromSecret,
  wrapMasterKey,
  unwrapMasterKeyWithSecret,
  bufferToBase64,
  base64ToBuffer,
  DEFAULT_PBKDF2_ITERATIONS
} from './crypto.js';

import {
  getAllEncryptedEntries,
  saveEncryptedEntry,
  deleteEncryptedEntry,
  saveAllEncryptedEntries,
  getMeta,
  saveMeta
} from './db.js';

import { normalizeExpression } from './parser.js';

export class ContentController {
  constructor(mountContainer, masterKey, callbacks = {}) {
    this.container = mountContainer;
    this.masterKey = masterKey;
    this.onLock = callbacks.onLock || (() => {});
    
    // In-memory data store
    this.entries = [];
    this.activeView = 'landing'; // 'landing', 'calendar', 'day_timeline'
    this.selectedDateKey = this.getLocalDateKey(new Date());
    
    // Calendar navigation state
    const today = new Date();
    this.calYear = today.getFullYear();
    this.calMonth = today.getMonth(); // 0-11
    
    // Editor state
    this.currentEditingId = null;
    this.draftText = '';
    this.draftTimestamp = Date.now();
    this.autoSaveTimer = null;

    // Touch swipe handling
    this.touchStartX = 0;
    this.touchStartY = 0;
  }

  // --- Date Formatting Helpers ---

  getLocalDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  formatDateTitle(d) {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }).format(d);
  }

  formatDateShort(d) {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }).format(d);
  }

  formatTime12(d) {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(d);
  }

  // --- Lifecycle & Initialization ---

  async init() {
    this.container.innerHTML = `
      <div class="view-loading">
        <div class="spinner"></div>
      </div>
    `;

    try {
      // Decrypt all entries into memory
      const encryptedRecords = await getAllEncryptedEntries();
      const decryptedList = [];

      for (const rec of encryptedRecords) {
        try {
          const entry = await decryptEntry(rec, this.masterKey);
          decryptedList.push(entry);
        } catch (e) {
          console.error('Failed to decrypt record', rec.id, e);
        }
      }

      this.entries = decryptedList;
      this.render();
    } catch (err) {
      console.error('Initialization error in content module', err);
      this.onLock();
    }
  }

  destroy() {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    // Wipe all sensitive references from memory
    this.masterKey = null;
    this.entries = [];
    this.draftText = '';
    this.container.innerHTML = '';
  }

  // --- Entries Query Helpers ---

  getEntriesForDateKey(dateKey) {
    return this.entries
      .filter(entry => {
        const d = new Date(entry.createdAt);
        return this.getLocalDateKey(d) === dateKey;
      })
      .sort((a, b) => a.createdAt - b.createdAt); // Earliest first
  }

  getEntriesMap() {
    const map = new Map();
    for (const entry of this.entries) {
      const d = new Date(entry.createdAt);
      const key = this.getLocalDateKey(d);
      if (!map.has(key)) {
        map.set(key, 0);
      }
      map.set(key, map.get(key) + 1);
    }
    return map;
  }

  // --- Main Render Dispatcher ---

  render() {
    if (!this.masterKey) return;

    this.container.innerHTML = `
      <div class="diary-shell">
        <header class="diary-header">
          <div class="diary-header-left">
            <h1 class="diary-date-header">${this.formatDateTitle(new Date())}</h1>
          </div>
          <div class="diary-header-actions">
            <button class="icon-btn" id="btn-toggle-calendar" title="Calendar" aria-label="Calendar">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="4" width="18" height="18" rx="3" ry="3"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
            </button>
            <button class="icon-btn" id="btn-open-settings" title="Settings" aria-label="Settings">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </button>
            <button class="icon-btn lock-btn" id="btn-lock-now" title="Lock" aria-label="Lock">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
            </button>
          </div>
        </header>

        <main class="diary-main-body" id="diary-main-content">
          ${this.renderViewContent()}
        </main>

        ${this.activeView !== 'calendar' ? `
          <button class="fab-btn" id="btn-fab-new" aria-label="Write new entry">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
        ` : ''}

        <div id="modal-container"></div>
      </div>
    `;

    this.attachHeaderListeners();
    this.attachViewListeners();
  }

  renderViewContent() {
    if (this.activeView === 'landing') {
      return this.renderLandingView();
    } else if (this.activeView === 'calendar') {
      return this.renderCalendarView();
    } else if (this.activeView === 'day_timeline') {
      return this.renderDayTimelineView();
    }
    return '';
  }

  // --- Landing View (Today's Entries) ---

  renderLandingView() {
    const todayKey = this.getLocalDateKey(new Date());
    const todayEntries = this.getEntriesForDateKey(todayKey);

    return `
      <div class="landing-view">
        <div class="section-title-row">
          <span class="section-title">Today's Entries</span>
          <span class="entry-count-pill">${todayEntries.length}</span>
        </div>

        ${todayEntries.length === 0 ? `
          <div class="empty-state">
            <div class="empty-icon">📝</div>
            <p class="empty-title">No entries yet today</p>
            <p class="empty-subtitle">Tap the + button to record a thought or memory</p>
          </div>
        ` : `
          <div class="entries-list">
            ${todayEntries.map(entry => this.renderEntryCard(entry)).join('')}
          </div>
        `}
      </div>
    `;
  }

  renderEntryCard(entry) {
    const d = new Date(entry.createdAt);
    const timeStr = this.formatTime12(d);
    const escapedText = this.escapeHtml(entry.text);
    const isEdited = entry.editedAt && entry.editedAt !== entry.createdAt;

    return `
      <div class="entry-card" data-entry-id="${entry.id}">
        <div class="entry-card-meta">
          <span class="entry-time">${timeStr}</span>
          ${isEdited ? '<span class="entry-edited-tag">edited</span>' : ''}
        </div>
        <div class="entry-card-text">${escapedText}</div>
      </div>
    `;
  }

  // --- Calendar View (Month Grid) ---

  renderCalendarView() {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthName = months[this.calMonth];
    const entriesMap = this.getEntriesMap();
    const todayKey = this.getLocalDateKey(new Date());

    // Compute month grid days
    const firstDayIndex = new Date(this.calYear, this.calMonth, 1).getDay(); // 0 is Sun
    const totalDays = new Date(this.calYear, this.calMonth + 1, 0).getDate();
    const prevMonthTotalDays = new Date(this.calYear, this.calMonth, 0).getDate();

    const cells = [];

    // Leading days from previous month
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dNum = prevMonthTotalDays - i;
      cells.push({
        day: dNum,
        isOtherMonth: true,
        dateKey: null
      });
    }

    // Days in current month
    for (let d = 1; d <= totalDays; d++) {
      const dObj = new Date(this.calYear, this.calMonth, d);
      const key = this.getLocalDateKey(dObj);
      const count = entriesMap.get(key) || 0;
      cells.push({
        day: d,
        isOtherMonth: false,
        dateKey: key,
        isToday: key === todayKey,
        count: count
      });
    }

    // Trailing days to fill 42 cells grid (6 rows)
    const remaining = 42 - cells.length;
    for (let i = 1; i <= remaining; i++) {
      cells.push({
        day: i,
        isOtherMonth: true,
        dateKey: null
      });
    }

    return `
      <div class="calendar-view">
        <div class="cal-top-bar">
          <button class="cal-btn-back" id="cal-btn-close" aria-label="Back to Today">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
            <span>Today</span>
          </button>
          
          <div class="cal-nav-group">
            <button class="cal-title-btn" id="cal-title-picker" title="Jump month or year">
              <span>${monthName} ${this.calYear}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
          </div>

          <div class="cal-quick-actions">
            <button class="cal-nav-arrow" id="cal-prev-month" aria-label="Previous month">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
            <button class="cal-nav-arrow" id="cal-next-month" aria-label="Next month">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          </div>
        </div>

        <div class="cal-toolbar">
          <button class="cal-pill-btn" id="cal-btn-today">Today</button>
          <button class="cal-pill-btn" id="cal-btn-jump-date">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <span>Jump to date</span>
          </button>
        </div>

        <div class="cal-grid-header">
          <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span>
        </div>

        <div class="cal-grid">
          ${cells.map(c => `
            <div class="cal-cell ${c.isOtherMonth ? 'other-month' : ''} ${c.isToday ? 'is-today' : ''} ${c.count > 0 ? 'has-entries' : ''}"
                 ${c.dateKey ? `data-date-key="${c.dateKey}"` : ''}>
              <span class="cell-day-num">${c.day}</span>
              ${c.count > 0 ? `
                <div class="cell-entry-indicator">
                  <span class="cell-dot"></span>
                  ${c.count > 1 ? `<span class="cell-count">${c.count}</span>` : ''}
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // --- Day Timeline View ---

  renderDayTimelineView() {
    const selectedDate = this.parseDateKey(this.selectedDateKey);
    const dayEntries = this.getEntriesForDateKey(this.selectedDateKey);
    const dateTitle = this.formatDateShort(selectedDate);
    const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(selectedDate);

    return `
      <div class="day-timeline-view" id="day-timeline-container">
        <div class="day-top-bar">
          <button class="cal-btn-back" id="btn-timeline-to-cal" aria-label="Back to Month Calendar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
            <span>Month</span>
          </button>

          <div class="day-stepper">
            <button class="cal-nav-arrow" id="timeline-prev-day" aria-label="Previous day">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
            <div class="day-title-wrap">
              <span class="day-header-main">${dateTitle}</span>
              <span class="day-header-sub">${weekday}</span>
            </div>
            <button class="cal-nav-arrow" id="timeline-next-day" aria-label="Next day">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          </div>

          <button class="cal-pill-btn" id="timeline-btn-today">Today</button>
        </div>

        <div class="day-timeline-body">
          <div class="section-title-row">
            <span class="section-title">Timeline</span>
            <span class="entry-count-pill">${dayEntries.length}</span>
          </div>

          ${dayEntries.length === 0 ? `
            <div class="empty-state">
              <div class="empty-icon">📅</div>
              <p class="empty-title">No entries for this day</p>
              <p class="empty-subtitle">Tap the + button to add an entry on this date</p>
            </div>
          ` : `
            <div class="entries-list">
              ${dayEntries.map(entry => this.renderEntryCard(entry)).join('')}
            </div>
          `}
        </div>
      </div>
    `;
  }

  // --- Attach Event Listeners ---

  attachHeaderListeners() {
    const btnCal = this.container.querySelector('#btn-toggle-calendar');
    if (btnCal) {
      btnCal.onclick = () => {
        if (this.activeView === 'calendar') {
          this.activeView = 'landing';
        } else {
          this.activeView = 'calendar';
        }
        this.render();
      };
    }

    const btnSettings = this.container.querySelector('#btn-open-settings');
    if (btnSettings) {
      btnSettings.onclick = () => this.openSettingsModal();
    }

    const btnLock = this.container.querySelector('#btn-lock-now');
    if (btnLock) {
      btnLock.onclick = () => this.onLock();
    }

    const fabNew = this.container.querySelector('#btn-fab-new');
    if (fabNew) {
      fabNew.onclick = () => {
        // If in day view, create entry for that day; otherwise for today
        if (this.activeView === 'day_timeline') {
          const targetD = this.parseDateKey(this.selectedDateKey);
          const now = new Date();
          targetD.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
          this.openEntryEditor(null, targetD.getTime());
        } else {
          this.openEntryEditor(null, Date.now());
        }
      };
    }
  }

  attachViewListeners() {
    // Click on entry cards to edit
    const cards = this.container.querySelectorAll('.entry-card');
    cards.forEach(card => {
      card.onclick = () => {
        const id = card.getAttribute('data-entry-id');
        this.openEntryEditor(id);
      };
    });

    if (this.activeView === 'calendar') {
      this.attachCalendarListeners();
    } else if (this.activeView === 'day_timeline') {
      this.attachTimelineListeners();
    }
  }

  attachCalendarListeners() {
    const btnClose = this.container.querySelector('#cal-btn-close');
    if (btnClose) {
      btnClose.onclick = () => {
        this.activeView = 'landing';
        this.render();
      };
    }

    const prevMonth = this.container.querySelector('#cal-prev-month');
    if (prevMonth) {
      prevMonth.onclick = () => {
        this.calMonth--;
        if (this.calMonth < 0) {
          this.calMonth = 11;
          this.calYear--;
        }
        this.render();
      };
    }

    const nextMonth = this.container.querySelector('#cal-next-month');
    if (nextMonth) {
      nextMonth.onclick = () => {
        this.calMonth++;
        if (this.calMonth > 11) {
          this.calMonth = 0;
          this.calYear++;
        }
        this.render();
      };
    }

    const btnToday = this.container.querySelector('#cal-btn-today');
    if (btnToday) {
      btnToday.onclick = () => {
        const now = new Date();
        this.calYear = now.getFullYear();
        this.calMonth = now.getMonth();
        this.selectedDateKey = this.getLocalDateKey(now);
        this.activeView = 'landing';
        this.render();
      };
    }

    const btnJumpDate = this.container.querySelector('#cal-btn-jump-date');
    if (btnJumpDate) {
      btnJumpDate.onclick = () => this.openJumpDatePicker();
    }

    const titlePicker = this.container.querySelector('#cal-title-picker');
    if (titlePicker) {
      titlePicker.onclick = () => this.openMonthYearPicker();
    }

    // Tapping on a day cell
    const cells = this.container.querySelectorAll('.cal-cell[data-date-key]');
    cells.forEach(cell => {
      cell.onclick = () => {
        const dateKey = cell.getAttribute('data-date-key');
        if (dateKey) {
          this.selectedDateKey = dateKey;
          this.activeView = 'day_timeline';
          this.render();
        }
      };
    });
  }

  attachTimelineListeners() {
    const btnBackToCal = this.container.querySelector('#btn-timeline-to-cal');
    if (btnBackToCal) {
      btnBackToCal.onclick = () => {
        this.activeView = 'calendar';
        this.render();
      };
    }

    const prevDay = this.container.querySelector('#timeline-prev-day');
    if (prevDay) {
      prevDay.onclick = () => this.stepDay(-1);
    }

    const nextDay = this.container.querySelector('#timeline-next-day');
    if (nextDay) {
      nextDay.onclick = () => this.stepDay(1);
    }

    const btnToday = this.container.querySelector('#timeline-btn-today');
    if (btnToday) {
      btnToday.onclick = () => {
        this.selectedDateKey = this.getLocalDateKey(new Date());
        this.render();
      };
    }

    // Touch swipe left/right navigation for day timeline
    const timelineEl = this.container.querySelector('#day-timeline-container');
    if (timelineEl) {
      timelineEl.ontouchstart = (e) => {
        if (e.touches && e.touches.length === 1) {
          this.touchStartX = e.touches[0].clientX;
          this.touchStartY = e.touches[0].clientY;
        }
      };

      timelineEl.ontouchend = (e) => {
        if (e.changedTouches && e.changedTouches.length === 1) {
          const deltaX = e.changedTouches[0].clientX - this.touchStartX;
          const deltaY = e.changedTouches[0].clientY - this.touchStartY;
          // Horizontal swipe threshold 60px, vertical limit 50px
          if (Math.abs(deltaX) > 60 && Math.abs(deltaY) < 60) {
            if (deltaX < 0) {
              // Swipe left -> next day
              this.stepDay(1);
            } else {
              // Swipe right -> prev day
              this.stepDay(-1);
            }
          }
        }
      };
    }
  }

  stepDay(offset) {
    const curDate = this.parseDateKey(this.selectedDateKey);
    curDate.setDate(curDate.getDate() + offset);
    this.selectedDateKey = this.getLocalDateKey(curDate);
    // Also keep calendar month in sync
    this.calYear = curDate.getFullYear();
    this.calMonth = curDate.getMonth();
    this.render();
  }

  parseDateKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  // --- Entry Editor (Compose / Edit) ---

  openEntryEditor(entryId = null, defaultTimestamp = Date.now()) {
    let entry = null;
    if (entryId) {
      entry = this.entries.find(e => e.id === entryId);
    }

    this.currentEditingId = entryId;
    this.draftText = entry ? entry.text : '';
    this.draftTimestamp = entry ? entry.createdAt : defaultTimestamp;

    const d = new Date(this.draftTimestamp);
    const dateInputVal = this.getLocalDateKey(d);
    const timeInputVal = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

    const modal = document.createElement('div');
    modal.className = 'editor-overlay';
    modal.innerHTML = `
      <div class="editor-screen">
        <header class="editor-header">
          <button class="icon-btn" id="editor-btn-close" aria-label="Cancel">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>

          <div class="editor-meta-inputs">
            <input type="date" id="editor-input-date" class="editor-date-pill" value="${dateInputVal}" />
            <input type="time" id="editor-input-time" class="editor-time-pill" value="${timeInputVal}" />
          </div>

          <div class="editor-actions">
            ${entryId ? `
              <button class="icon-btn btn-danger" id="editor-btn-delete" title="Delete entry" aria-label="Delete entry">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            ` : ''}
            <button class="save-pill-btn" id="editor-btn-save">Save</button>
          </div>
        </header>

        <div class="editor-body">
          <textarea id="editor-textarea" class="editor-textarea" placeholder="Write here...">${this.escapeHtml(this.draftText)}</textarea>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const textarea = modal.querySelector('#editor-textarea');
    textarea.focus();
    // Move cursor to end
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;

    // Auto-save draft changes in memory and debounce to storage
    textarea.oninput = () => {
      this.draftText = textarea.value;
      this.triggerAutoSave();
    };

    const dateInput = modal.querySelector('#editor-input-date');
    const timeInput = modal.querySelector('#editor-input-time');

    const updateTimestampFromInputs = () => {
      const [y, m, d] = dateInput.value.split('-').map(Number);
      const [h, min] = timeInput.value.split(':').map(Number);
      const newD = new Date(y, m - 1, d, h || 0, min || 0, 0);
      this.draftTimestamp = newD.getTime();
    };

    dateInput.onchange = updateTimestampFromInputs;
    timeInput.onchange = updateTimestampFromInputs;

    modal.querySelector('#editor-btn-close').onclick = () => {
      modal.remove();
    };

    modal.querySelector('#editor-btn-save').onclick = async () => {
      updateTimestampFromInputs();
      await this.commitEntry();
      modal.remove();
      this.render();
    };

    if (entryId) {
      modal.querySelector('#editor-btn-delete').onclick = () => {
        this.confirmAction('Delete this entry?', async () => {
          await this.deleteEntry(entryId);
          modal.remove();
          this.render();
        });
      };
    }
  }

  triggerAutoSave() {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(async () => {
      if (this.currentEditingId && this.draftText.trim()) {
        await this.commitEntry(false);
      }
    }, 1000);
  }

  async commitEntry(renderAfter = true) {
    const text = this.draftText.trim();
    if (!text) return;

    let targetEntry;
    const now = Date.now();

    if (this.currentEditingId) {
      targetEntry = this.entries.find(e => e.id === this.currentEditingId);
      if (targetEntry) {
        targetEntry.text = text;
        targetEntry.createdAt = this.draftTimestamp;
        targetEntry.editedAt = now;
      }
    } else {
      targetEntry = {
        id: crypto.randomUUID(),
        createdAt: this.draftTimestamp,
        editedAt: this.draftTimestamp,
        text: text
      };
      this.entries.push(targetEntry);
      this.currentEditingId = targetEntry.id;
    }

    if (targetEntry && this.masterKey) {
      const encrypted = await encryptEntry(targetEntry, this.masterKey);
      await saveEncryptedEntry(encrypted);
    }

    if (renderAfter) {
      this.render();
    }
  }

  async deleteEntry(entryId) {
    this.entries = this.entries.filter(e => e.id !== entryId);
    await deleteEncryptedEntry(entryId);
  }

  // --- Month / Year Jump Pickers ---

  openMonthYearPicker() {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    let tempYear = this.calYear;

    modal.innerHTML = `
      <div class="modal-card">
        <div class="modal-header">
          <span class="modal-title">Select Month & Year</span>
          <button class="icon-btn modal-close-btn">&times;</button>
        </div>
        <div class="year-stepper">
          <button class="cal-nav-arrow" id="year-prev">&lt;</button>
          <span class="year-label" id="year-display">${tempYear}</span>
          <button class="cal-nav-arrow" id="year-next">&gt;</button>
        </div>
        <div class="month-selector-grid">
          ${months.map((m, idx) => `
            <button class="month-pick-btn ${idx === this.calMonth ? 'active' : ''}" data-month="${idx}">
              ${m}
            </button>
          `).join('')}
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const yearDisplay = modal.querySelector('#year-display');
    modal.querySelector('#year-prev').onclick = () => {
      tempYear--;
      yearDisplay.textContent = tempYear;
    };
    modal.querySelector('#year-next').onclick = () => {
      tempYear++;
      yearDisplay.textContent = tempYear;
    };

    modal.querySelectorAll('.month-pick-btn').forEach(btn => {
      btn.onclick = () => {
        this.calYear = tempYear;
        this.calMonth = parseInt(btn.getAttribute('data-month'), 10);
        modal.remove();
        this.render();
      };
    });

    modal.querySelector('.modal-close-btn').onclick = () => modal.remove();
  }

  openJumpDatePicker() {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-card">
        <div class="modal-header">
          <span class="modal-title">Jump to Date</span>
          <button class="icon-btn modal-close-btn">&times;</button>
        </div>
        <div class="modal-body">
          <input type="date" id="jump-date-input" class="generic-input" value="${this.selectedDateKey}" />
        </div>
        <div class="modal-actions">
          <button class="cal-pill-btn" id="jump-btn-cancel">Cancel</button>
          <button class="save-pill-btn" id="jump-btn-confirm">Jump</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#jump-btn-cancel').onclick = () => modal.remove();
    modal.querySelector('.modal-close-btn').onclick = () => modal.remove();
    modal.querySelector('#jump-btn-confirm').onclick = () => {
      const val = modal.querySelector('#jump-date-input').value;
      if (val) {
        this.selectedDateKey = val;
        const d = this.parseDateKey(val);
        this.calYear = d.getFullYear();
        this.calMonth = d.getMonth();
        this.activeView = 'day_timeline';
        modal.remove();
        this.render();
      }
    };
  }

  // --- Settings (Secret Change, Backup Export & Import) ---

  openSettingsModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-card settings-card">
        <div class="modal-header">
          <span class="modal-title">Settings</span>
          <button class="icon-btn modal-close-btn">&times;</button>
        </div>

        <div class="settings-list">
          <button class="settings-item-btn" id="set-btn-change-secret">
            <div class="item-info">
              <span class="item-title">Change Secret Calculation</span>
              <span class="item-desc">Update the calculation used to unlock the diary</span>
            </div>
            <span class="item-arrow">&gt;</span>
          </button>

          <button class="settings-item-btn" id="set-btn-export-backup">
            <div class="item-info">
              <span class="item-title">Export Encrypted Backup</span>
              <span class="item-desc">Download an encrypted backup file of all entries</span>
            </div>
            <span class="item-arrow">&gt;</span>
          </button>

          <button class="settings-item-btn" id="set-btn-import-backup">
            <div class="item-info">
              <span class="item-title">Import Backup</span>
              <span class="item-desc">Restore or merge entries from a backup file</span>
            </div>
            <span class="item-arrow">&gt;</span>
          </button>

          <button class="settings-item-btn item-danger" id="set-btn-lock">
            <div class="item-info">
              <span class="item-title">Lock Now</span>
              <span class="item-desc">Clear memory and return to calculator</span>
            </div>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('.modal-close-btn').onclick = () => modal.remove();

    modal.querySelector('#set-btn-lock').onclick = () => {
      modal.remove();
      this.onLock();
    };

    modal.querySelector('#set-btn-change-secret').onclick = () => {
      modal.remove();
      this.openChangeSecretFlow();
    };

    modal.querySelector('#set-btn-export-backup').onclick = () => {
      this.exportBackup();
    };

    modal.querySelector('#set-btn-import-backup').onclick = () => {
      modal.remove();
      this.openImportBackupFlow();
    };
  }

  // Change Secret Flow
  openChangeSecretFlow() {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-card">
        <div class="modal-header">
          <span class="modal-title">Change Secret Calculation</span>
          <button class="icon-btn modal-close-btn">&times;</button>
        </div>
        <div class="modal-body">
          <label class="input-label">Current Secret Calculation</label>
          <input type="text" id="cur-secret" class="generic-input" placeholder="e.g. 2500*4+999" autocomplete="off" />

          <label class="input-label" style="margin-top:12px;">New Secret Calculation</label>
          <input type="text" id="new-secret-1" class="generic-input" placeholder="At least 8 chars with operators & digits" autocomplete="off" />

          <label class="input-label" style="margin-top:12px;">Confirm New Secret Calculation</label>
          <input type="text" id="new-secret-2" class="generic-input" placeholder="Repeat new calculation" autocomplete="off" />

          <div id="secret-error-msg" class="inline-error"></div>
        </div>
        <div class="modal-actions">
          <button class="cal-pill-btn" id="change-sec-cancel">Cancel</button>
          <button class="save-pill-btn" id="change-sec-save">Update Secret</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const errBox = modal.querySelector('#secret-error-msg');
    modal.querySelector('.modal-close-btn').onclick = () => modal.remove();
    modal.querySelector('#change-sec-cancel').onclick = () => modal.remove();

    modal.querySelector('#change-sec-save').onclick = async () => {
      errBox.textContent = '';
      const curSecret = modal.querySelector('#cur-secret').value;
      const new1 = modal.querySelector('#new-secret-1').value;
      const new2 = modal.querySelector('#new-secret-2').value;

      // 1. Verify current secret
      const meta = await getMeta();
      if (!meta) {
        errBox.textContent = 'Storage metadata missing.';
        return;
      }

      try {
        await unwrapMasterKeyWithSecret(curSecret, meta.salt, meta.iterations, meta.wrappedMasterKeyA, meta.ivA);
      } catch {
        errBox.textContent = 'Current calculation is incorrect.';
        return;
      }

      // 2. Validate new secret rules
      const normNew = normalizeExpression(new1);
      if (normNew.length < 8) {
        errBox.textContent = 'New secret must be at least 8 characters long.';
        return;
      }
      if (!/[0-9]/.test(normNew)) {
        errBox.textContent = 'New secret must contain digits.';
        return;
      }
      if (!/[+\-*\/%]/.test(normNew)) {
        errBox.textContent = 'New secret must contain at least one operator (+, -, ×, ÷, %).';
        return;
      }
      if (normalizeExpression(new1) !== normalizeExpression(new2)) {
        errBox.textContent = 'New calculations do not match.';
        return;
      }

      // 3. Re-wrap master key with new secret key
      try {
        const newSalt = crypto.getRandomValues(new Uint8Array(16));
        const newWrapKey = await deriveKeyFromSecret(normNew, newSalt, meta.iterations);
        const { wrapped, iv } = await wrapMasterKey(this.masterKey, newWrapKey);

        meta.salt = newSalt;
        meta.wrappedMasterKeyA = wrapped;
        meta.ivA = iv;
        await saveMeta(meta);

        modal.remove();
        this.showToast('Secret calculation updated successfully!');
      } catch (e) {
        console.error('Failed to update secret', e);
        errBox.textContent = 'Failed to update secret calculation.';
      }
    };
  }

  // Backup Export
  async exportBackup() {
    try {
      const meta = await getMeta();
      const allEncrypted = await getAllEncryptedEntries();

      // Master key wrapped only with secret key (copy A), salt, iterations
      const backupData = {
        version: 1,
        exportedAt: Date.now(),
        iterations: meta.iterations,
        salt: bufferToBase64(meta.salt),
        wrappedMasterKeyA: bufferToBase64(meta.wrappedMasterKeyA),
        ivA: bufferToBase64(meta.ivA),
        entries: allEncrypted.map(e => ({
          id: e.id,
          iv: bufferToBase64(e.iv),
          ciphertext: bufferToBase64(e.ciphertext)
        }))
      };

      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = this.getLocalDateKey(new Date());
      a.href = url;
      a.download = `calculator-backup-${dateStr}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast('Backup downloaded successfully!');
    } catch (e) {
      console.error('Export failed', e);
      this.showToast('Failed to export backup.');
    }
  }

  // Backup Import
  openImportBackupFlow() {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-card">
        <div class="modal-header">
          <span class="modal-title">Import Backup</span>
          <button class="icon-btn modal-close-btn">&times;</button>
        </div>
        <div class="modal-body">
          <label class="input-label">Select Backup File (.json)</label>
          <input type="file" id="backup-file-input" accept=".json,application/json" class="generic-file-input" />

          <label class="input-label" style="margin-top:12px;">Secret Calculation for this Backup</label>
          <input type="text" id="backup-secret-input" class="generic-input" placeholder="Secret used when backup was created" autocomplete="off" />

          <div id="import-error-msg" class="inline-error"></div>
        </div>
        <div class="modal-actions">
          <button class="cal-pill-btn" id="import-btn-cancel">Cancel</button>
          <button class="save-pill-btn" id="import-btn-confirm">Restore & Merge</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const errBox = modal.querySelector('#import-error-msg');
    modal.querySelector('.modal-close-btn').onclick = () => modal.remove();
    modal.querySelector('#import-btn-cancel').onclick = () => modal.remove();

    modal.querySelector('#import-btn-confirm').onclick = async () => {
      errBox.textContent = '';
      const fileInput = modal.querySelector('#backup-file-input');
      const secretInput = modal.querySelector('#backup-secret-input').value;

      if (!fileInput.files || fileInput.files.length === 0) {
        errBox.textContent = 'Please choose a backup file.';
        return;
      }
      if (!secretInput) {
        errBox.textContent = 'Please enter the secret calculation for this backup.';
        return;
      }

      try {
        const file = fileInput.files[0];
        const text = await file.text();
        const backupData = JSON.parse(text);

        if (!backupData.wrappedMasterKeyA || !backupData.salt || !backupData.ivA) {
          errBox.textContent = 'Invalid backup file structure.';
          return;
        }

        const backupSalt = base64ToBuffer(backupData.salt);
        const backupWrappedA = base64ToBuffer(backupData.wrappedMasterKeyA);
        const backupIvA = base64ToBuffer(backupData.ivA);
        const backupIterations = backupData.iterations || DEFAULT_PBKDF2_ITERATIONS;

        // Unwrap backup's master key
        let backupMasterKey;
        try {
          backupMasterKey = await unwrapMasterKeyWithSecret(
            secretInput,
            backupSalt,
            backupIterations,
            backupWrappedA,
            backupIvA
          );
        } catch {
          errBox.textContent = 'Incorrect secret calculation for this backup.';
          return;
        }

        // Decrypt entries from backup
        let importedCount = 0;
        const newEncryptedToSave = [];

        for (const item of backupData.entries) {
          try {
            const rawRec = {
              id: item.id,
              iv: base64ToBuffer(item.iv),
              ciphertext: base64ToBuffer(item.ciphertext)
            };
            const entryObj = await decryptEntry(rawRec, backupMasterKey);

            // Check if already in memory
            const existingIdx = this.entries.findIndex(e => e.id === entryObj.id);
            if (existingIdx === -1) {
              this.entries.push(entryObj);
              // Re-encrypt with CURRENT master key
              const reEncrypted = await encryptEntry(entryObj, this.masterKey);
              newEncryptedToSave.push(reEncrypted);
              importedCount++;
            }
          } catch (itemErr) {
            console.error('Failed to restore entry item', item.id, itemErr);
          }
        }

        if (newEncryptedToSave.length > 0) {
          await saveAllEncryptedEntries(newEncryptedToSave);
        }

        modal.remove();
        this.showToast(`Imported ${importedCount} new entries.`);
        this.render();
      } catch (e) {
        console.error('Backup import error', e);
        errBox.textContent = 'Failed to read or parse backup file.';
      }
    };
  }

  // Confirmation dialog helper
  confirmAction(message, onConfirm) {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-card">
        <div class="modal-body">
          <p class="confirm-text">${message}</p>
        </div>
        <div class="modal-actions">
          <button class="cal-pill-btn" id="confirm-cancel">Cancel</button>
          <button class="save-pill-btn btn-danger" id="confirm-ok">Delete</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#confirm-cancel').onclick = () => modal.remove();
    modal.querySelector('#confirm-ok').onclick = () => {
      modal.remove();
      onConfirm();
    };
  }

  showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'app-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 400);
    }, 2500);
  }

  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
