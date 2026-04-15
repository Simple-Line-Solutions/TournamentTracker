export default function PageSpinner({ title = "Cargando", subtitle = "Preparando informacion del torneo..." }) {
  return (
    <section className="tt-spinner-wrap" aria-live="polite" aria-busy="true">
      <div className="tt-spinner-card">
        <div className="tt-spinner-orbit" aria-hidden="true">
          <span className="tt-spinner-ring" />
          <span className="tt-spinner-core" />
          <span className="tt-spinner-dot tt-spinner-dot-a" />
          <span className="tt-spinner-dot tt-spinner-dot-b" />
        </div>
        <p className="tt-spinner-title">{title}</p>
        <p className="tt-spinner-subtitle">{subtitle}</p>
      </div>
    </section>
  );
}
