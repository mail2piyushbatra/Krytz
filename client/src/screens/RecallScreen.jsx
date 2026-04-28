/** ✦ FLOWRA — Recall Screen
 *  Mode A: AI Recall (natural language Q&A via /recall)
 *  Mode B: Semantic Search (vector similarity via /items/search)
 */
import { useState, useEffect } from 'react';
import { recall as recallApi, items, entries } from '../services/api';
import './RecallScreen.css';

export default function RecallScreen() {
  const [mode, setMode]             = useState('recall');  // 'recall' | 'semantic'
  const [query, setQuery]           = useState('');
  const [answer, setAnswer]         = useState(null);
  const [semanticResults, setSemantic] = useState([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [history, setHistory]       = useState(() => {
    try { return JSON.parse(localStorage.getItem('flowra_recall_history') || '[]'); }
    catch { return []; }
  });

  async function handleSubmit(e) {
    e.preventDefault();
    if (!query.trim() || loading) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    setSemantic([]);

    try {
      if (mode === 'semantic') {
        // Vector similarity search against items
        const data = await items.semanticSearch(query.trim());
        setSemantic(data?.results || data?.items || []);
        saveToHistory(query.trim());
      } else {
        // AI recall — natural language Q&A
        try {
          const data = await recallApi.query(query.trim());
          setAnswer(data);
          saveToHistory(query.trim());
        } catch (err) {
          // Fallback: full-text entry search if AI unavailable
          const searchData = await entries.list({ limit: 20 });
          const all = searchData?.entries || [];
          const matches = all.filter(e =>
            (e.rawText || e.raw_text || '').toLowerCase().includes(query.toLowerCase())
          );
          if (matches.length > 0) {
            setAnswer({
              answer: `AI recall unavailable — found ${matches.length} matching entries:`,
              sources: matches.slice(0, 5),
              fallback: true,
            });
            saveToHistory(query.trim());
          } else {
            setError('AI recall is not available. Set OPENAI_API_KEY in server/.env, or try Semantic Search mode.');
          }
        }
      }
    } catch (err) {
      setError(err.message || 'Search failed');
    }

    setLoading(false);
  }

  function saveToHistory(q) {
    const updated = [q, ...history.filter(h => h !== q)].slice(0, 10);
    setHistory(updated);
    localStorage.setItem('flowra_recall_history', JSON.stringify(updated));
  }

  const placeholders = {
    recall: 'What did I do last week?',
    semantic: 'Find items similar to "deploy the API"',
  };

  return (
    <div className="page-container animate-fadeIn" id="recall-screen">
      <h1 className="page-title">Recall</h1>

      {/* Mode tabs */}
      <div className="recall-mode-tabs">
        <button
          className={`recall-mode-tab ${mode === 'recall' ? 'active' : ''}`}
          onClick={() => { setMode('recall'); setAnswer(null); setSemantic([]); setError(null); }}
          id="recall-tab-ai"
        >
          ✦ AI Recall
        </button>
        <button
          className={`recall-mode-tab ${mode === 'semantic' ? 'active' : ''}`}
          onClick={() => { setMode('semantic'); setAnswer(null); setSemantic([]); setError(null); }}
          id="recall-tab-semantic"
        >
          ◎ Semantic Search
        </button>
      </div>

      {/* Search form */}
      <form className="recall-search" onSubmit={handleSubmit}>
        <div className="recall-input-wrapper">
          <span className="recall-search-icon">{mode === 'semantic' ? '◎' : '🔍'}</span>
          <input
            className="recall-input"
            type="text"
            placeholder={placeholders[mode]}
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
          {loading ? 'Searching...' : mode === 'semantic' ? 'Search' : 'Ask'}
        </button>
      </form>

      {/* Loading */}
      {loading && (
        <div className="recall-loading animate-fadeIn">
          <div className="recall-dots">
            <span /><span /><span />
          </div>
          <p>{mode === 'semantic' ? 'Finding similar items...' : 'Searching your entries...'}</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="recall-error animate-slideUp">
          <p>⚠️ {error}</p>
        </div>
      )}

      {/* Semantic results */}
      {semanticResults.length > 0 && !loading && (
        <div className="recall-semantic-results animate-slideUp">
          <div className="section-title" style={{ marginBottom: 'var(--space-3)' }}>
            {semanticResults.length} similar items found
          </div>
          {semanticResults.map((item, i) => (
            <div key={item.id || i} className="recall-semantic-item card">
              <div className="recall-semantic-score">
                {item.similarity != null
                  ? `${Math.round(item.similarity * 100)}% match`
                  : `#${i + 1}`}
              </div>
              <div className="recall-semantic-text">
                {item.canonical_text || item.text || item.rawText}
              </div>
              {item.category && (
                <span className="badge badge-tag">{item.category}</span>
              )}
              {item.state && item.state !== 'OPEN' && (
                <span className={`badge badge-${item.state === 'DONE' ? 'done' : 'blocker'}`}>
                  {item.state}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* AI Answer */}
      {answer && !loading && (
        <div className="recall-answer card animate-slideUp">
          <div className="recall-answer-header">
            <span className="recall-ai-badge">✦ AI</span>
            {answer.fallback && (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                (full-text fallback)
              </span>
            )}
          </div>
          <div className="recall-answer-body">
            {answer.answer || answer.response || answer.summary ? (
              <TypewriterText text={answer.answer || answer.response || answer.summary} />
            ) : (
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

      {/* Recent queries */}
      {history.length > 0 && !loading && !answer && semanticResults.length === 0 && (
        <div className="recall-history animate-slideUp">
          <div className="section-title">Recent Queries</div>
          <div className="recall-history-list">
            {history.map((q, i) => (
              <button
                key={i}
                className="recall-history-item"
                onClick={() => setQuery(q)}
              >
                <span className="recall-history-icon">💬</span>
                <span>{q}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !answer && !error && semanticResults.length === 0 && history.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">{mode === 'semantic' ? '◎' : '🔍'}</div>
          <div className="empty-title">
            {mode === 'semantic' ? 'Find items by meaning' : 'Ask anything about your entries'}
          </div>
          <div className="empty-desc">
            {mode === 'semantic'
              ? 'Type any phrase — semantic search finds items with similar meaning, not just exact words.'
              : 'Try: "What meetings did I have this week?" or "Am I still blocked on anything?"'}
          </div>
        </div>
      )}
    </div>
  );
}

function TypewriterText({ text = '', speed = 15 }) {
  const [displayed, setDisplayed] = useState('');

  useEffect(() => {
    if (!text) { setDisplayed(''); return; }
    let i = 0;
    setDisplayed('');
    const timer = setInterval(() => {
      setDisplayed(prev => prev + text.charAt(i));
      i++;
      if (i >= text.length) clearInterval(timer);
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed]);

  return <>{displayed}</>;
}
