// types.ts  –  Shared TypeScript types for QuestBot Mini App

export interface TaskRow {
  activityId:   string;
  activity:     string;
  goal:         string;
  goalId:       string;
  incup:        string;
  lifeArea:     string;
  horizon:      string;
  exeType:      'task' | 'project' | 'habit' | string;
  category:     string;
  status:       string;
  estTime:      string;
  actualTime:   string;
  deadline:     string;
  mentalBlock:  string;
  feelingB4:    string;
  feelingAfter: string;
  captureXP:    number;
  organiseXP:   number;
  doneXP:       number;
  evaluateXP:   number;
  totalXP:      number;
  dependsOn:    string;
  link:         string;
  timestamp:    string;
  completedOn:  string;
}

export interface HabitRow {
  rowIndex:  number;
  habit:     string;
  easy:      string;
  medium:    string;
  hard:      string;
  peak:      string;
  lifeArea:  string;
  streak:    number;
  maxStreak: number;
}

export interface GoalRow {
  goalId:   string;
  title:    string;
  lifeArea: string;
  horizon:  string;
  status:   string;
  category: string;
}

export interface SummaryData {
  totalXP:       number;
  level:         number;
  rank:          string;
  hp:            number;
  capturedCount: number;
  readyCount:    number;
  doneCount:     number;
  habitCount:    number;
  goalCount:     number;
}

export interface FocusResult {
  ok:         boolean;
  status:     string;
  actualTime: string;
  doneXP:     number;
  hp:         number;
}

export interface EvaluateResult {
  ok:         boolean;
  evaluateXP: number;
  totalXP:    number;
  chrysolite: number;
  eDelta:     number;
}

export type Tab = 'do' | 'evaluate' | 'habits' | 'summary';

export const EMOTION_LIST = [
  'joyful','excited','hopeful','calm','curious',
  'neutral','bored','anxious','frustrated','overwhelmed','defeated'
] as const;

export type Emotion = typeof EMOTION_LIST[number];

export const CATEGORY_COLORS: Record<string, string> = {
  'main-quest':      '#6c63ff',
  'side-quest':      '#3ecf8e',
  'fake-boss':       '#f59e0b',
  'sleeping-dragon': '#ef4444',
  'void-filler':     '#6b7280'
};

export const HORIZON_ORDER: Record<string, number> = {
  today: 0, week: 1, month: 2, quarter: 3, annum: 4, someday: 5
};
