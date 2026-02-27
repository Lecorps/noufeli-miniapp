// main.ts  –  QuestBot Mini App entry point
// Vanilla TS + DOM (no framework dependency)

import { api } from './api';
import type { TaskRow, HabitRow, SummaryData, Tab } from './types';
import { EMOTION_LIST, CATEGORY_COLORS, HORIZON_ORDER } from './types';

// ---------------------------------------------------------------------------
// Telegram WebApp helpers
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    Telegram: {
      WebApp: {
        initData: string;
        initDataUnsafe: { user?: { id: number; first_name: string } };
        ready: () => void;
        close: () => void;
        expand: () => void;
        MainButton: {
          text: string; show: () => void; hide: () => void;
          onClick: (fn: () => void) => void; offClick: (fn: () => void) => void;
        };
        themeParams: { bg_color?: string; text_color?: string; button_color?: string; button_text_color?: string };
        colorScheme: 'light' | 'dark';
        showAlert: (msg: string, cb?: () => void) => void;
        showConfirm: (msg: string, cb: (ok: boolean) => void) => void;
        HapticFeedback: { impactOccurred: (style: string) => void; notificationOccurred: (type: string) => void };
      };
    };
  }
}

const tg = window.Telegram?.WebApp;
tg?.expand();
tg?.ready();

const userId = String(tg?.initDataUnsafe?.user?.id || 'preview');
const userName = tg?.initDataUnsafe?.user?.first_name || 'Adventurer';

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

interface AppState {
  tab:            Tab;
  readyTasks:     TaskRow[];
  completedTasks: TaskRow[];
  habits:         HabitRow[];
  summary:        SummaryData | null;
  loading:        boolean;
  activeFocus:    string | null;  // activityId currently in focus
  modal:          ModalState | null;
}

interface ModalState {
  type: 'enrich' | 'breakdown' | 'focus' | 'evaluate' | 'habit-log';
  task?: TaskRow;
  habit?: HabitRow;
}

const state: AppState = {
  tab:            'do',
  readyTasks:     [],
  completedTasks: [],
  habits:         [],
  summary:        null,
  loading:        false,
  activeFocus:    null,
  modal:          null
};

// Read tab from URL param (set by bot when opening Mini App)
const urlParams = new URLSearchParams(window.location.search);
const urlTab = urlParams.get('tab');
if (urlTab === 'evaluate') state.tab = 'evaluate';

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render() {
  const app = document.getElementById('app')!;
  app.innerHTML = '';
  app.appendChild(renderHeader());
  app.appendChild(renderTabs());
  const content = document.createElement('div');
  content.className = 'content';

  if (state.loading) {
    content.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading quests…</p></div>';
  } else {
    switch (state.tab) {
      case 'do':       content.appendChild(renderDoTab());       break;
      case 'evaluate': content.appendChild(renderEvaluateTab()); break;
      case 'habits':   content.appendChild(renderHabitsTab());   break;
      case 'summary':  content.appendChild(renderSummaryTab());  break;
    }
  }
  app.appendChild(content);

  if (state.modal) {
    app.appendChild(renderModal(state.modal));
  }
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function renderHeader(): HTMLElement {
  const header = document.createElement('div');
  header.className = 'header';

  const title = document.createElement('div');
  title.className = 'header-title';
  title.innerHTML = '⚔️ <strong>QuestBot</strong>';

  const info = document.createElement('div');
  info.className = 'header-info';
  if (state.summary) {
    info.innerHTML = `
      <span class="badge xp">✨ ${state.summary.totalXP} XP</span>
      <span class="badge hp">❤️ ${state.summary.hp}/100</span>
      <span class="badge rank">🏅 ${state.summary.rank}</span>
    `;
  } else {
    info.textContent = `Hi, ${userName}!`;
  }

  header.appendChild(title);
  header.appendChild(info);
  return header;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function renderTabs(): HTMLElement {
  const tabs = document.createElement('div');
  tabs.className = 'tabs';

  const tabDefs: { id: Tab; label: string }[] = [
    { id: 'do',       label: '⚔️ Do' },
    { id: 'evaluate', label: '📊 Evaluate' },
    { id: 'habits',   label: '📿 Habits' },
    { id: 'summary',  label: '🗺️ Map' }
  ];

  tabDefs.forEach(({ id, label }) => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (state.tab === id ? ' active' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => switchTab(id));
    tabs.appendChild(btn);
  });

  return tabs;
}

function switchTab(tab: Tab) {
  state.tab = tab;
  loadTabData(tab);
}

async function loadTabData(tab: Tab) {
  state.loading = true;
  render();
  try {
    if (tab === 'do')       state.readyTasks     = await api.getReadyTasks(userId);
    if (tab === 'evaluate') state.completedTasks = await api.getCompletedTasks(userId);
    if (tab === 'habits')   state.habits         = await api.getHabits(userId);
    if (tab === 'summary')  state.summary        = await api.getSummary(userId);
  } catch (e) {
    console.error(e);
  }
  state.loading = false;
  render();
}

// ---------------------------------------------------------------------------
// Do Tab
// ---------------------------------------------------------------------------

function renderDoTab(): HTMLElement {
  const div = document.createElement('div');

  if (state.readyTasks.length === 0) {
    div.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🌟</div>
        <h3>All clear, adventurer!</h3>
        <p>No tasks ready. Forward messages to the bot to capture quests.</p>
      </div>`;
    return div;
  }

  // Group by category
  const grouped = groupBy(state.readyTasks, t => t.category || 'uncategorized');

  Object.entries(grouped).forEach(([cat, tasks]) => {
    const section = document.createElement('div');
    section.className = 'task-section';

    const sectionHeader = document.createElement('div');
    sectionHeader.className = 'section-header';
    sectionHeader.style.borderLeftColor = CATEGORY_COLORS[cat] || '#999';
    sectionHeader.innerHTML = `<span class="cat-label">${cat}</span><span class="cat-count">${tasks.length}</span>`;
    section.appendChild(sectionHeader);

    tasks.forEach(task => {
      section.appendChild(renderTaskCard(task, 'do'));
    });

    div.appendChild(section);
  });

  return div;
}

// ---------------------------------------------------------------------------
// Evaluate Tab
// ---------------------------------------------------------------------------

function renderEvaluateTab(): HTMLElement {
  const div = document.createElement('div');

  if (state.completedTasks.length === 0) {
    div.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🏆</div>
        <h3>Nothing to evaluate yet!</h3>
        <p>Complete tasks in the Do tab first.</p>
      </div>`;
    return div;
  }

  state.completedTasks.forEach(task => {
    div.appendChild(renderTaskCard(task, 'evaluate'));
  });

  return div;
}

// ---------------------------------------------------------------------------
// Habits Tab
// ---------------------------------------------------------------------------

function renderHabitsTab(): HTMLElement {
  const div = document.createElement('div');

  if (state.habits.length === 0) {
    div.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📿</div>
        <h3>No habits yet!</h3>
        <p>Use the bot command /habits to create your first habit.</p>
      </div>`;
    return div;
  }

  state.habits.forEach(habit => {
    const card = document.createElement('div');
    card.className = 'habit-card';
    card.innerHTML = `
      <div class="habit-info">
        <div class="habit-name">${habit.habit}</div>
        <div class="habit-meta">
          ${habit.lifeArea ? `<span class="badge life-area">${habit.lifeArea}</span>` : ''}
          <span class="badge streak">🔥 ${habit.streak} day streak</span>
          <span class="badge max-streak">⭐ Best: ${habit.maxStreak}</span>
        </div>
      </div>
      <button class="log-btn">Log</button>
    `;
    card.querySelector('.log-btn')!.addEventListener('click', () => openHabitLog(habit));
    div.appendChild(card);
  });

  return div;
}

// ---------------------------------------------------------------------------
// Summary Tab
// ---------------------------------------------------------------------------

function renderSummaryTab(): HTMLElement {
  const div = document.createElement('div');

  if (!state.summary) {
    div.innerHTML = '<p class="muted">Loading summary…</p>';
    return div;
  }

  const s = state.summary;
  div.innerHTML = `
    <div class="summary-card">
      <div class="summary-title">🗺️ Quest Map</div>
      <div class="stat-grid">
        <div class="stat"><div class="stat-val">${s.level}</div><div class="stat-label">Level</div></div>
        <div class="stat"><div class="stat-val">${s.rank}</div><div class="stat-label">Rank</div></div>
        <div class="stat"><div class="stat-val">${s.totalXP}</div><div class="stat-label">Total XP</div></div>
        <div class="stat"><div class="stat-val">${s.hp}/100</div><div class="stat-label">HP</div></div>
      </div>
      <div class="progress-bar-wrap">
        <div class="progress-bar" style="width:${(s.hp)}%"></div>
      </div>
    </div>
    <div class="summary-card">
      <div class="summary-title">📋 Quest Stats</div>
      <div class="stat-grid">
        <div class="stat"><div class="stat-val">${s.capturedCount}</div><div class="stat-label">Captured</div></div>
        <div class="stat"><div class="stat-val">${s.readyCount}</div><div class="stat-label">Ready</div></div>
        <div class="stat"><div class="stat-val">${s.doneCount}</div><div class="stat-label">Completed</div></div>
        <div class="stat"><div class="stat-val">${s.goalCount}</div><div class="stat-label">Goals</div></div>
      </div>
    </div>
  `;

  return div;
}

// ---------------------------------------------------------------------------
// Task card
// ---------------------------------------------------------------------------

function renderTaskCard(task: TaskRow, mode: 'do' | 'evaluate'): HTMLElement {
  const card = document.createElement('div');
  card.className = 'task-card';

  const catColor = CATEGORY_COLORS[task.category] || '#6b7280';
  card.style.borderLeftColor = catColor;

  const horizonBadge = task.horizon ? `<span class="badge horizon">${task.horizon}</span>` : '';
  const areaBadge = task.lifeArea  ? `<span class="badge area">${task.lifeArea}</span>` : '';
  const xpBadge   = mode === 'evaluate' ? `<span class="badge xp-earned">✨ +${task.doneXP || 0} XP</span>` : '';

  card.innerHTML = `
    <div class="task-title">${task.activity || '(no title)'}</div>
    <div class="task-meta">
      ${horizonBadge}${areaBadge}${xpBadge}
      ${task.goal ? `<span class="badge goal">🎯 ${task.goal.substring(0,30)}</span>` : ''}
    </div>
    ${task.mentalBlock ? `<div class="task-block">🧠 ${task.mentalBlock}</div>` : ''}
  `;

  if (mode === 'do') {
    const actions = document.createElement('div');
    actions.className = 'task-actions';

    if (state.activeFocus === task.activityId) {
      // Currently in focus
      const doneBtn = document.createElement('button');
      doneBtn.className = 'btn btn-success';
      doneBtn.textContent = '✅ Done!';
      doneBtn.addEventListener('click', () => finishFocus(task.activityId));
      actions.appendChild(doneBtn);
    } else {
      const enrichBtn = document.createElement('button');
      enrichBtn.className = 'btn btn-secondary';
      enrichBtn.textContent = '✏️ Enrich';
      enrichBtn.addEventListener('click', () => openModal({ type: 'enrich', task }));

      const breakBtn = document.createElement('button');
      breakBtn.className = 'btn btn-secondary';
      breakBtn.textContent = '🔀 Break';
      breakBtn.addEventListener('click', () => openModal({ type: 'breakdown', task }));

      const focusBtn = document.createElement('button');
      focusBtn.className = 'btn btn-primary';
      focusBtn.textContent = '▶ Start';
      focusBtn.addEventListener('click', () => openModal({ type: 'focus', task }));

      actions.appendChild(enrichBtn);
      actions.appendChild(breakBtn);
      actions.appendChild(focusBtn);
    }

    card.appendChild(actions);
  }

  if (mode === 'evaluate') {
    const evalBtn = document.createElement('button');
    evalBtn.className = 'btn btn-primary full-width';
    evalBtn.textContent = '📊 Evaluate';
    evalBtn.addEventListener('click', () => openModal({ type: 'evaluate', task }));
    card.appendChild(evalBtn);
  }

  return card;
}

// ---------------------------------------------------------------------------
// Modal rendering
// ---------------------------------------------------------------------------

function renderModal(modal: ModalState): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  const box = document.createElement('div');
  box.className = 'modal-box';

  switch (modal.type) {
    case 'focus':     box.appendChild(renderFocusModal(modal.task!));     break;
    case 'enrich':    box.appendChild(renderEnrichModal(modal.task!));    break;
    case 'breakdown': box.appendChild(renderBreakdownModal(modal.task!)); break;
    case 'evaluate':  box.appendChild(renderEvaluateModal(modal.task!));  break;
    case 'habit-log': box.appendChild(renderHabitLogModal(modal.habit!)); break;
  }

  overlay.appendChild(box);
  return overlay;
}

// Focus modal
function renderFocusModal(task: TaskRow): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = `
    <h3>▶ Start Focus</h3>
    <p class="task-name">${task.activity}</p>
    <label>How are you feeling? <select id="feelingB4">${EMOTION_LIST.map(e => `<option value="${e}">${e}</option>`).join('')}</select></label>
    <label>Estimated time (min): <input id="estTime" type="number" min="5" step="5" value="${task.estTime || 25}" /></label>
  `;

  const btn = document.createElement('button');
  btn.className = 'btn btn-primary full-width';
  btn.textContent = '🎯 Begin Focus Session';
  btn.addEventListener('click', async () => {
    const feeling = (div.querySelector('#feelingB4') as HTMLSelectElement).value;
    const estTime = (div.querySelector('#estTime') as HTMLInputElement).value;
    await api.startFocus(task.activityId, userId, feeling, estTime + ' min');
    state.activeFocus = task.activityId;
    closeModal();
    tg?.HapticFeedback?.impactOccurred('medium');
    render();
  });

  div.appendChild(btn);
  addCloseButton(div);
  return div;
}

// Enrich modal
function renderEnrichModal(task: TaskRow): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = `
    <h3>✏️ Enrich Task</h3>
    <p class="task-name">${task.activity}</p>
    <label>Feeling before: <select id="feelingB4">${EMOTION_LIST.map(e => `<option value="${e}" ${task.feelingB4===e?'selected':''}>${e}</option>`).join('')}</select></label>
    <label>Est. time (min): <input id="estTime" type="number" min="5" step="5" value="${task.estTime || ''}" /></label>
    <label>INCUP tags: <input id="incup" type="text" value="${task.incup || ''}" placeholder="e.g. Important,Uncomfortable" /></label>
  `;
  const btn = document.createElement('button');
  btn.className = 'btn btn-primary full-width';
  btn.textContent = '💾 Save';
  btn.addEventListener('click', async () => {
    const feeling = (div.querySelector('#feelingB4') as HTMLSelectElement).value;
    const estTime = (div.querySelector('#estTime') as HTMLInputElement).value;
    const incup   = (div.querySelector('#incup') as HTMLInputElement).value;
    await api.enrichTask(task.activityId, userId, feeling, estTime, incup);
    closeModal();
    loadTabData('do');
  });
  div.appendChild(btn);
  addCloseButton(div);
  return div;
}

// Breakdown modal
function renderBreakdownModal(task: TaskRow): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = `
    <h3>🔀 Break Down Task</h3>
    <p class="task-name">${task.activity}</p>
    <p class="muted">Enter subtasks, one per line:</p>
    <textarea id="subtasks" rows="5" placeholder="Subtask 1\nSubtask 2\n..."></textarea>
  `;
  const btn = document.createElement('button');
  btn.className = 'btn btn-primary full-width';
  btn.textContent = '➕ Create Subtasks';
  btn.addEventListener('click', async () => {
    const text = (div.querySelector('#subtasks') as HTMLTextAreaElement).value;
    const subtasks = text.split('\n').map(s => s.trim()).filter(Boolean).map(activity => ({ activity }));
    if (subtasks.length === 0) return;
    const result = await api.breakdownTask(task.activityId, userId, subtasks);
    closeModal();
    tg?.showAlert?.(`Created ${result.createdIds.length} subtasks!`);
    loadTabData('do');
  });
  div.appendChild(btn);
  addCloseButton(div);
  return div;
}

// Evaluate modal
function renderEvaluateModal(task: TaskRow): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = `
    <h3>📊 Evaluate Task</h3>
    <p class="task-name">${task.activity}</p>
    <p class="muted">Feeling before: <strong>${task.feelingB4 || 'not set'}</strong></p>
    <label>How do you feel after completing it?
      <select id="feelingAfter">${EMOTION_LIST.map(e => `<option value="${e}">${e}</option>`).join('')}</select>
    </label>
  `;
  const btn = document.createElement('button');
  btn.className = 'btn btn-primary full-width';
  btn.textContent = '✅ Submit Evaluation';
  btn.addEventListener('click', async () => {
    const feeling = (div.querySelector('#feelingAfter') as HTMLSelectElement).value;
    const result = await api.evaluateTask(task.activityId, userId, feeling);
    closeModal();
    tg?.HapticFeedback?.notificationOccurred('success');
    // Show XP animation
    showXPToast(`+${result.evaluateXP} EvalXP  |  Total: ${result.totalXP} ✨`);
    // Remove from list
    state.completedTasks = state.completedTasks.filter(t => t.activityId !== task.activityId);
    render();
  });
  div.appendChild(btn);
  addCloseButton(div);
  return div;
}

// Habit log modal
function renderHabitLogModal(habit: HabitRow): HTMLElement {
  const div = document.createElement('div');
  const variants = [
    { key: 'easy',   label: habit.easy   || 'Easy'   },
    { key: 'medium', label: habit.medium || 'Medium' },
    { key: 'hard',   label: habit.hard   || 'Hard'   },
    { key: 'peak',   label: habit.peak   || 'Peak'   }
  ].filter(v => v.label && v.label !== v.key);

  div.innerHTML = `
    <h3>📿 Log: ${habit.habit}</h3>
    <p>🔥 Current streak: <strong>${habit.streak}</strong></p>
    <label>Feeling before: <select id="emotionB4">${EMOTION_LIST.map(e => `<option>${e}</option>`).join('')}</select></label>
    <label>Mental block (optional): <input id="mentalBlock" type="text" placeholder="e.g. all-or-nothing" /></label>
    <p><strong>Select difficulty:</strong></p>
    <div class="difficulty-btns">
      ${variants.map(v => `<button class="btn btn-diff" data-diff="${v.key}">${v.label}</button>`).join('')}
    </div>
    <label>Feeling after: <select id="emotionAfter">${EMOTION_LIST.map(e => `<option>${e}</option>`).join('')}</select></label>
  `;

  let selectedDiff = '';
  div.querySelectorAll('.btn-diff').forEach(btn => {
    btn.addEventListener('click', () => {
      div.querySelectorAll('.btn-diff').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedDiff = (btn as HTMLElement).dataset.diff!;
    });
  });

  const logBtn = document.createElement('button');
  logBtn.className = 'btn btn-primary full-width';
  logBtn.style.marginTop = '12px';
  logBtn.textContent = '✅ Log Completion';
  logBtn.addEventListener('click', async () => {
    if (!selectedDiff) { tg?.showAlert?.('Please select a difficulty.'); return; }
    const emotionB4    = (div.querySelector('#emotionB4')    as HTMLSelectElement).value;
    const emotionAfter = (div.querySelector('#emotionAfter') as HTMLSelectElement).value;
    const mentalBlock  = (div.querySelector('#mentalBlock')  as HTMLInputElement).value;
    await api.logHabit(habit.rowIndex, userId, selectedDiff, emotionB4, emotionAfter, mentalBlock);
    closeModal();
    tg?.HapticFeedback?.notificationOccurred('success');
    showXPToast('🔥 Habit logged! Streak updated.');
    loadTabData('habits');
  });

  div.appendChild(logBtn);
  addCloseButton(div);
  return div;
}

// ---------------------------------------------------------------------------
// Modal helpers
// ---------------------------------------------------------------------------

function openModal(modal: ModalState) {
  state.modal = modal;
  render();
}

function closeModal() {
  state.modal = null;
  render();
}

function addCloseButton(parent: HTMLElement) {
  const btn = document.createElement('button');
  btn.className = 'btn btn-ghost full-width';
  btn.textContent = '✕ Cancel';
  btn.style.marginTop = '8px';
  btn.addEventListener('click', closeModal);
  parent.appendChild(btn);
}

// ---------------------------------------------------------------------------
// Focus completion
// ---------------------------------------------------------------------------

async function finishFocus(activityId: string) {
  const result = await api.completeFocus(activityId, userId);
  state.activeFocus = null;
  tg?.HapticFeedback?.notificationOccurred('success');
  showXPToast(`✅ Done!  +${result.doneXP} DoneXP  ❤️ HP: ${result.hp}`);
  loadTabData('do');
}

// ---------------------------------------------------------------------------
// Habit log opener
// ---------------------------------------------------------------------------

function openHabitLog(habit: HabitRow) {
  openModal({ type: 'habit-log', habit });
}

// ---------------------------------------------------------------------------
// XP toast notification
// ---------------------------------------------------------------------------

function showXPToast(message: string) {
  const toast = document.createElement('div');
  toast.className = 'xp-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  arr.forEach(item => {
    const k = key(item);
    if (!result[k]) result[k] = [];
    result[k].push(item);
  });
  return result;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function init() {
  state.loading = true;
  render();

  try {
    // Load summary for header
    state.summary = await api.getSummary(userId);
    // Load initial tab
    await loadTabData(state.tab);
  } catch (e) {
    console.error('Init failed:', e);
    state.loading = false;
    render();
  }
}

init();
