import React, { useState } from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';

const TOOLBAR_OPTIONS = [
  [{ header: [1, 2, 3, false] }],
  ['bold', 'italic', 'underline', 'strike'],
  [{ list: 'ordered' }, { list: 'bullet' }],
  ['blockquote', 'code-block'],
  [{ color: [] }, { background: [] }],
  ['link'],
  ['clean'],
];

export default function ComposeModal({ isOpen, onClose, onSend, onSent }) {
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const isFormValid = to.trim() && subject.trim() && body.replace(/<[^>]*>?/gm, '').trim();

  async function handleSend(e) {
    e.preventDefault();
    if (!isFormValid) return;

    setSending(true);
    setError(null);

    try {
      await onSend({
        to: to.trim(),
        cc: cc.trim(),
        subject: subject.trim(),
        body: body, // HTML from Quill
      });

      // Show success flash for 1 second before closing
      setSent(true);
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Call onSent callback (switches filter to "enviado" and reloads)
      if (typeof onSent === 'function') {
        await onSent();
      }

      handleClose();
    } catch (err) {
      setError(err.message || 'No se pudo enviar el correo.');
    } finally {
      setSending(false);
    }
  }

  function handleClose() {
    if (sending) return;
    setTo('');
    setCc('');
    setSubject('');
    setBody('');
    setError(null);
    setSending(false);
    setSent(false);
    onClose();
  }

  if (!isOpen) return null;

  return (
    <div className="compose-overlay" onClick={handleClose}>
      <div className="compose-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="compose-header">
          <h2 className="compose-title">✉️ Redactar correo</h2>
          <button className="compose-close-btn" onClick={handleClose} disabled={sending}>
            ×
          </button>
        </div>

        {sent ? (
          <div className="compose-sent-success">
            <span className="compose-sent-icon">✓</span>
            Correo enviado correctamente
          </div>
        ) : (
          /* Form */
          <form className="compose-form" onSubmit={handleSend}>
            <div className="compose-field">
              <label className="compose-label" htmlFor="compose-to">Para</label>
              <input
                id="compose-to"
                className="compose-input"
                type="text"
                placeholder="ejemplo@netlatin.com.ar, otro@dominio.com"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                disabled={sending}
                autoFocus
              />
            </div>

            <div className="compose-field">
              <label className="compose-label" htmlFor="compose-cc">CC</label>
              <input
                id="compose-cc"
                className="compose-input"
                type="text"
                placeholder="correo@netlatin.com.ar (opcional)"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                disabled={sending}
              />
            </div>

            <div className="compose-divider" />

            <div className="compose-field">
              <label className="compose-label" htmlFor="compose-subject">Asunto</label>
              <input
                id="compose-subject"
                className="compose-input"
                type="text"
                placeholder="Asunto del mensaje"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={sending}
              />
            </div>

            <div className="compose-field compose-field-body">
              <label className="compose-label">Mensaje</label>
              <ReactQuill
                theme="snow"
                value={body}
                onChange={setBody}
                readOnly={sending}
                modules={{ toolbar: TOOLBAR_OPTIONS }}
                placeholder="Escribí tu mensaje aquí..."
              />
            </div>

            {error && (
              <div className="compose-error">
                ❌ {error}
              </div>
            )}

            <div className="compose-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleClose}
                disabled={sending}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!isFormValid || sending}
              >
                {sending ? 'Enviando...' : 'Enviar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
