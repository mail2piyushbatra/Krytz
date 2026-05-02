/** ✦ Krytz — Recall Screen (v3: spotlight interface)
 *  Mode A: AI Recall (natural language Q&A via /recall)
 *  Mode B: Semantic Search (vector similarity via /items/search)
 */
import { useState, useEffect, useRef } from 'react';
import { recall as recallApi, items, entries } from '../services/api';
import { Card, ActionBtn, EmptyState, Badge } from '../components/ui/UiKit';
import { Search, Sparkles, Clock, ArrowRight, X, Target, MessageSquare, Loader2 } from 'lucide-react';
import './RecallScreen.css';

export default function RecallScreen() {
  const [mode, setMode]             = useState('recall');  // 'recall' | 'semantic'
  const [query, setQuery]           = useState('');
  const [answer, setAnswer]         = useState(null);
  const [semanticResults, setSemantic] = useState([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const inputRef = useRef(null);
  const [history, setHistory]       = useState(() => {
    try { return JSON.parse(localStorage.getItem('Krytz_recall_history') || '[]'); }
    catch { return []; }
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

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
    localStorage.setItem('Krytz_recall_history', JSON.stringify(updated));
  }

  function clearHistory() {
    setHistory([]);
    localStorage.removeItem('Krytz_recall_history');
  }

  const placeholders = {
    recall: 'Ask: "What did I do last week?"',
    semantic: 'Find items similar to "deploy the API"',
  };

  const showIdleState = !loading && !answer && !error && semanticResults.length === 0;
  const sourceCount = answer?.sources?.length || 0;
  const resultCount = semanticResults.length || sourceCount;
  const answerState = loading ? 'running' : error ? 'blocked' : answer ? 'answered' : semanticResults.length ? 'matched' : 'ready';

  return (
    <div className="page-container animate-fadeIn" id="recall-screen">
      <header className="recall-header">
        <p className="eyebrow">Search & Ask</p>
        <h1 className="page-title">Search</h1>
      </header>

      <section className="recall-kpi-grid" aria-label="Search overview">
        <RecallKpiCard label="Mode" value={mode === 'recall' ? 'AI' : 'Search'} detail={mode === 'recall' ? 'natural language recall' : 'semantic item matching'} />
        <RecallKpiCard label="State" value={answerState} detail={loading ? 'query in progress' : 'ready for next question'} tone={error ? 'danger' : answer || semanticResults.length ? 'positive' : 'neutral'} />
        <RecallKpiCard label="Results" value={resultCount} detail={mode === 'semantic' ? 'similar items' : 'source entries'} />
        <RecallKpiCard label="History" value={history.length} detail="recent queries saved locally" />
      </section>

      {/* Mode toggle */}
      <div className="recall-mode-toggle">
        <button
          className={`recall-mode-btn ${mode === 'recall' ? 'active' : ''}`}
          onClick={() => { setMode('recall'); setAnswer(null); setSemantic([]); setError(null); }}
          id="recall-tab-ai"
        >
          <Sparkles size={16} />
          AI Answer
        </button>
        <button
          className={`recall-mode-btn ${mode === 'semantic' ? 'active' : ''}`}
          onClick={() => { setMode('semantic'); setAnswer(null); setSemantic([]); setError(null); }}
          id="recall-tab-semantic"
        >
          <Target size={16} />
          Semantic Search
        </button>
      </div>

      {/* Spotlight search bar */}
      <form className="recall-spotlight" onSubmit={handleSubmit}>
        <div className="recall-spotlight-inner">
          {loading ? (
            <Loader2 size={20} className="recall-search-spinner ui-spinner-anim" />
          ) : (
            <Search size={20} className="recall-search-icon" />
          )}
          <input
            ref={inputRef}
            className="recall-spotlight-input"
            type="text"
            placeholder={placeholders[mode]}
            value={query}
            onChange={e => setQuery(e.target.value)}
            id="recall-input"
          />
          {query && (
            <button type="button" className="recall-clear-btn" onClick={() => setQuery('')}>
              <X size={16} />
            </button>
          )}
          <ActionBtn
            type="submit"
            disabled={!query.trim() || loading}
            className="recall-submit-btn"
            id="recall-submit"
          >
            {mode === 'semantic' ? 'Search' : 'Ask'}
            <ArrowRight size={16} />
          </ActionBtn>
        </div>
      </form>

      {/* Error */}
      {error && (
        <Card className="recall-error animate-slideUp">
          <p>⚠ï¸ {error}</p>
        </Card>
      )}

      {/* Semantic results */}
      {semanticResults.length > 0 && !loading && (
        <section className="recall-results animate-slideUp">
          <div className="recall-results-header">
            <h3>{semanticResults.length} similar items found</h3>
          </div>
          <div className="recall-results-list">
            {semanticResults.map((item, i) => (
              <Card key={item.id || i} className="recall-result-card">
                <div className="recall-result-score">
                  {item.similarity !== null && item.similarity !== undefined ? (
                    <span className="recall-score-ring" style={{ '--score-pct': `${item.similarity * 100}%` }}>
                      {Math.round(item.similarity * 100)}%
                    </span>
                  ) : (
                    <span className="recall-score-rank">#{i + 1}</span>
                  )}
                </div>
                <div className="recall-result-body">
                  <p className="recall-result-text">{item.canonical_text || item.text || item.rawText}</p>
                  <div className="recall-result-meta">
                    {item.category && <Badge intent="default">{item.category}</Badge>}
                    {item.state && item.state !== 'OPEN' && (
                      <Badge intent={item.state === 'DONE' ? 'positive' : 'warning'}>{item.state}</Badge>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* AI Answer */}
      {answer && !loading && (
        <Card className="recall-answer animate-slideUp">
          <div className="recall-answer-header">
            <div className="recall-ai-badge">
              <Sparkles size={14} />
              AI
            </div>
            {answer.fallback && (
              <Badge intent="warning">fallback mode</Badge>
            )}
          </div>
          <div className="recall-answer-body">
            {answer.answer || answer.response || answer.summary ? (
              <TypewriterText text={answer.answer || answer.response || answer.summary} />
            ) : (
              <pre className="recall-raw-json">{JSON.stringify(answer, null, 2)}</pre>
            )}
          </div>
          {answer.sources?.length > 0 && (
            <details className="recall-sources">
              <summary>
                <MessageSquare size={14} />
                Related entries ({answer.sources.length})
              </summary>
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
        </Card>
      )}

      {/* Recent queries */}
      {showIdleState && history.length > 0 && (
        <section className="recall-history animate-slideUp">
          <div className="recall-history-header">
            <h3>Recent Queries</h3>
            <button className="recall-clear-history" onClick={clearHistory}>Clear</button>
          </div>
          <div className="recall-history-list">
            {history.map((q, i) => (
              <button
                key={i}
                className="recall-history-chip"
                onClick={() => setQuery(q)}
              >
                <Clock size={14} />
                <span>{q}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {showIdleState && history.length === 0 && (
        <EmptyState
          icon={mode === 'semantic' ? Target : Search}
          title={mode === 'semantic' ? 'Find similar items' : 'Ask anything about your notes'}
          description={mode === 'semantic'
            ? 'Type any phrase — semantic search finds items with similar meaning, not just exact words.'
            : 'Try: "What meetings did I have this week?" or "Am I still blocked on anything?"'}
        />
      )}
    </div>
  );
}

function RecallKpiCard({ label, value, detail, tone = 'neutral' }) {
  return (
    <article className={`recall-kpi-card recall-kpi-card--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
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
