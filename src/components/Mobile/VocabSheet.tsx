import React from "react";
import "./vocab.scss";
import {
  BOOKS, getBook,
  CardState, DictResult, RATINGS, Rating,
  getAllCards, getDueCards, getNewWords, addCard, updateCard,
  reviewCard, getBookStats, getAllStats, removeCard,
  lookupWord, speak,
  requestNotifPermission, notifyReview, recordReview,
} from "./vocabEngine";

// ─── Types ───────────────────────────────────────────────────
type View = "books" | "bookDetail" | "review" | "search" | "list" | "complete";

const TABS = [
  { key: "books" as View, label: "词书", icon: "📚" },
  { key: "review" as View, label: "复习", icon: "📖" },
  { key: "search" as View, label: "查词", icon: "🔍" },
  { key: "list" as View, label: "词表", icon: "📝" },
];

const NEW_PER_SESSION = 10;

// ─── Main Component ──────────────────────────────────────────
interface Props { open: boolean; onClose: () => void; }

export const VocabSheet: React.FC<Props> = ({ open, onClose }) => {
  const [view, setView] = React.useState<View>("books");
  const [tab, setTab] = React.useState<View>("books");
  const [activeBookId, setActiveBookId] = React.useState("");

  // Review state
  const [queue, setQueue] = React.useState<CardState[]>([]);
  const [qIdx, setQIdx] = React.useState(0);
  const [flipped, setFlipped] = React.useState(false);
  const [dictCache, setDictCache] = React.useState<Record<string, DictResult>>({});
  const [sessionStats, setSessionStats] = React.useState({ reviewed: 0, newCount: 0 });

  // Search state
  const [searchQ, setSearchQ] = React.useState("");
  const [searchRes, setSearchRes] = React.useState<DictResult | null>(null);
  const [searching, setSearching] = React.useState(false);

  // Word popover (click word in example sentence)
  const [popover, setPopover] = React.useState<{ word: string; x: number; y: number; result?: DictResult } | null>(null);

  // Refresh trigger
  const [, refresh] = React.useState(0);
  const forceRefresh = () => refresh(n => n + 1);

  // Request notification permission on first open
  React.useEffect(() => {
    if (open) requestNotifPermission();
  }, [open]);

  // Notify about due cards when opening
  React.useEffect(() => {
    if (open) {
      const due = getDueCards().length;
      if (due > 0) notifyReview(due);
    }
  }, [open]);

  if (!open) return null;

  // ── Navigation helpers ──
  const goTab = (t: View) => { setTab(t); setView(t); setPopover(null); };
  const goBookDetail = (bookId: string) => { setActiveBookId(bookId); setView("bookDetail"); };
  const goBack = () => {
    if (view === "bookDetail") { setView("books"); return; }
    if (view === "complete") { setView("books"); setTab("books"); return; }
    onClose();
  };

  // ── Start learning new words from a book ──
  const startLearn = (bookId: string) => {
    const newWords = getNewWords(bookId, NEW_PER_SESSION);
    const cards: CardState[] = newWords.map(w => addCard(w.w, w.z, bookId));
    if (cards.length === 0) return;
    // Pre-fetch dict data for new words
    cards.forEach(c => fetchDict(c.word));
    setQueue(cards);
    setQIdx(0);
    setFlipped(false);
    setSessionStats({ reviewed: 0, newCount: cards.length });
    setView("review");
  };

  // ── Start reviewing due cards ──
  const startReview = (bookId?: string) => {
    const due = getDueCards(bookId);
    if (due.length === 0) return;
    due.forEach(c => fetchDict(c.word));
    setQueue(due.slice(0, 50)); // cap at 50 per session
    setQIdx(0);
    setFlipped(false);
    setSessionStats({ reviewed: 0, newCount: 0 });
    setView("review");
  };

  // ── Fetch dictionary data (cached) ──
  const fetchDict = async (word: string) => {
    if (dictCache[word.toLowerCase()]) return;
    const res = await lookupWord(word);
    if (res) setDictCache(prev => ({ ...prev, [word.toLowerCase()]: res }));
  };

  // ── Handle rating ──
  const handleRate = (rating: Rating) => {
    const card = queue[qIdx];
    if (!card) return;
    const updated = reviewCard(card, rating);
    updateCard(updated);
    recordReview();
    setSessionStats(s => ({ ...s, reviewed: s.reviewed + 1 }));

    // Move to next card
    if (qIdx + 1 < queue.length) {
      setQIdx(qIdx + 1);
      setFlipped(false);
    } else {
      setView("complete");
    }
    forceRefresh();
  };

  // ── Search dictionary ──
  const doSearch = async () => {
    const q = searchQ.trim().toLowerCase();
    if (!q) return;
    setSearching(true);
    setSearchRes(null);
    const res = await lookupWord(q);
    setSearchRes(res);
    if (res) setDictCache(prev => ({ ...prev, [q]: res }));
    setSearching(false);
  };

  // ── Handle word click in example sentence ──
  const handleWordClick = async (word: string, e: React.MouseEvent) => {
    const clean = word.toLowerCase().replace(/[^a-z]/g, "");
    if (!clean || clean.length < 2) return;
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setPopover({ word: clean, x: rect.left + rect.width / 2, y: rect.top });
    const res = await lookupWord(clean);
    if (res) {
      setPopover(prev => prev?.word === clean ? { ...prev, result: res } : prev);
      setDictCache(prev => ({ ...prev, [clean]: res }));
    }
  };

  const addFromPopover = (word: string) => {
    const r = dictCache[word];
    const zh = r?.meanings?.[0]?.defs?.[0]?.def?.slice(0, 30) || word;
    addCard(word, zh, "custom");
    setPopover(null);
    forceRefresh();
  };

  // ── Current card for review ──
  const currentCard = queue[qIdx];
  const currentDict = currentCard ? dictCache[currentCard.word.toLowerCase()] : undefined;

  // ── Render ──
  return (
    <div className={`vocab-sheet ${open ? "open" : ""}`} onClick={() => setPopover(null)}>
      {/* Header */}
      <div className="vocab-header">
        <button className="vocab-back" onClick={goBack} type="button">
          {view === "books" ? "✕" : "←"}
        </button>
        <div className="vocab-title">
          {view === "bookDetail" ? (getBook(activeBookId)?.nameZh || "词书") :
           view === "review" ? "复习中" :
           view === "complete" ? "完成" : "单词本"}
        </div>
        <div className="vocab-header-action" />
      </div>

      {/* Tab bar (hidden during review/complete) */}
      {view !== "review" && view !== "complete" && view !== "bookDetail" && (
        <div className="vocab-tabs">
          {TABS.map(t => (
            <button
              key={t.key}
              className={`vocab-tab ${tab === t.key ? "active" : ""}`}
              onClick={() => goTab(t.key)}
              type="button"
            >
              <span className="tab-icon">{t.icon}</span>
              <span className="tab-label">{t.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="vocab-content">
        {view === "books" && <BooksView onSelect={goBookDetail} onStartReview={startReview} />}
        {view === "bookDetail" && (
          <BookDetailView
            bookId={activeBookId}
            onLearn={startLearn}
            onReview={startReview}
            onBack={() => setView("books")}
          />
        )}
        {view === "review" && currentCard && (
          <ReviewView
            card={currentCard}
            dict={currentDict}
            flipped={flipped}
            onFlip={() => setFlipped(true)}
            onRate={handleRate}
            progress={`${qIdx + 1} / ${queue.length}`}
            onWordClick={handleWordClick}
          />
        )}
        {view === "complete" && (
          <CompleteView stats={sessionStats} onContinue={() => { setView("books"); setTab("books"); }} />
        )}
        {view === "search" && (
          <SearchView
            query={searchQ}
            onQueryChange={setSearchQ}
            onSearch={doSearch}
            result={searchRes}
            searching={searching}
            onAdd={(w, zh) => { addCard(w, zh, "custom"); forceRefresh(); }}
            onSpeak={speak}
            allCards={getAllCards()}
          />
        )}
        {view === "list" && (
          <ListView
            onSpeak={speak}
            onRemove={(w, b) => { removeCard(w, b); forceRefresh(); }}
          />
        )}
      </div>

      {/* Word popover */}
      {popover && (
        <div
          className="vocab-word-popover"
          style={{ left: popover.x, top: popover.y - 8 }}
          onClick={e => e.stopPropagation()}
        >
          <div className="popover-arrow" />
          {popover.result ? (
            <>
              <div className="popover-word">{popover.word}</div>
              <div className="popover-meaning">
                {popover.result.meanings?.[0]?.defs?.[0]?.def?.slice(0, 60) || "—"}
              </div>
              <button className="popover-add" onClick={() => addFromPopover(popover.word)} type="button">
                + 加入词表
              </button>
            </>
          ) : (
            <div className="popover-loading">查询中…</div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Sub-components ──────────────────────────────────────────

/** Books grid view */
const BooksView: React.FC<{ onSelect: (id: string) => void; onStartReview: () => void }> = ({ onSelect, onStartReview }) => {
  const stats = getAllStats();
  const dueTotal = getDueCards().length;
  return (
    <div className="vocab-books-view">
      {dueTotal > 0 && (
        <button className="vocab-due-banner" onClick={onStartReview} type="button">
          📖 你有 <strong>{dueTotal}</strong> 个单词待复习
        </button>
      )}
      <div className="vocab-quick-stats">
        <div className="qs-item"><span className="qs-num">{stats.totalLearned}</span><span className="qs-label">已学</span></div>
        <div className="qs-item"><span className="qs-num">{stats.todayReviewed}</span><span className="qs-label">今日</span></div>
        <div className="qs-item"><span className="qs-num">{stats.streak}</span><span className="qs-label">连续天</span></div>
      </div>
      <div className="vocab-books-grid">
        {BOOKS.map(book => {
          const s = getBookStats(book.id);
          const pct = s.total > 0 ? Math.round((s.learned / s.total) * 100) : 0;
          return (
            <button key={book.id} className="vocab-book-card" onClick={() => onSelect(book.id)} type="button">
              <div className="book-icon">{book.icon}</div>
              <div className="book-name">{book.name}</div>
              <div className="book-name-zh">{book.nameZh}</div>
              <div className="book-progress">
                <div className="book-progress-fill" style={{ width: `${pct}%`, background: book.color }} />
              </div>
              <div className="book-stats">
                {s.learned}/{s.total} 已学 {s.due > 0 && <span className="due-badge">· {s.due} 待复习</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

/** Book detail with word list + actions */
const BookDetailView: React.FC<{
  bookId: string;
  onLearn: (id: string) => void;
  onReview: (id: string) => void;
  onBack: () => void;
}> = ({ bookId, onLearn, onReview }) => {
  const book = getBook(bookId);
  if (!book) return null;
  const stats = getBookStats(bookId);
  const newAvail = stats.total - stats.learned;
  return (
    <div className="vocab-book-detail">
      <div className="detail-header">
        <span className="detail-icon">{book.icon}</span>
        <div>
          <div className="detail-name">{book.name}</div>
          <div className="detail-name-zh">{book.nameZh} · {stats.total} 词</div>
        </div>
      </div>
      <div className="detail-progress-bar">
        <div className="detail-progress-fill" style={{ width: `${stats.total > 0 ? (stats.learned / stats.total) * 100 : 0}%`, background: book.color }} />
      </div>
      <div className="detail-stats-row">
        <div className="ds-item"><span className="ds-num">{stats.learned}</span>已学</div>
        <div className="ds-item"><span className="ds-num">{newAvail}</span>未学</div>
        <div className="ds-item"><span className="ds-num">{stats.due}</span>待复习</div>
      </div>
      <div className="detail-actions">
        {newAvail > 0 && (
          <button className="vocab-btn vocab-btn-learn" onClick={() => onLearn(bookId)} type="button">
            学习新词 ({Math.min(newAvail, NEW_PER_SESSION)})
          </button>
        )}
        {stats.due > 0 && (
          <button className="vocab-btn vocab-btn-review" onClick={() => onReview(bookId)} type="button">
            复习 ({stats.due})
          </button>
        )}
        {newAvail === 0 && stats.due === 0 && (
          <div className="vocab-empty">🎉 全部掌握！</div>
        )}
      </div>
      <div className="detail-word-preview">
        <div className="preview-title">词汇列表</div>
        {book.words.map((w, i) => {
          const cards = getAllCards();
          const card = cards.find(c => c.word === w.w && c.bookId === bookId);
          return (
            <div key={i} className={`preview-word ${card?.learned ? "learned" : ""}`}>
              <span className="pw-word">{w.w}</span>
              <span className="pw-zh">{w.z}</span>
              {card?.learned && <span className="pw-check">✓</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** Card review interface */
const ReviewView: React.FC<{
  card: CardState;
  dict?: DictResult;
  flipped: boolean;
  onFlip: () => void;
  onRate: (r: Rating) => void;
  progress: string;
  onWordClick: (w: string, e: React.MouseEvent) => void;
}> = ({ card, dict, flipped, onFlip, onRate, progress, onWordClick }) => {
  return (
    <div className="vocab-review">
      <div className="review-progress">{progress}</div>
      <div className={`vocab-card ${flipped ? "flipped" : ""}`} onClick={() => !flipped && onFlip()}>
        <div className="vocab-card-inner">
          {/* Front */}
          <div className="vocab-card-front">
            <div className="card-word">{card.word}</div>
            {dict?.phonetic && <div className="card-phonetic">{dict.phonetic}</div>}
            <button
              className="vocab-speaker"
              onClick={e => { e.stopPropagation(); speak(card.word); }}
              type="button"
            >
              🔊
            </button>
            <div className="card-hint">点击翻转</div>
          </div>
          {/* Back */}
          <div className="vocab-card-back">
            <div className="card-zh">{card.zh}</div>
            {dict?.meanings?.map((m, i) => (
              <div key={i} className="card-meaning-group">
                <span className="card-pos">{m.pos}</span>
                {m.defs.slice(0, 2).map((d, j) => (
                  <div key={j} className="card-def">{d.def}</div>
                ))}
                {m.defs.filter(d => d.example).slice(0, 2).map((d, j) => (
                  <div key={j} className="card-example">
                    <ClickableText text={d.example!} onWordClick={onWordClick} />
                  </div>
                ))}
              </div>
            ))}
            {!dict && (
              <div className="card-def" style={{ opacity: 0.4 }}>Loading definition…</div>
            )}
          </div>
        </div>
      </div>

      {/* Rating buttons (only when flipped) */}
      {flipped && (
        <div className="vocab-rating-bar">
          <button className="rating-btn rating-again" onClick={() => onRate(RATINGS.AGAIN)} type="button">
            <span className="rb-label">重来</span>
            <span className="rb-time">1分钟</span>
          </button>
          <button className="rating-btn rating-hard" onClick={() => onRate(RATINGS.HARD)} type="button">
            <span className="rb-label">困难</span>
            <span className="rb-time">{card.reps === 0 ? "10分钟" : "1天"}</span>
          </button>
          <button className="rating-btn rating-good" onClick={() => onRate(RATINGS.GOOD)} type="button">
            <span className="rb-label">良好</span>
            <span className="rb-time">{card.reps === 0 ? "1天" : `${Math.round(card.interval * card.ease)}天`}</span>
          </button>
          <button className="rating-btn rating-easy" onClick={() => onRate(RATINGS.EASY)} type="button">
            <span className="rb-label">简单</span>
            <span className="rb-time">{card.reps === 0 ? "4天" : `${Math.round(card.interval * card.ease * 1.3)}天`}</span>
          </button>
        </div>
      )}
    </div>
  );
};

/** Clickable text — each word in a sentence is tappable */
const ClickableText: React.FC<{ text: string; onWordClick: (w: string, e: React.MouseEvent) => void }> = ({ text, onWordClick }) => {
  const parts = text.split(/(\s+|[,."':;!?()[\]{}])/);
  return (
    <span className="clickable-text">
      {parts.map((p, i) => {
        if (/^[a-zA-Z]{2,}$/.test(p)) {
          return (
            <span key={i} className="clickable-word" onClick={e => { e.stopPropagation(); onWordClick(p, e); }}>
              {p}
            </span>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </span>
  );
};

/** Search view */
const SearchView: React.FC<{
  query: string;
  onQueryChange: (q: string) => void;
  onSearch: () => void;
  result: DictResult | null;
  searching: boolean;
  onAdd: (w: string, zh: string) => void;
  onSpeak: (w: string) => void;
  allCards: CardState[];
}> = ({ query, onQueryChange, onSearch, result, searching, onAdd, onSpeak, allCards }) => {
  const added = new Set(allCards.map(c => c.word.toLowerCase()));
  return (
    <div className="vocab-search-view">
      <div className="vocab-search-bar">
        <input
          className="vocab-search-input"
          type="text"
          placeholder="输入英文单词查询…"
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          onKeyDown={e => e.key === "Enter" && onSearch()}
        />
        <button className="vocab-search-go" onClick={onSearch} type="button">
          🔍
        </button>
      </div>
      {searching && <div className="vocab-search-loading">查询中…</div>}
      {result && (
        <div className="vocab-search-result-card">
          <div className="sr-header">
            <div>
              <span className="sr-word">{result.word}</span>
              {result.phonetic && <span className="sr-phonetic">{result.phonetic}</span>}
            </div>
            <div className="sr-actions">
              <button className="vocab-speaker-sm" onClick={() => onSpeak(result.word)} type="button">🔊</button>
              {!added.has(result.word.toLowerCase()) ? (
                <button
                  className="vocab-add-btn"
                  onClick={() => onAdd(result.word, result.meanings?.[0]?.defs?.[0]?.def?.slice(0, 40) || result.word)}
                  type="button"
                >
                  + 加入
                </button>
              ) : (
                <span className="sr-added">已添加 ✓</span>
              )}
            </div>
          </div>
          {result.meanings?.map((m, i) => (
            <div key={i} className="sr-meaning">
              <span className="sr-pos">{m.pos}</span>
              {m.defs.map((d, j) => (
                <div key={j} className="sr-def">
                  <div className="sr-def-text">{d.def}</div>
                  {d.example && <div className="sr-example">"{d.example}"</div>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {result === null && !searching && query.trim() && (
        <div className="vocab-empty">未找到该单词</div>
      )}
    </div>
  );
};

/** Word list view */
const ListView: React.FC<{
  onSpeak: (w: string) => void;
  onRemove: (w: string, bookId: string) => void;
}> = ({ onSpeak, onRemove }) => {
  const [filter, setFilter] = React.useState<"all" | "learning" | "mastered">("all");
  const cards = getAllCards();
  const now = Date.now();
  const filtered = cards.filter(c => {
    if (filter === "learning") return c.learned && c.interval < 21;
    if (filter === "mastered") return c.interval >= 21;
    return true;
  });

  return (
    <div className="vocab-list-view">
      <div className="vocab-filter-pills">
        {(["all", "learning", "mastered"] as const).map(f => (
          <button
            key={f}
            className={`filter-pill ${filter === f ? "active" : ""}`}
            onClick={() => setFilter(f)}
            type="button"
          >
            {f === "all" ? `全部 (${cards.length})` : f === "learning" ? "学习中" : "已掌握"}
          </button>
        ))}
      </div>
      <div className="vocab-list-items">
        {filtered.length === 0 && <div className="vocab-empty">暂无单词</div>}
        {filtered.map(c => {
          const isDue = c.due <= now;
          const status = c.interval >= 21 ? "mastered" : c.learned ? "learning" : "new";
          return (
            <div key={`${c.word}-${c.bookId}`} className={`vocab-list-item status-${status}`}>
              <div className="li-left" onClick={() => onSpeak(c.word)}>
                <div className="li-word">{c.word}</div>
                <div className="li-zh">{c.zh}</div>
              </div>
              <div className="li-right">
                <span className={`li-status ${status}`}>
                  {status === "mastered" ? "✓" : status === "learning" ? "📖" : "🆕"}
                </span>
                {isDue && <span className="li-due">待复习</span>}
                <button className="li-remove" onClick={() => onRemove(c.word, c.bookId)} type="button">✕</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** Session complete screen */
const CompleteView: React.FC<{ stats: { reviewed: number; newCount: number }; onContinue: () => void }> = ({ stats, onContinue }) => {
  const allStats = getAllStats();
  return (
    <div className="vocab-review-complete">
      <div className="complete-icon">🎉</div>
      <div className="complete-title">复习完成！</div>
      <div className="complete-stats">
        <div className="cs-row"><span className="cs-label">本次复习</span><span className="cs-val">{stats.reviewed} 词</span></div>
        {stats.newCount > 0 && (
          <div className="cs-row"><span className="cs-label">新学单词</span><span className="cs-val">{stats.newCount} 词</span></div>
        )}
        <div className="cs-row"><span className="cs-label">今日总计</span><span className="cs-val">{allStats.todayReviewed} 词</span></div>
        <div className="cs-row"><span className="cs-label">连续打卡</span><span className="cs-val">{allStats.streak} 天</span></div>
      </div>
      <button className="vocab-btn vocab-btn-learn" onClick={onContinue} type="button">
        继续
      </button>
    </div>
  );
};

export default VocabSheet;
