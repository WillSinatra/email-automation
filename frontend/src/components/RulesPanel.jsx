import { useState, useEffect } from 'react';
import { getRules, addRule, deleteRule } from '../services/api';

export default function RulesPanel() {
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(false);

  // Add form state
  const [domain, setDomain] = useState('');
  const [category, setCategory] = useState('spam');
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState(null);

  // Per-row delete state
  const [deletingDomain, setDeletingDomain] = useState(null);
  const [deleteErrors, setDeleteErrors] = useState({});

  // Load rules whenever panel is opened
  useEffect(() => {
    if (open) loadRules();
  }, [open]);

  async function loadRules() {
    setLoading(true);
    try {
      setRules(await getRules());
    } catch (_) {
      // Silently fail on load — retry is implicit on next open
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!domain.trim()) return;
    setAddLoading(true);
    setAddError(null);
    try {
      await addRule(domain.trim(), category);
      setDomain('');
      await loadRules();
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAddLoading(false);
    }
  }

  async function handleDelete(d) {
    setDeletingDomain(d);
    setDeleteErrors((prev) => ({ ...prev, [d]: null }));
    try {
      await deleteRule(d);
      await loadRules();
    } catch (err) {
      setDeleteErrors((prev) => ({ ...prev, [d]: err.message }));
    } finally {
      setDeletingDomain(null);
    }
  }

  return (
    <div className="rules-panel">
      <button className="rules-toggle" onClick={() => setOpen((o) => !o)}>
        <span>
          Custom domain rules
          {rules.length > 0 && !open ? ` (${rules.length})` : ''}
        </span>
        <span className="toggle-icon">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="rules-body">
          {loading ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              {rules.length === 0 ? (
                <p className="empty-state">No custom rules yet.</p>
              ) : (
                <ul className="rules-list">
                  {rules.map((r) => (
                    <li key={r.domain} className="rule-row">
                      <span className="rule-domain">{r.domain}</span>
                      <span className={`rule-cat cat-${r.category}`}>
                        {r.category}
                      </span>
                      <button
                        className="btn btn-danger btn-xs"
                        onClick={() => handleDelete(r.domain)}
                        disabled={deletingDomain === r.domain}
                      >
                        {deletingDomain === r.domain ? '…' : 'Remove'}
                      </button>
                      {deleteErrors[r.domain] && (
                        <span className="error-msg">
                          {deleteErrors[r.domain]}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {/* Add rule form */}
              <form onSubmit={handleAdd} className="add-rule-form">
                <input
                  type="text"
                  className="input input-sm"
                  style={{ width: 180 }}
                  placeholder="example.com"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                />
                <select
                  className="select select-sm"
                  style={{ width: 110 }}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="trusted">trusted</option>
                  <option value="spam">spam</option>
                  <option value="ignored">ignored</option>
                </select>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={addLoading || !domain.trim()}
                >
                  {addLoading ? 'Adding…' : 'Add rule'}
                </button>
                {addError && <span className="error-msg">{addError}</span>}
              </form>
            </>
          )}
        </div>
      )}
    </div>
  );
}
