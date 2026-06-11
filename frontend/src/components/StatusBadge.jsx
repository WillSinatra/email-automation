export default function StatusBadge({ value }) {
  const cls = {
    trusted: 'badge-trusted',
    spam: 'badge-spam',
    ignored: 'badge-ignored',
  };
  return (
    <span className={`badge ${cls[value] || 'badge-ignored'}`}>{value}</span>
  );
}
