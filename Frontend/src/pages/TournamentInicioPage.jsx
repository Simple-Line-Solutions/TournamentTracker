import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api";
import { useTournamentStore } from "../store/tournamentStore";

export default function TournamentInicioPage() {
  const { id } = useParams();
  const tournamentVersion = useTournamentStore((s) => s.tournamentVersion);
  const [torneo, setTorneo] = useState(null);
  const [parejas, setParejas] = useState([]);
  const [partidos, setPartidos] = useState([]);
  const [canchasEstado, setCanchasEstado] = useState([]);
  const [pagos, setPagos] = useState([]);
  const [pendientes, setPendientes] = useState({ sinCancha: [], conCancha: [] });
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [elapsedTimes, setElapsedTimes] = useState({});

  const load = async () => {
    const [t, p, pd, ce, pp, pag] = await Promise.all([
      api.get(`/torneos/${id}`),
      api.get(`/torneos/${id}/parejas`),
      api.get(`/torneos/${id}/partidos`),
      api.get(`/torneos/${id}/canchas/estado`),
      api.get(`/torneos/${id}/partidos/pendientes`),
      api.get(`/torneos/${id}/pagos`),
    ]);
    setTorneo(t.data);
    setParejas(p.data || []);
    setPartidos(pd.data || []);
    setCanchasEstado(ce.data || []);
    setPendientes(pp.data || { sinCancha: [], conCancha: [] });
    setPagos(pag.data || []);
  };

  useEffect(() => {
    load().catch(() => setError("No se pudo cargar el inicio del torneo"));
    const timer = setInterval(() => {
      api.get(`/torneos/${id}/canchas/estado`).then((r) => setCanchasEstado(r.data || [])).catch(() => {});
      api.get(`/torneos/${id}/partidos`).then((r) => setPartidos(r.data || [])).catch(() => {});
      api.get(`/torneos/${id}/partidos/pendientes`).then((r) => setPendientes(r.data || { sinCancha: [], conCancha: [] })).catch(() => {});
    }, 30000);
    return () => clearInterval(timer);
  }, [id, tournamentVersion]);

  const pairNameMap = useMemo(() => {
    const map = new Map();
    parejas.forEach((p) => {
      map.set(p.id, `${p.player1_nombre} ${p.player1_apellido} / ${p.player2_nombre} ${p.player2_apellido}`);
    });
    return map;
  }, [parejas]);

  const enJuego = useMemo(() => partidos.filter((m) => m.started_at && !m.finished_at), [partidos]);

  const courtNameById = useMemo(() => {
    const map = new Map();
    canchasEstado.forEach((item, idx) => {
      const id = Number(item?.court?.id);
      if (!Number.isFinite(id)) return;
      map.set(id, item.court.nombre || item.court.identificador || `Cancha ${idx + 1}`);
    });
    return map;
  }, [canchasEstado]);

  const playingCourtByMatchId = useMemo(() => {
    const map = new Map();
    canchasEstado.forEach((item, idx) => {
      if (!item?.playing?.id) return;
      map.set(item.playing.id, item.court.nombre || item.court.identificador || `Cancha ${idx + 1}`);
    });
    return map;
  }, [canchasEstado]);

  const pendientesConCanchaValidos = useMemo(() => {
    return (pendientes.conCancha || []).filter((m) => courtNameById.has(Number(m.queue_court_id)));
  }, [pendientes, courtNameById]);

  const parseMatchTimestamp = (rawValue) => {
    if (!rawValue) return null;
    const value = String(rawValue).trim();
    if (!value) return null;

    // Unix timestamp support (seconds or milliseconds)
    if (/^\d+$/.test(value)) {
      const n = Number(value);
      if (Number.isFinite(n)) {
        return n > 1e12 ? n : n * 1000;
      }
    }

    // Normalize to ISO and force UTC when no timezone is provided.
    const normalized = value.includes("T") ? value : value.replace(" ", "T");
    const hasTimezone = /([zZ]|[+\-]\d{2}:?\d{2})$/.test(normalized);
    const isoValue = hasTimezone ? normalized : `${normalized}Z`;

    let millis = new Date(isoValue).getTime();
    return Number.isNaN(millis) ? null : millis;
  };

  // Update elapsed times every second
  useEffect(() => {
    const updateElapsedTimes = () => {
      const times = {};
      enJuego.forEach((match) => {
        const startTime = parseMatchTimestamp(match.started_at);
        if (startTime != null) {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          times[match.id] = elapsed;
        }
      });
      setElapsedTimes(times);
    };

    updateElapsedTimes();
    const timer = setInterval(updateElapsedTimes, 1000);
    return () => clearInterval(timer);
  }, [enJuego]);

  // Dashboard metrics
  const totalParejas = parejas.length;
  const parejasPresentes = parejas.filter((p) => p.presente).length;
  const parejasAusentes = parejas.filter((p) => !p.presente).length;

  const montoRecaudado = useMemo(() => {
    return pagos.reduce((sum, pago) => {
      if (pago.tx_id && pago.monto) {
        return sum + Number(pago.monto);
      }
      return sum;
    }, 0);
  }, [pagos]);

  // Progreso del torneo
  const totalPartidos = partidos.length;
  const partidosFinalizados = partidos.filter((m) => m.finished_at || m.winner_id).length;
  const porcentajeProgreso = totalPartidos > 0 ? Math.round((partidosFinalizados / totalPartidos) * 100) : 0;

  const championInfo = useMemo(() => {
    const finalMatch = partidos.find((m) => {
      const stage = String(m.stage || "").toLowerCase();
      const round = String(m.round || "").toLowerCase();
      return stage === "eliminatoria" && round === "final";
    });

    if (!finalMatch?.winner_id) return null;

    const pairName = pairNameMap.get(finalMatch.winner_id);
    if (!pairName) return null;

    return {
      pairName,
      finishedAt: finalMatch.finished_at || null,
    };
  }, [partidos, pairNameMap]);

  // Canchas libres
  const canhasLibres = canchasEstado.filter((c) => c.estado === "libre").length;

  // Helper: Get color classes based on status
  const getStateClasses = (estado) => {
    switch (estado) {
      case "ocupada":
        return { bg: "bg-red-50", border: "border-red-200", text: "text-red-900", label: "text-red-700", icon: "🟴" };
      case "cola":
        return { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-900", label: "text-amber-700", icon: "🟡" };
      case "libre":
        return { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-900", label: "text-emerald-700", icon: "🟢" };
      default:
        return { bg: "bg-slate-50", border: "border-slate-200", text: "text-slate-900", label: "text-slate-700", icon: "⚪" };
    }
  };

  // Format time helper
  const formatElapsedTime = (seconds) => {
    if (!seconds || seconds < 0) return "0m 0s";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m ${secs}s`;
  };

  if (!torneo) return <p>Cargando...</p>;

  return (
    <div className="space-y-5">
      {/* Header con título del torneo */}
      <section className="card p-6">
        <h1 className="text-3xl font-bold text-slate-900">{torneo.nombre}</h1>
        <p className="text-slate-600 mt-2">Tipo: <span className="font-semibold">{torneo.tipo_torneo}</span> </p>
      </section>

      {torneo.status !== "finalizado" && championInfo && (
        <section className="rounded-2xl border-2 border-yellow-300 bg-gradient-to-r from-yellow-50 via-amber-50 to-orange-50 p-5 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Final definida</p>
              <h2 className="mt-1 text-2xl font-extrabold text-amber-900">🏆 Campeón: {championInfo.pairName}</h2>
              <p className="mt-1 text-sm font-medium text-amber-800">La final ya terminó. Falta marcar el torneo como finalizado para cerrarlo oficialmente.</p>
            </div>
            <span className="inline-flex w-fit rounded-full bg-amber-200 px-4 py-2 text-xs font-bold uppercase text-amber-900">
              Pendiente de cierre
            </span>
          </div>
        </section>
      )}

      {/* Estadísticas principales */}
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card: Parejas inscritas */}
        <div className="card p-6 bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-blue-700 uppercase tracking-wide">Parejas inscritas</p>
            <span className="text-2xl">👥</span>
          </div>
          <p className="text-3xl font-bold text-blue-900">{totalParejas}</p>
        </div>

        {/* Card: Presentes/Ausentes */}
        <div className="card p-6 bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-emerald-700 uppercase tracking-wide">Presentes</p>
            <span className="text-2xl">✓</span>
          </div>
          <p className="text-3xl font-bold text-emerald-900">{parejasPresentes}</p>
          <p className="text-xs text-emerald-700 mt-1">{parejasAusentes} ausente{parejasAusentes !== 1 ? 's' : ''}</p>
        </div>

        {/* Card: Monto recaudado */}
        <div className="card p-6 bg-gradient-to-br from-green-50 to-green-100 border border-green-200">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-green-700 uppercase tracking-wide">Recaudado</p>
            <span className="text-2xl">💰</span>
          </div>
          <p className="text-3xl font-bold text-green-900">${montoRecaudado.toLocaleString('es-AR')}</p>
        </div>

        {/* Card: Progreso del torneo */}
        <div className="card p-6 bg-gradient-to-br from-amber-50 to-amber-100 border border-amber-200">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-amber-700 uppercase tracking-wide">Progreso</p>
            <span className="text-2xl">🏁</span>
          </div>
          <p className="text-3xl font-bold text-amber-900">{porcentajeProgreso}%</p>
          <div className="w-full bg-amber-300 rounded-full h-2 mt-3 overflow-hidden">
            <div className="bg-amber-700 h-full" style={{ width: `${porcentajeProgreso}%` }}></div>
          </div>
          <p className="text-xs text-amber-700 mt-2">{partidosFinalizados} de {totalPartidos} partidos finalizados</p>
        </div>
      </div>

      {/* KPIs de estado actual */}
      <section className="card p-5 flex flex-wrap items-center justify-between gap-4 bg-blue-50 border border-blue-200">
        <div>
          <h2 className="text-lg font-bold text-blue-900">Estado actual</h2>
          <p className="text-sm text-blue-700 mt-1">Control operativo en tiempo real</p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <span className="px-4 py-2 rounded-full bg-red-100 text-red-700 text-sm font-semibold">En juego: {enJuego.length}</span>
          <span className="px-4 py-2 rounded-full bg-amber-100 text-amber-700 text-sm font-semibold">En cola: {pendientesConCanchaValidos.length}</span>
          <span className="px-4 py-2 rounded-full bg-emerald-100 text-emerald-700 text-sm font-semibold">Libres: {canhasLibres}</span>
        </div>
      </section>

      {(error || info) && (
        <section className="card p-4">
          {error && <p className="text-red-600 font-semibold">{error}</p>}
          {info && <p className="text-emerald-700 font-semibold">{info}</p>}
        </section>
      )}

      {/* Sección: Partidos en juego */}
      {enJuego.length > 0 && (
        <section className="card p-5 border-l-4 border-l-red-500">
          <h2 className="font-bold text-lg text-red-700 mb-4">⚡ Partidos en juego ({enJuego.length})</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {enJuego.map((m, idx) => {
              const elapsed = elapsedTimes[m.id] || 0;
              const courtLabel =
                playingCourtByMatchId.get(m.id)
                || courtNameById.get(Number(m.court_id))
                || "Cancha sin asignar";

              return (
                <div key={m.id} className="rounded-xl border border-red-200 bg-red-50 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-semibold text-red-700">#{idx + 1}</p>
                    <p className="text-sm font-bold text-red-600 bg-red-100 px-2 py-1 rounded">{formatElapsedTime(elapsed)}</p>
                  </div>
                  <p className="text-xs text-red-600 mb-3">{m.stage} · Ronda {m.round || '-'}</p>
                  <p className="text-xs text-slate-600 mb-2">Cancha: <span className="font-semibold text-slate-800">{courtLabel}</span></p>
                  <p className="text-sm font-medium text-slate-800">{pairNameMap.get(m.pair1_id) || "Por definir"}</p>
                  <p className="text-center text-xs text-slate-500 my-1">vs</p>
                  <p className="text-sm font-medium text-slate-800">{pairNameMap.get(m.pair2_id) || "Por definir"}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Sección: Canchas */}
      {canchasEstado.length > 0 && (
        <section className="card p-5 border-l-4 border-l-purple-500">
          <h2 className="font-bold text-lg text-purple-700 mb-4">🏟️ Estado de canchas ({canchasEstado.length})</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 auto-rows-max">
            {canchasEstado.map((cancha) => {
              const colors = getStateClasses(cancha.estado);

              return (
                <div
                  key={cancha.court.id}
                  className={`flex flex-col gap-2 rounded-lg border-2 p-3 ${colors.bg} ${colors.border}`}
                >
                  {/* Header de la cancha */}
                  <div className="sticky top-0 bg-white/80 backdrop-blur -m-3 mb-0 p-3 rounded-t-md border-b-2 border-inherit">
                    <div className="flex items-center justify-between">
                      <p className={`font-bold ${colors.text}`}>{cancha.court.nombre || cancha.court.identificador}</p>
                      <span className="text-lg">{colors.icon}</span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1 line-clamp-2">{cancha.court.descripcion || "Sin descripcion"}</p>
                    <p className="text-xs text-slate-500 mt-1">Estado: <span className={`font-semibold ${colors.label}`}>{cancha.estado}</span></p>
                  </div>

                  {/* Partido en juego */}
                  {cancha.estado === "ocupada" && cancha.playing && (
                    <div className="rounded-lg bg-red-100/60 border border-red-300 p-3 space-y-1">
                      <p className="text-[10px] font-bold text-red-700 uppercase">► EN CANCHA</p>
                      <p className="text-sm font-semibold text-slate-900 line-clamp-2">{pairNameMap.get(cancha.playing.pair1_id) || "Por definir"}</p>
                      <p className="text-[10px] text-slate-500 text-center">vs</p>
                      <p className="text-sm font-semibold text-slate-900 line-clamp-2">{pairNameMap.get(cancha.playing.pair2_id) || "Por definir"}</p>
                    </div>
                  )}

                  {/* Próximos partidos encolados */}
                  {cancha.queue && cancha.queue.length > 0 && (
                    <div className="space-y-2">
                      {cancha.queue.map((match, qIdx) => (
                        <div key={match.id} className="rounded-lg bg-amber-50 border border-amber-300 p-3 space-y-1">
                          <p className="text-[10px] font-bold text-amber-700 uppercase">
                            {qIdx === 0 ? "⏳ PRÓXIMO" : `🔄 POS #${qIdx + 1}`}
                          </p>
                          <p className="text-sm font-semibold text-slate-900 line-clamp-2">{pairNameMap.get(match.pair1_id) || "Por definir"}</p>
                          <p className="text-[10px] text-slate-500 text-center">vs</p>
                          <p className="text-sm font-semibold text-slate-900 line-clamp-2">{pairNameMap.get(match.pair2_id) || "Por definir"}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Cancha libre */}
                  {cancha.estado === "libre" && (
                    <div className="rounded-lg bg-emerald-100 border border-emerald-300 p-3 text-center">
                      <p className="text-sm font-semibold text-emerald-700">✓ DISPONIBLE</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Sección de próximos partidos en cola oculta: ya se visualiza por columnas en Estado de canchas */}
    </div>
  );
}
