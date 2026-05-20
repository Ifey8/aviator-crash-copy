// vocabEngine.ts — Spaced repetition engine for vocabulary learning
// SM-2 algorithm + localStorage persistence + dictionary API + TTS + notifications

import type { WordEntry, BookDef } from './vocabData';
import { getBook, BOOKS } from './vocabData';
export type { WordEntry, BookDef };
export { BOOKS, getBook };

// ─── Types ───────────────────────────────────────────────────────

export interface CardState {
  word: string;
  bookId: string;
  zh: string;
  interval: number;   // days until next review
  ease: number;       // SM-2 ease factor (default 2.5)
  due: number;        // ms timestamp when due for review
  reps: number;       // consecutive correct reviews
  lapses: number;     // total times "Again" was pressed
  added: number;      // ms timestamp when added
  learned: boolean;   // true after first review
}

export interface DictResult {
  word: string;
  phonetic?: string;
  audio?: string;
  meanings: {
    pos: string;
    defs: { def: string; example?: string }[];
  }[];
}

// ─── Rating enum ─────────────────────────────────────────────────

export const RATINGS = { AGAIN: 0, HARD: 1, GOOD: 2, EASY: 3 } as const;
export type Rating = typeof RATINGS[keyof typeof RATINGS];

// ─── Storage keys ────────────────────────────────────────────────

const STORAGE_KEY = 'aviator_vocab_cards';
const DICT_CACHE_KEY = 'aviator_vocab_dict';
const STATS_KEY = 'aviator_vocab_stats';

const MAX_INTERVAL_DAYS = 365;
const MS_PER_DAY = 86400000;

// ─── localStorage helpers ────────────────────────────────────────

function loadAllCards(): CardState[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAllCards(cards: CardState[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  } catch {
    // localStorage full or unavailable — silently fail
  }
}

function loadDictCache(): Record<string, DictResult> {
  try {
    const raw = localStorage.getItem(DICT_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    return {};
  }
}

function saveDictCache(cache: Record<string, DictResult>): void {
  try {
    localStorage.setItem(DICT_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // silently fail
  }
}

interface StatsData {
  dates: string[];       // YYYY-MM-DD dates when reviews happened
  todayDate: string;     // YYYY-MM-DD of "today" for the counter
  todayCount: number;    // reviews done today
}

function loadStats(): StatsData {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return { dates: [], todayDate: '', todayCount: 0 };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.dates)) {
      return parsed as StatsData;
    }
    return { dates: [], todayDate: '', todayCount: 0 };
  } catch {
    return { dates: [], todayDate: '', todayCount: 0 };
  }
}

function saveStats(stats: StatsData): void {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    // silently fail
  }
}

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── SM-2 Algorithm ──────────────────────────────────────────────

export function reviewCard(card: CardState, rating: Rating): CardState {
  const q = rating as number;
  const now = Date.now();

  // Ease adjustment (SM-2 formula): never below 1.3
  const newEase = Math.max(1.3, card.ease + 0.1 - (3 - q) * (0.08 + (3 - q) * 0.02));

  let newInterval: number;
  let newDue: number;
  let newReps = card.reps;
  let newLapses = card.lapses;

  if (rating === RATINGS.AGAIN) {
    // Reset: 1 minute interval, increment lapses
    newReps = 0;
    newLapses = card.lapses + 1;
    newInterval = 1 / (24 * 60); // 1 minute in days
    newDue = now + 60000;
  } else if (rating === RATINGS.HARD) {
    if (card.reps === 0) {
      // First review: 10 minutes
      newInterval = 10 / (24 * 60);
      newDue = now + 600000;
    } else if (card.reps === 1) {
      // Second review: 1 day
      newInterval = 1;
      newDue = now + MS_PER_DAY;
    } else {
      // Subsequent: interval * 1.2
      newInterval = Math.min(card.interval * 1.2, MAX_INTERVAL_DAYS);
      newDue = now + newInterval * MS_PER_DAY;
    }
    newReps = card.reps + 1;
  } else if (rating === RATINGS.GOOD) {
    if (card.reps === 0) {
      // First review: 1 day
      newInterval = 1;
      newDue = now + MS_PER_DAY;
    } else if (card.reps === 1) {
      // Second review: 6 days
      newInterval = 6;
      newDue = now + 6 * MS_PER_DAY;
    } else {
      // Subsequent: interval * ease
      newInterval = Math.min(card.interval * newEase, MAX_INTERVAL_DAYS);
      newDue = now + newInterval * MS_PER_DAY;
    }
    newReps = card.reps + 1;
  } else {
    // EASY
    if (card.reps === 0) {
      // First review: 4 days
      newInterval = 4;
      newDue = now + 4 * MS_PER_DAY;
    } else if (card.reps === 1) {
      // Second review: 10 days
      newInterval = 10;
      newDue = now + 10 * MS_PER_DAY;
    } else {
      // Subsequent: interval * ease * 1.3
      newInterval = Math.min(card.interval * newEase * 1.3, MAX_INTERVAL_DAYS);
      newDue = now + newInterval * MS_PER_DAY;
    }
    newReps = card.reps + 1;
  }

  return {
    ...card,
    interval: newInterval,
    ease: newEase,
    due: newDue,
    reps: newReps,
    lapses: newLapses,
    learned: true,
  };
}

// ─── Public API ──────────────────────────────────────────────────

export function getAllCards(): CardState[] {
  return loadAllCards();
}

export function getDueCards(bookId?: string): CardState[] {
  const now = Date.now();
  let cards = loadAllCards().filter(c => c.due <= now);
  if (bookId) {
    cards = cards.filter(c => c.bookId === bookId);
  }
  // Sort: most overdue first
  cards.sort((a, b) => a.due - b.due);
  return cards;
}

export function getNewWords(bookId: string, limit: number): WordEntry[] {
  const book = getBook(bookId);
  if (!book) return [];

  const cards = loadAllCards();
  const addedSet = new Set(cards.filter(c => c.bookId === bookId).map(c => c.word.toLowerCase()));

  const result: WordEntry[] = [];
  for (const entry of book.words) {
    if (result.length >= limit) break;
    if (!addedSet.has(entry.w.toLowerCase())) {
      result.push(entry);
    }
  }
  return result;
}

export function addCard(word: string, zh: string, bookId: string): CardState {
  const cards = loadAllCards();

  // Check if already exists
  const existing = cards.find(c => c.word.toLowerCase() === word.toLowerCase() && c.bookId === bookId);
  if (existing) return existing;

  const card: CardState = {
    word,
    bookId,
    zh,
    interval: 0,
    ease: 2.5,
    due: Date.now(), // due immediately for first review
    reps: 0,
    lapses: 0,
    added: Date.now(),
    learned: false,
  };

  cards.push(card);
  saveAllCards(cards);
  return card;
}

export function updateCard(card: CardState): void {
  const cards = loadAllCards();
  const idx = cards.findIndex(
    c => c.word.toLowerCase() === card.word.toLowerCase() && c.bookId === card.bookId
  );
  if (idx >= 0) {
    cards[idx] = card;
  } else {
    cards.push(card);
  }
  saveAllCards(cards);
}

export function removeCard(word: string, bookId: string): void {
  const cards = loadAllCards();
  const filtered = cards.filter(
    c => !(c.word.toLowerCase() === word.toLowerCase() && c.bookId === bookId)
  );
  saveAllCards(filtered);
}

export function getBookStats(bookId: string): {
  total: number;
  learned: number;
  due: number;
  mastered: number;
} {
  const now = Date.now();
  const cards = loadAllCards().filter(c => c.bookId === bookId);

  return {
    total: cards.length,
    learned: cards.filter(c => c.learned).length,
    due: cards.filter(c => c.due <= now).length,
    mastered: cards.filter(c => c.interval >= 21).length, // 21+ day interval = mastered
  };
}

export function getAllStats(): {
  totalLearned: number;
  totalDue: number;
  streak: number;
  todayReviewed: number;
} {
  const now = Date.now();
  const cards = loadAllCards();

  return {
    totalLearned: cards.filter(c => c.learned).length,
    totalDue: cards.filter(c => c.due <= now).length,
    streak: getStreak(),
    todayReviewed: getTodayReviewed(),
  };
}

// ─── Dictionary API ──────────────────────────────────────────────

export async function lookupWord(word: string): Promise<DictResult | null> {
  const key = word.toLowerCase().trim();
  if (!key) return null;

  // Check cache first
  const cache = loadDictCache();
  if (cache[key]) return cache[key];

  try {
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`
    );
    if (!res.ok) return null;

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const entry = data[0];

    // Extract phonetic
    let phonetic: string | undefined;
    if (entry.phonetic) {
      phonetic = entry.phonetic;
    } else if (Array.isArray(entry.phonetics)) {
      const p = entry.phonetics.find((ph: any) => ph.text);
      if (p) phonetic = p.text;
    }

    // Extract audio URL
    let audio: string | undefined;
    if (Array.isArray(entry.phonetics)) {
      const withAudio = entry.phonetics.find((ph: any) => ph.audio && ph.audio.length > 0);
      if (withAudio) audio = withAudio.audio;
    }

    // Extract meanings
    const meanings: DictResult['meanings'] = [];
    if (Array.isArray(entry.meanings)) {
      for (const m of entry.meanings) {
        const defs: { def: string; example?: string }[] = [];
        if (Array.isArray(m.definitions)) {
          for (const d of m.definitions) {
            defs.push({
              def: d.definition || '',
              example: d.example || undefined,
            });
          }
        }
        meanings.push({
          pos: m.partOfSpeech || '',
          defs,
        });
      }
    }

    const result: DictResult = { word: key, phonetic, audio, meanings };

    // Save to cache
    cache[key] = result;
    saveDictCache(cache);

    return result;
  } catch {
    return null;
  }
}

// ─── Text-to-Speech ──────────────────────────────────────────────

export function speak(text: string, rate: number = 0.85): void {
  if (typeof speechSynthesis === 'undefined') return;

  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = rate;

  speechSynthesis.speak(utterance);
}

// ─── Notifications ───────────────────────────────────────────────

export async function requestNotifPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;

  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  try {
    const result = await Notification.requestPermission();
    return result === 'granted';
  } catch {
    return false;
  }
}

export function notifyReview(dueCount: number): void {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  if (dueCount <= 0) return;

  try {
    new Notification('Vocabulary Review', {
      body: `You have ${dueCount} card${dueCount === 1 ? '' : 's'} due for review!`,
      icon: '/favicon.ico',
      tag: 'vocab-review', // prevents duplicate notifications
    });
  } catch {
    // Notification constructor can throw in some contexts (e.g. service workers)
  }
}

// ─── Today's stats tracking ─────────────────────────────────────

export function recordReview(): void {
  const stats = loadStats();
  const today = todayStr();

  // Add today to dates array if not already present
  if (!stats.dates.includes(today)) {
    stats.dates.push(today);
  }

  // Reset or increment today counter
  if (stats.todayDate !== today) {
    stats.todayDate = today;
    stats.todayCount = 1;
  } else {
    stats.todayCount += 1;
  }

  saveStats(stats);
}

export function getTodayReviewed(): number {
  const stats = loadStats();
  const today = todayStr();
  if (stats.todayDate !== today) return 0;
  return stats.todayCount;
}

export function getStreak(): number {
  const stats = loadStats();
  const dates = stats.dates;
  if (dates.length === 0) return 0;

  // Build a Set for O(1) lookup
  const dateSet = new Set(dates);

  // Walk backward from today
  const now = new Date();
  let streak = 0;

  for (let i = 0; i < 3650; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const ds = `${y}-${m}-${day}`;

    if (dateSet.has(ds)) {
      streak++;
    } else {
      // Allow today to be missing (user hasn't reviewed yet today)
      // but only on the first iteration
      if (i === 0) continue;
      break;
    }
  }

  return streak;
}
