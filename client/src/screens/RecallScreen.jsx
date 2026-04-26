/** ✦ FLOWRA — Recall Screen (AI Search) */
import { useState } from 'react';
import { recall } from '../services/api';
import './RecallScreen.css';

export default function RecallScreen() {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('flowra_recall_history') || '[]'); }
    catch { return []; }
  });

  async function handleSubmit(e) {
    e.preventDefault();
    if (!query.trim() || loading) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const data = await recall.query(query.trim());
      setAnswer(data);
      saveToHistory(query.trim());
    } catch (err) {
      // Fallback: if AI recall fails, try full-text entry search
      try {
        const { entries } = await import('../services/api');
        const searchData = await entries.list({ limit: 20 });
        const all = searchData?.entries || [];
        const matches = all.filter(e =>
          (e.rawText || e.raw_text || '').toLowerCase().includes(query.toLowerCase())
        );
        if (matches.length > 0) {
          setAnswer({
            answer: `AI recall is unavailable, but I found ${matches.length} matching entries:`,
            sources: matches.slice(0, 5),
            fallback: true,
          });
          saveToHistory(query.trim());
        } else {
          setError('AI recall is not available. Please set OPENAI_API_KEY in server/.env');
        }
      } catch {
        setError(err.message || 'Recall service unavailable');
      }
    }
    setLoading(false);
  }

  function saveToHistory(q) {
    const updated = [q, ...history.filter(h => h !== q)].slice(0, 10);
    setHistory(updated);
    localStorage.setItem('flowra_recall_history', JSON.stringify(updated));
  }

  function useHistoryQuery(q) {
    setQuery(q);
  }

  return (
    <div className="page-container animate-fadeIn" id="recall-screen">
      <h1 className="page-title">Recall</h1>

      {/* Search */}
      <form className="recall-search" onSubmit={handleSubmit}>
        <div className="recall-input-wrapper">
          <span className="recall-search-icon">🔍</span>
          <input
            className="recall-input"
            type="text"
            placeholder="What did I do last week?"
            value={query}
            onChange={e => setQuery(e.target.value)}
            id="recall-input"
          />
        </div>
        <button
          className="btn btn-primary"
          type="submit"
          disabled={!query.trim() || loading}
          id="recall-submit"
        >
          {loading ? 'Thinking...' : 'Ask'}
        </button>
      </form>

      {/* Loading */}
      {loading && (
        <div className="recall-loading animate-fadeIn">
          <div className="recall-dots">
            <span /><span /><span />
          </div>
          <p>Searching your entries...</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="recall-error animate-slideUp">
          <p>⚠️ {error}</p>
        </div>
      )}

      {/* Answer */}
      {answer && !loading && (
        <div className="recall-answer card animate-slideUp">
          <div className="recall-answer-header">
            <span className="recall-ai-badge">✦ AI</span>
          </div>
          <div className="recall-answer-body">
            {answer.answer || answer.response || answer.summary || (
              <p className="text-secondary">
                {JSON.stringify(answer, null, 2)}
              </p>
            )}
          </div>
          {answer.sources?.length > 0 && (
            <details className="recall-sources">
              <summary>📋 Related entries ({answer.sources.length})</summary>
              <div className="recall-sources-list">
                {answer.sources.map((src, i) => (
                  <div key={i} className="recall-source-item">
                    <span className="recall-source-time">
                      {new Date(src.timestamp || src.created_at).toLocaleDateString()}
                    </span>
                    <span className="recall-source-text">{src.rawText || src.text}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Recent Queries */}
      {history.length > 0 && !loading && !answer && (
        <div className="recall-history animate-slideUp">
          <div className="section-title">Recent Queries</div>
          <div className="recall-history-list">
            {history.map((q, i) => (
              <button
                key={i}
                className="recall-history-item"
                onClick={() => useHistoryQuery(q)}
              >
                <span className="recall-history-icon">💬</span>
                <span>{q}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty */}
      {!loading && !answer && history.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🔍</div>
          <div className="empty-title">Ask anything about your entries</div>
          <div className="empty-desc">
            Try: "What meetings did I have this week?" or "Am I still blocked on anything?"
          </div>
        </div>
      )}
    </div>
  );
}
