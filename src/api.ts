// api.ts  –  HTTP client for the Apps Script backend

import type { TaskRow, HabitRow, GoalRow, SummaryData, FocusResult, EvaluateResult } from './types';

// Set this to your deployed Apps Script Web App URL
const BASE_URL = (import.meta as any).env?.VITE_BACKEND_URL
  || 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(BASE_URL);
  url.searchParams.set('path', path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const url = new URL(BASE_URL);
  url.searchParams.set('path', path);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const api = {
  // ---- GET ----------------------------------------------------------------
  getReadyTasks(userId: string): Promise<TaskRow[]> {
    return get('/api/tasks/ready', { userId });
  },
  getCompletedTasks(userId: string): Promise<TaskRow[]> {
    return get('/api/tasks/completed', { userId });
  },
  getGoals(userId: string): Promise<GoalRow[]> {
    return get('/api/goals', { userId });
  },
  getHabits(userId: string): Promise<HabitRow[]> {
    return get('/api/habits', { userId });
  },
  getSummary(userId: string): Promise<SummaryData> {
    return get('/api/summary', { userId });
  },

  // ---- POST ---------------------------------------------------------------
  startFocus(activityId: string, userId: string, feelingB4: string, estTime: string): Promise<{ ok: boolean; startTime: string }> {
    return post('/api/tasks/startFocus', { activityId, userId, feelingB4, estTime });
  },
  completeFocus(activityId: string, userId: string): Promise<FocusResult> {
    return post('/api/tasks/completeFocus', { activityId, userId });
  },
  evaluateTask(activityId: string, userId: string, feelingAfter: string): Promise<EvaluateResult> {
    return post('/api/tasks/evaluate', { activityId, userId, feelingAfter });
  },
  enrichTask(activityId: string, userId: string, feelingB4: string, estTime: string, incup: string): Promise<{ ok: boolean }> {
    return post('/api/tasks/enrich', { activityId, userId, feelingB4, estTime, incup });
  },
  breakdownTask(parentId: string, userId: string, subtasks: { activity: string }[]): Promise<{ ok: boolean; createdIds: string[] }> {
    return post('/api/tasks/breakdown', { parentId, userId, subtasks });
  },
  logHabit(habitRowIndex: number, userId: string, difficulty: string, emotionB4: string, emotionAfter: string, mentalBlock: string): Promise<{ ok: boolean }> {
    return post('/api/habits/log', { habitRowIndex, userId, difficulty, emotionB4, emotionAfter, mentalBlock });
  }
};
