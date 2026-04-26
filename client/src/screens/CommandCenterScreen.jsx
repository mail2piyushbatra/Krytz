import { useEffect, useRef, useState } from 'react';
import { actions, entries, notifications, plan as planApi } from '../services/api';
import './CommandCenterScreen.css';

const initialState = {
  plan: null,
  notifications: [],
  explanation: null,
  loading: true,
  captureOpen: false,
  error: '',
  busyItem: '',
};

export default function CommandCenterScreen() {
  const [state, setState] = useState(initialState);

  async function loadCommandCenter() {
    setState(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const [today, inbox] = await Promise.all([
        planApi.today(),
        notifications.list({ limit: 10 }).catch(() => []),
      ]);
      setState(prev => ({
        ...prev,
        plan: today,
        notifications: Array.isArray(inbox) ? inbox : inbox.notifications || [],
        loading: false,
        busyItem: '',
      }));
    } catch (error) {
      setState(prev => ({ ...prev, loading: false, busyItem: '', error: error.message }));
    }
  }

  useEffect(() => {
    loadCommandCenter();
  }, []);

  async function actOnItem(itemId, type) {
    setState(prev => ({ ...prev, busyItem: itemId, explanation: null, error: '' }));
    try {
      await actions.submit(itemId, type);
      await loadCommandCenter();
    } catch (error) {
      setState(prev => ({ ...prev, busyItem: '', error: error.message }));
    }
  }

  async function explainItem(itemId) {
    setState(prev => ({ ...prev, explanation: { loading: true, itemId }, error: '' }));
    try {
      const explanation = await planApi.explain(itemId);
      setState(prev => ({ ...prev, explanation }));
    } catch (error) {
      setState(prev => ({ ...prev, explanation: null, error: error.message }));
    }
  }

  const today = state.plan;
  const focus = today?.focus;
  const nextItems = today?.next || [];
  const blockerItems = today?.blockers || [];
  const signalCount = state.notifications.length + blockerItems.length;
  const openThreads = today?.totalOpen ?? (focus ? 1 + nextItems.length : nextItems.length);
  const confidence = typeof today?.confidence === 'number' ? Math.round(today.confidence * 100) : null;

  return (
    <div className="command-center page-container">
      <header className="command-header">
        <div>
          <p className="eyebrow">Personal Operations Command Center</p>
          <h1>Your life, reconstructed into command.</h1>
          <p className="command-subtitle">
            Flowra is not a todo list. It watches captured fragments, computes state,
            explains why something matters, and asks for the next decision.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setState(prev => ({ ...prev, captureOpen: true }))}>
          Capture raw signal
        </button>
      </header>

      {state.error && <div className="command-error">{state.error}</div>}

      <OperatingLoop />

      <section className="command-grid">
        <article className="focus-panel">
          <div className="panel-kicker">Command brief</div>
          {state.loading ? (
            <div className="focus-skeleton skeleton" />
          ) : focus ? (
            <FocusCard
              item={focus}
              busy={state.busyItem === focus.id}
              onAction={actOnItem}
              onExplain={explainItem}
            />
          ) : (
            <EmptyFocus onCapture={() => setState(prev => ({ ...prev, captureOpen: true }))} message={today?.message} />
          )}
        </article>

        <aside className="signals-panel">
          <p className="panel-kicker">Signal radar</p>
          <div className="signal-summary">
            <span>{signalCount}</span>
            <p>signals need interpretation</p>
          </div>
          <SignalList blockers={blockerItems} notifications={state.notifications} />
        </aside>
      </section>

      <SystemLedger
        stage={today?.stage || 'simple'}
        openThreads={openThreads}
        confidence={confidence}
        signalCount={signalCount}
        hasFocus={Boolean(focus)}
      />

      <section className="queue-panel">
        <div className="section-row">
          <h2>Decision queue</h2>
          <span>{today?.stage || 'simple'} intelligence layer</span>
        </div>
        {nextItems.length ? (
          <div className="queue-list">
            {nextItems.map(item => (
              <QueueItem
                key={item.id}
                item={item}
                busy={state.busyItem === item.id}
                onAction={actOnItem}
                onExplain={explainItem}
              />
            ))}
          </div>
        ) : (
          <p className="muted">No secondary decisions yet. Capture more real-world context and Flowra will build the operating queue.</p>
        )}
      </section>

      <ExplanationPanel explanation={state.explanation} onClose={() => setState(prev => ({ ...prev, explanation: null }))} />
      <RapidCaptureSheet
        open={state.captureOpen}
        onClose={() => setState(prev => ({ ...prev, captureOpen: false }))}
        onCaptured={loadCommandCenter}
      />
    </div>
  );
}

function OperatingLoop() {
  return (
    <section className="operating-loop" aria-label="Flowra operating loop">
      <div>
        <span>01</span>
        <strong>Capture</strong>
        <p>Drop messy notes, commitments, meetings, blockers, and promises without sorting them.</p>
      </div>
      <div>
        <span>02</span>
        <strong>Compute</strong>
        <p>The system extracts items, detects state, ranks urgency, and preserves memory.</p>
      </div>
      <div>
        <span>03</span>
        <strong>Command</strong>
        <p>You see the brief, the reason, the risk, and the next decision to make.</p>
      </div>
    </section>
  );
}

function FocusCard({ item, busy, onAction, onExplain }) {
  return (
    <div className="focus-card">
      <div className="focus-main">
        <span className="state-pill">Decision needed / {item.state?.replace('_', ' ') || 'OPEN'}</span>
        <h2>{item.text}</h2>
        <ItemMeta item={item} />
      </div>
      <div className="focus-actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => onExplain(item.id)}>Explain system read</button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => onAction(item.id, 'done')}>Resolve</button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => onAction(item.id, 'snooze')}>Defer signal</button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => onAction(item.id, 'drop')}>Dismiss</button>
      </div>
    </div>
  );
}

function QueueItem({ item, busy, onAction, onExplain }) {
  return (
    <div className="queue-item">
      <div>
        <p>{item.text}</p>
        <ItemMeta item={item} />
      </div>
      <div className="queue-actions">
        <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => onExplain(item.id)}>Reason</button>
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => onAction(item.id, 'done')}>Resolve</button>
      </div>
    </div>
  );
}

function ItemMeta({ item }) {
  const bits = [];
  if (item.project) bits.push(item.project);
  if (item.deadlineDays != null) bits.push(item.deadlineDays <= 0 ? 'time risk now' : `time risk ${item.deadlineDays}d`);
  if (item.persistDays) bits.push(`memory age ${item.persistDays}d`);
  if (item.downstreamOpen) bits.push(`blocks ${item.downstreamOpen}`);
  if (item.score != null) bits.push(`system score ${item.score}`);
  return <div className="item-meta">{bits.length ? bits.join(' / ') : 'new memory signal'}</div>;
}

function EmptyFocus({ onCapture, message }) {
  return (
    <div className="empty-focus">
      <span className="state-pill">System waiting for signal</span>
      <h2>No command brief yet.</h2>
      <p>{message || 'Flowra needs raw life data before it can compute memory, risk, and decisions. Capture what happened, what was promised, or what feels unresolved.'}</p>
      <button className="btn btn-primary" onClick={onCapture}>Feed the system</button>
    </div>
  );
}

function SystemLedger({ stage, openThreads, confidence, signalCount, hasFocus }) {
  return (
    <section className="system-ledger" aria-label="System state ledger">
      <BriefMetric label="Memory threads" value={openThreads} note="open state inferred from capture" />
      <BriefMetric label="Signal pressure" value={signalCount} note="blockers and notifications" />
      <BriefMetric label="Intelligence stage" value={stage} note="adapts as memory grows" />
      <BriefMetric label="Command confidence" value={confidence == null ? (hasFocus ? 'learning' : 'cold') : `${confidence}%`} note="how strongly Flowra trusts the brief" />
    </section>
  );
}

function BriefMetric({ label, value, note }) {
  return (
    <div className="brief-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{note}</p>
    </div>
  );
}

function SignalList({ blockers, notifications }) {
  const hasSignals = blockers.length || notifications.length;
  if (!hasSignals) return <p className="muted">No contradictions, blockers, or alerts currently surfaced.</p>;
  return (
    <div className="signal-list">
      {blockers.map(item => <div key={item.id} className="signal-card">Blocker detected: {item.text}</div>)}
      {notifications.slice(0, 5).map((note, index) => (
        <div key={note.id || index} className="signal-card">System alert: {note.title || note.message || 'Notification'}</div>
      ))}
    </div>
  );
}

function ExplanationPanel({ explanation, onClose }) {
  if (!explanation) return null;
  return (
    <div className="explain-panel">
      <button className="explain-close" onClick={onClose}>Close</button>
      {explanation.loading ? (
        <p>Computing explanation...</p>
      ) : (
        <>
          <p className="eyebrow">Why Flowra surfaced this</p>
          <h3>{explanation.text}</h3>
          <div className="factor-list">
            {(explanation.factors || []).map(factor => (
              <span key={factor.key}>{factor.text}</span>
            ))}
            {!explanation.factors?.length && <span>Priority, recency, and unresolved state made this actionable.</span>}
          </div>
        </>
      )}
    </div>
  );
}

function RapidCaptureSheet({ open, onClose, onCaptured }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    if (open) setTimeout(() => textareaRef.current?.focus(), 0);
  }, [open]);

  if (!open) return null;

  async function submit(event) {
    event.preventDefault();
    if (!text.trim()) return;
    setSaving(true);
    setError('');
    try {
      await entries.capture(text);
      setText('');
      onClose();
      await onCaptured();
    } catch (captureError) {
      setError(captureError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="capture-backdrop" onMouseDown={onClose}>
      <form className="capture-sheet" onSubmit={submit} onMouseDown={event => event.stopPropagation()}>
        <div>
          <p className="eyebrow">Rapid capture</p>
          <h2>Drop the raw signal. Flowra will reconstruct the operating state.</h2>
        </div>
        <textarea
          ref={textareaRef}
          className="input"
          value={text}
          onChange={event => setText(event.target.value)}
          placeholder="Example: Send revised proposal to Asha by Friday, and check if billing clause is still open."
          rows={6}
        />
        {error && <p className="capture-error">{error}</p>}
        <div className="capture-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving || !text.trim()}>{saving ? 'Capturing...' : 'Capture'}</button>
        </div>
      </form>
    </div>
  );
}
