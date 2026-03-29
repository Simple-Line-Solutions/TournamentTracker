import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api";
import { useTournamentStore } from "../store/tournamentStore";
import "./TournamentZonasPage.css";

const emptyForm = {
  set1_pair1: "",
  set1_pair2: "",
  set2_pair1: "",
  set2_pair2: "",
  supertb_pair1: "",
  supertb_pair2: "",
};

const zoneThemes = [
  {
    card: "border-emerald-200",
    header: "bg-emerald-50/70",
    letter: "border-emerald-300 text-emerald-700 bg-emerald-100",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-300",
    pendingMatch: "border-emerald-200",
    actionBtn: "border-brandGreen text-brandGreen hover:bg-emerald-50",
  },
  {
    card: "border-sky-200",
    header: "bg-sky-50/70",
    letter: "border-sky-300 text-sky-700 bg-sky-100",
    badge: "bg-sky-50 text-sky-700 border-sky-300",
    pendingMatch: "border-sky-200",
    actionBtn: "border-sky-500 text-sky-600 hover:bg-sky-50",
  },
  {
    card: "border-violet-200",
    header: "bg-violet-50/70",
    letter: "border-violet-300 text-violet-700 bg-violet-100",
    badge: "bg-violet-50 text-violet-700 border-violet-300",
    pendingMatch: "border-violet-200",
    actionBtn: "border-violet-500 text-violet-600 hover:bg-violet-50",
  },
  {
    card: "border-cyan-200",
    header: "bg-cyan-50/70",
    letter: "border-cyan-300 text-cyan-700 bg-cyan-100",
    badge: "bg-cyan-50 text-cyan-700 border-cyan-300",
    pendingMatch: "border-cyan-200",
    actionBtn: "border-cyan-500 text-cyan-600 hover:bg-cyan-50",
  },
];

function zoneThemeFor(zoneName, index) {
  const str = String(zoneName || "");
  const hash = str.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return zoneThemes[(hash + index) % zoneThemes.length];
}

function scoreBoxClass(hasValue, editing) {
  if (editing) return "border border-brandViolet/40 bg-white";
  if (hasValue) return "border border-brandGreen/30 bg-emerald-50 text-emerald-700";
  return "border border-slate-200 bg-slate-50 text-slate-400";
}

export default function TournamentZonasPage() {
  const { id } = useParams();
  const tournamentVersion = useTournamentStore((s) => s.tournamentVersion);
  const [torneo, setTorneo] = useState(null);
  const [zonas, setZonas] = useState([]);
  const [parejas, setParejas] = useState([]);
  const [canchas, setCanchas] = useState([]);
  const [zoneOrders, setZoneOrders] = useState({});
  const [resultForms, setResultForms] = useState({});
  const [startCourtByMatch, setStartCourtByMatch] = useState({});
  const [dragZonePair, setDragZonePair] = useState(null);
  const [collapsedZones, setCollapsedZones] = useState({});
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  const lastTieWarningRef = useRef("");
  const scoreInputRefs = useRef({});
  const finalizeButtonRefs = useRef({});
  const pendingFocusMatchRef = useRef(null);

  const load = async () => {
    const [t, z, p, c] = await Promise.all([
      api.get(`/torneos/${id}`),
      api.get(`/torneos/${id}/zonas`),
      api.get(`/torneos/${id}/parejas`),
      api.get(`/torneos/${id}/canchas`),
    ]);

    setTorneo(t.data);
    setZonas(z.data || []);
    setParejas(p.data || []);
    setCanchas(c.data || []);

    const nextOrder = {};
    const nextCourtByMatch = {};
    (z.data || []).forEach((zone) => {
      nextOrder[zone.group.id] = zone.standings.map((s) => s.pair_id);
      (zone.matches || []).forEach((match) => {
        nextCourtByMatch[match.id] = match.court_id ? String(match.court_id) : "";
      });
    });
    setZoneOrders(nextOrder);
    setStartCourtByMatch(nextCourtByMatch);
  };

  useEffect(() => {
    load().catch(() => setError("No se pudieron cargar las zonas"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, tournamentVersion]);

  const pairNameMap = useMemo(() => {
    const map = new Map();
    parejas.forEach((p) => {
      map.set(p.id, `${p.player1_nombre} ${p.player1_apellido} / ${p.player2_nombre} ${p.player2_apellido}`);
    });
    return map;
  }, [parejas]);

  const zoneMatches = useMemo(
    () => zonas.flatMap((z) => (z.matches || []).map((m) => ({ ...m, zoneName: z.group.name, zoneId: z.group.id }))),
    [zonas]
  );

  const warnings = useMemo(
    () => ({
      empates: zonas.filter((z) => z.has_tie_warning).length,
    }),
    [zonas]
  );

  const tieWarningText = useMemo(() => {
    const warningZones = zonas.filter((z) => z.has_tie_warning);
    if (!warningZones.length) return "";
    if (warningZones.length === 1) {
      return `Empate en Zona ${warningZones[0].group.name}. Defini las posiciones manualmente para continuar.`;
    }
    return `Hay empates en ${warningZones.length} zonas. Defini las posiciones manualmente para continuar.`;
  }, [zonas]);

  const zonePending = useMemo(() => zoneMatches.filter((m) => !m.winner_id), [zoneMatches]);

  useEffect(() => {
    setCollapsedZones((prev) => {
      const next = { ...prev };
      zonas.forEach((z) => {
        if (next[z.group.id] === undefined) next[z.group.id] = false;
      });
      return next;
    });
  }, [zonas]);

  const pushToast = (type, message) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, type, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  };

  useEffect(() => {
    if (!error) return;
    pushToast("error", error);
    setError("");
  }, [error]);

  useEffect(() => {
    if (!info) return;
    pushToast("success", info);
    setInfo("");
  }, [info]);

  useEffect(() => {
    if (!tieWarningText) {
      lastTieWarningRef.current = "";
      return;
    }
    if (lastTieWarningRef.current === tieWarningText) return;
    lastTieWarningRef.current = tieWarningText;
    pushToast("warn", tieWarningText);
  }, [tieWarningText]);

  useEffect(() => {
    if (!pendingFocusMatchRef.current) return;
    const input = scoreInputRefs.current[`${pendingFocusMatchRef.current}:set1_pair1`];
    if (input) {
      input.focus();
      pendingFocusMatchRef.current = null;
    }
  }, [zonas]);

  const moveZonePosition = (zoneId, index, direction) => {
    const list = [...(zoneOrders[zoneId] || [])];
    const swap = index + direction;
    if (swap < 0 || swap >= list.length) return;
    [list[index], list[swap]] = [list[swap], list[index]];
    setZoneOrders((prev) => ({ ...prev, [zoneId]: list }));
  };

  const onZoneDrop = (zoneId, targetPairId) => {
    if (!dragZonePair || dragZonePair.zoneId !== zoneId) return;
    const list = [...(zoneOrders[zoneId] || [])];
    const from = list.indexOf(dragZonePair.pairId);
    const to = list.indexOf(targetPairId);
    if (from < 0 || to < 0 || from === to) return;
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    setZoneOrders((prev) => ({ ...prev, [zoneId]: list }));
    setDragZonePair(null);
  };

  const saveZonePositions = async (zoneId) => {
    const ordered_pair_ids = zoneOrders[zoneId] || [];
    try {
      setError("");
      setInfo("");
      await api.put(`/torneos/${id}/zonas/${zoneId}/posiciones`, { ordered_pair_ids });
      setInfo(`Posiciones de Zona ${zonas.find((z) => z.group.id === zoneId)?.group.name || ""} guardadas`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || "No se pudieron guardar posiciones");
    }
  };

  const cerrarZonas = async () => {
    const ordered_by_zone = Object.fromEntries(
      Object.entries(zoneOrders).map(([zoneId, pairIds]) => [zoneId, (pairIds || []).map((value) => Number(value))])
    );

    try {
      setError("");
      setInfo("");
      await api.put(`/torneos/${id}/zonas/cerrar`, { ordered_by_zone });
      setInfo("Zonas cerradas y cuadro eliminatorio sincronizado");
      await load();
    } catch (err) {
      setError(err.response?.data?.error || "No se pudieron cerrar las zonas");
    }
  };

  const toNumberOrNull = (value) => {
    if (value === "" || value == null) return null;
    const n = Number(value);
    return Number.isNaN(n) ? NaN : n;
  };

  const guardarResultado = async (match) => {
    const form = resultForms[match.id] || emptyForm;
    const payload = {
      set1_pair1: toNumberOrNull(form.set1_pair1),
      set1_pair2: toNumberOrNull(form.set1_pair2),
      set2_pair1: toNumberOrNull(form.set2_pair1),
      set2_pair2: toNumberOrNull(form.set2_pair2),
      supertb_pair1: toNumberOrNull(form.supertb_pair1),
      supertb_pair2: toNumberOrNull(form.supertb_pair2),
    };

    const invalidNumeric = Object.entries(payload)
      .filter(([, v]) => v !== null)
      .some(([, v]) => Number.isNaN(v));

    if (invalidNumeric) {
      setError("Los sets deben ser numeros validos");
      return;
    }

    if (torneo?.match_format === "best_of_3_super_tb") {
      if (payload.set1_pair1 === null || payload.set1_pair2 === null || payload.set2_pair1 === null || payload.set2_pair2 === null) {
        setError("En mejor de 3 con Super Tie-Break, Set 1 y Set 2 son obligatorios");
        return;
      }
      const oneStbMissing = (payload.supertb_pair1 === null) !== (payload.supertb_pair2 === null);
      if (oneStbMissing) {
        setError("Si cargas Super Tie-Break, completa ambos valores");
        return;
      }
    }

    try {
      setError("");
      setInfo("");
      await api.put(`/partidos/${match.id}/resultado`, payload);
      setInfo("Resultado cargado correctamente");
      await load();
    } catch (err) {
      setError(err.response?.data?.error || "No se pudo cargar resultado");
    }
  };

  const marcarWO = async (matchId, winnerId) => {
    try {
      setError("");
      setInfo("");
      await api.put(`/partidos/${matchId}/wo`, { winner_id: winnerId });
      setInfo("W.O. registrado");
      await load();
    } catch (err) {
      setError(err.response?.data?.error || "No se pudo marcar W.O.");
    }
  };

  const initializeMatchForm = (match) => {
    setResultForms((prev) => ({
      ...prev,
      [match.id]: {
        set1_pair1: prev[match.id]?.set1_pair1 ?? (match.set1_pair1 ?? ""),
        set1_pair2: prev[match.id]?.set1_pair2 ?? (match.set1_pair2 ?? ""),
        set2_pair1: prev[match.id]?.set2_pair1 ?? (match.set2_pair1 ?? ""),
        set2_pair2: prev[match.id]?.set2_pair2 ?? (match.set2_pair2 ?? ""),
        supertb_pair1: prev[match.id]?.supertb_pair1 ?? (match.supertb_pair1 ?? ""),
        supertb_pair2: prev[match.id]?.supertb_pair2 ?? (match.supertb_pair2 ?? ""),
      },
    }));
  };

  const startMatch = async (match) => {
    const courtId = Number(startCourtByMatch[match.id] || match.queue_court_id || match.court_id);
    if (!courtId) {
      setError("Debes asignar una cancha antes de iniciar");
      return;
    }

    try {
      setError("");
      setInfo("");
      await api.put(`/partidos/${match.id}/iniciar`, { court_id: courtId });
      initializeMatchForm(match);
      pendingFocusMatchRef.current = match.id;
      setInfo("Partido iniciado correctamente");
      await load();
    } catch (err) {
      setError(err.response?.data?.error || "No se pudo iniciar el partido");
    }
  };

  const saveMatchCourt = async (match, nextCourtId) => {
    const previousValue = startCourtByMatch[match.id] || "";
    setStartCourtByMatch((prev) => ({ ...prev, [match.id]: nextCourtId }));

    try {
      setError("");
      setInfo("");
      await api.put(`/partidos/${match.id}/cancha`, {
        court_id: nextCourtId ? Number(nextCourtId) : null,
      });
      setInfo(nextCourtId ? "Partido en cola correctamente" : "Cancha desasignada");
      await load();
    } catch (err) {
      setStartCourtByMatch((prev) => ({ ...prev, [match.id]: previousValue }));
      setError(err.response?.data?.error || "No se pudo guardar la cancha del partido");
    }
  };

  const updateForm = (matchId, key, value) => {
    setResultForms((prev) => ({
      ...prev,
      [matchId]: { ...(prev[matchId] || emptyForm), [key]: value },
    }));
  };

  const getEditableFields = () => {
    const fields = ["set1_pair1", "set1_pair2"];
    if (torneo?.match_format !== "one_set") {
      fields.push("set2_pair1", "set2_pair2");
    }
    if (torneo?.match_format === "best_of_3_super_tb") {
      fields.push("supertb_pair1", "supertb_pair2");
    }
    return fields;
  };

  const focusNextField = (matchId, fieldKey) => {
    const fields = getEditableFields();
    const index = fields.indexOf(fieldKey);
    const nextField = fields[index + 1];
    if (nextField) {
      scoreInputRefs.current[`${matchId}:${nextField}`]?.focus();
      return;
    }
    finalizeButtonRefs.current[matchId]?.focus();
  };

  const updateDigitField = (matchId, key, rawValue) => {
    const value = String(rawValue || "").replace(/\D/g, "").slice(0, 1);
    updateForm(matchId, key, value);
    if (value) {
      window.requestAnimationFrame(() => focusNextField(matchId, key));
    }
  };

  const registerScoreInput = (matchId, key) => (node) => {
    if (!node) {
      delete scoreInputRefs.current[`${matchId}:${key}`];
      return;
    }
    scoreInputRefs.current[`${matchId}:${key}`] = node;
  };

  const registerFinalizeButton = (matchId) => (node) => {
    if (!node) {
      delete finalizeButtonRefs.current[matchId];
      return;
    }
    finalizeButtonRefs.current[matchId] = node;
  };

  const toggleZoneCollapse = (zoneId) => {
    setCollapsedZones((prev) => ({ ...prev, [zoneId]: !prev[zoneId] }));
  };

  if (!torneo) return <p>Cargando...</p>;

  return (
    <div className="zonas-page">
      <section className="card p-5 zonas-header">
        <div>
          <h1 className="text-2xl font-bold">Zonas y resultados</h1>
          <p className="zonas-header-subtitle">Carga de partidos y control de posiciones.</p>
        </div>
        <div className="zonas-kpis">
          <span className="zonas-kpi">Zonas: {zonas.length}</span>
          <span className="zonas-kpi">Pendientes: {zonePending.length}</span>
          <span className="zonas-kpi zonas-kpi-warning">Empates: {warnings.empates}</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary" onClick={cerrarZonas} disabled={!zonas.length}>
            Cerrar zonas
          </button>
        </div>
      </section>

      {!zonas.length && (
        <section className="card p-6 zonas-empty">
          Aun no hay zonas generadas para este torneo.
        </section>
      )}

      <section
        className={`zonas-grid ${zonas.length >= 3 ? "cols-2xl-3" : "cols-2xl-2"}`}
      >
        {zonas.map((z, idx) => {
          const orderedIds = zoneOrders[z.group.id] || [];
          const zoneTheme = zoneThemeFor(z.group.name, idx);
          const isCollapsed = Boolean(collapsedZones[z.group.id]);

          return (
            <article key={z.group.id} className={`card self-start overflow-hidden ${zoneTheme.card} ${z.has_tie_warning ? "ring-1 ring-amber-300" : ""}`}>
              <button
                className={`w-full flex items-center justify-between gap-2 px-4 py-3 text-left transition ${zoneTheme.header} ${isCollapsed ? "" : "border-b border-slate-200"}`}
                onClick={() => toggleZoneCollapse(z.group.id)}
                aria-expanded={!isCollapsed}
              >
                <div className="flex items-center gap-2">
                  <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-xs font-bold ${z.has_tie_warning ? "border-amber-300 text-amber-700 bg-amber-100" : zoneTheme.letter}`}>
                    {z.group.name}
                  </span>
                  <h2 className="text-sm md:text-base font-semibold text-slate-800">Zona {z.group.name} - {z.group.size} parejas</h2>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-[11px] border ${z.has_tie_warning ? "bg-amber-100 text-amber-700 border-amber-300" : zoneTheme.badge}`}>
                    {z.has_tie_warning ? "Empate" : "Completa"}
                  </span>
                  <span className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600">
                    {isCollapsed ? "Expandir" : "Colapsar"}
                  </span>
                </div>
              </button>

              {!isCollapsed && (
                <>

              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                      <th className="px-4 py-2 text-left">#</th>
                      <th className="px-4 py-2 text-left">Pareja</th>
                     
                      <th className="px-3 py-2 text-center">PJ</th>
                      <th className="px-3 py-2 text-center">PG</th>
                       {torneo?.match_format === "best_of_3_super_tb" && (
                        <>
                          <th className="px-3 py-2 text-center">S+</th>
                          <th className="px-3 py-2 text-center">S-</th>
                          <th className="px-3 py-2 text-center bg-slate-100/80 text-slate-600">DS</th>
                        </>
                      )}
                      <th className="px-3 py-2 text-center">G+</th>
                      <th className="px-3 py-2 text-center">G-</th>
                      <th className="px-3 py-2 text-center bg-slate-100/80 text-slate-600">DG</th>
                      <th className="px-3 py-2 text-center bg-slate-200/80 text-slate-700">PTS</th>
                      <th className="px-4 py-2 text-right">Orden</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderedIds.map((pairId, idx) => {
                      const standing = z.standings.find((s) => s.pair_id === pairId);
                      
                      // Contar solo partidos finalizados (con resultado)
                      const finishedMatches = (z.matches || []).filter((m) => m.winner_id != null && (m.pair1_id === pairId || m.pair2_id === pairId));
                      const pj = finishedMatches.length;
                      const pg = finishedMatches.filter((m) => m.winner_id === pairId).length;
                      
                      // Calcular sets ganados/perdidos (solo para torneos largo, y solo de partidos finalizados)
                      let setsWon = 0;
                      let setsLost = 0;
                      if (torneo?.match_format === "best_of_3_super_tb") {
                        finishedMatches.forEach((m) => {
                          const isPair1 = m.pair1_id === pairId;
                          const [s1p1, s1p2, s2p1, s2p2, sbp1, sbp2] = [
                            m.set1_pair1, m.set1_pair2, m.set2_pair1, m.set2_pair2, m.supertb_pair1, m.supertb_pair2
                          ];
                          if (isPair1) {
                            if (s1p1 != null && s1p2 != null) setsWon += s1p1 > s1p2 ? 1 : 0, setsLost += s1p1 < s1p2 ? 1 : 0;
                            if (s2p1 != null && s2p2 != null) setsWon += s2p1 > s2p2 ? 1 : 0, setsLost += s2p1 < s2p2 ? 1 : 0;
                            if (sbp1 != null && sbp2 != null) setsWon += sbp1 > sbp2 ? 1 : 0, setsLost += sbp1 < sbp2 ? 1 : 0;
                          } else {
                            if (s1p1 != null && s1p2 != null) setsWon += s1p2 > s1p1 ? 1 : 0, setsLost += s1p2 < s1p1 ? 1 : 0;
                            if (s2p1 != null && s2p2 != null) setsWon += s2p2 > s2p1 ? 1 : 0, setsLost += s2p2 < s2p1 ? 1 : 0;
                            if (sbp1 != null && sbp2 != null) setsWon += sbp2 > sbp1 ? 1 : 0, setsLost += sbp2 < sbp1 ? 1 : 0;
                          }
                        });
                      }

                      return (
                        <tr
                          key={`${z.group.id}-${pairId}`}
                          className="border-t border-slate-200 text-sm hover:bg-slate-50"
                          draggable
                          onDragStart={() => setDragZonePair({ zoneId: z.group.id, pairId })}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => onZoneDrop(z.group.id, pairId)}
                        >
                          <td className={`px-4 py-2 text-center ${z.has_tie_warning ? "text-amber-700" : "text-slate-500"}`}>
                            {idx + 1}°
                          </td>
                          <td className="px-4 py-2">
                            <div className="font-medium text-slate-800">{pairNameMap.get(pairId) || `Pareja ${pairId}`}</div>
                          </td>
                          <td className="px-3 py-2 text-center text-slate-600">{pj}</td>
                          <td className="px-3 py-2 text-center text-slate-600">{pg}</td>
                          {torneo?.match_format === "best_of_3_super_tb" && (
                            <>
                              <td className="px-3 py-2 text-center text-slate-600">{setsWon}</td>
                              <td className="px-3 py-2 text-center text-slate-600">{setsLost}</td>
                              <td className="px-3 py-2 text-center text-slate-700 bg-slate-50/90 font-medium">{setsWon - setsLost}</td>
                            </>
                          )}
                          <td className="px-3 py-2 text-center text-slate-600">{standing?.games_won ?? 0}</td>
                          <td className="px-3 py-2 text-center text-slate-600">{standing?.games_lost ?? 0}</td>
                          <td className="px-3 py-2 text-center text-slate-700 bg-slate-50/90 font-medium">{(standing?.games_won ?? 0) - (standing?.games_lost ?? 0)}</td>
                          <td className={`px-3 py-2 text-center font-bold bg-slate-100/90 ${z.has_tie_warning ? "text-amber-700" : "text-emerald-700"}`}>
                            {standing?.points ?? 0}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex justify-end gap-1">
                              <button className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:text-slate-800" onClick={() => moveZonePosition(z.group.id, idx, -1)}>↑</button>
                              <button className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:text-slate-800" onClick={() => moveZonePosition(z.group.id, idx, 1)}>↓</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {torneo?.tipo_torneo !== "americano" && (
                <div className="border-t border-slate-200 px-4 py-3">
                  <button className="btn-secondary" onClick={() => saveZonePositions(z.group.id)}>
                    Guardar posiciones manuales
                  </button>
                </div>
              )}

              <div className="border-t border-slate-200 px-3 py-2 bg-slate-50/60">
                <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Partidos</p>

                <div className="mt-1 space-y-1">
                  {(z.matches || [])
                    .slice()
                    .sort((a, b) => a.id - b.id)
                    .map((m) => {
                      const p1 = pairNameMap.get(m.pair1_id) || "Por definir";
                      const p2 = pairNameMap.get(m.pair2_id) || "Por definir";
                      const isStarted = Boolean(m.started_at);
                      const isFinished = Boolean(m.finished_at || m.winner_id);
                      const form = resultForms[m.id] || emptyForm;
                      const canEdit = isStarted && !isFinished;
                      const canEditSet2 = canEdit && torneo?.match_format !== "one_set";
                      const assignedCourtId = m.court_id || m.queue_court_id;
                      const courtName = canchas.find((court) => Number(court.id) === Number(assignedCourtId))?.nombre
                        || canchas.find((court) => Number(court.id) === Number(assignedCourtId))?.identificador
                        || null;

                      const v11 = canEdit ? form.set1_pair1 : (m.set1_pair1 ?? "-");
                      const v12 = canEdit ? form.set1_pair2 : (m.set1_pair2 ?? "-");
                      const v21 = canEdit ? form.set2_pair1 : (m.set2_pair1 ?? "-");
                      const v22 = canEdit ? form.set2_pair2 : (m.set2_pair2 ?? "-");

                      return (
                        <div key={m.id} className={`rounded-xl border px-2 py-1 ${isFinished ? "border-slate-200 bg-white" : `${zoneTheme.pendingMatch} bg-white`}`}>
                          <p className={`mb-1 text-[10px] uppercase tracking-[0.1em] ${isFinished ? "text-slate-500" : "text-emerald-700"}`}>
                            {m.round > 0 && <>Ronda {m.round} · </>}Partido {m.id}
                          </p>

                          <div className="mb-2 grid grid-cols-[1fr,auto,auto,auto] gap-1 items-center">
                            {!isStarted && !isFinished && (
                              <>
                                <select
                                  className="input h-8 text-xs"
                                  value={startCourtByMatch[m.id] || ""}
                                  onChange={(e) => saveMatchCourt(m, e.target.value)}
                                >
                                  <option value="">Cancha</option>
                                  {canchas.map((court) => (
                                    <option key={court.id} value={court.id}>{court.nombre || court.identificador}</option>
                                  ))}
                                </select>
                                {courtName && (
                                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-700 whitespace-nowrap">
                                    {courtName}{m.queue_orden ? ` #${m.queue_orden}` : ""}
                                  </span>
                                )}
                                <button className={`rounded-full border px-2 py-1 text-xs ${zoneTheme.actionBtn}`} onClick={() => startMatch(m)}>
                                  Iniciar
                                </button>
                              </>
                            )}
                            {isStarted && courtName && (
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-600 whitespace-nowrap">
                                {isFinished ? `Finalizado · ${courtName}` : `En cancha · ${courtName}`}
                              </span>
                            )}
                          </div>

                          <div className="grid grid-cols-[1fr,140px,1fr,auto] items-center gap-1 mb-1">
                            <span className="text-xs text-slate-800 line-clamp-1">{p1}</span>

                            <div className="space-y-0.5">
                              <div className="flex items-center justify-center gap-0.5">
                                {canEdit ? (
                                  <input ref={registerScoreInput(m.id, "set1_pair1")} type="text" inputMode="numeric" maxLength={1} className="h-6 w-7 rounded text-center text-xs border border-brandViolet/40" value={v11} onChange={(e) => updateDigitField(m.id, "set1_pair1", e.target.value)} />
                                ) : (
                                  <span className={`inline-flex h-6 w-7 items-center justify-center rounded text-xs ${scoreBoxClass(m.set1_pair1 != null, false)}`}>{v11}</span>
                                )}
                                <span className="text-[9px] text-slate-400">-</span>
                                {canEdit ? (
                                  <input ref={registerScoreInput(m.id, "set1_pair2")} type="text" inputMode="numeric" maxLength={1} className="h-6 w-7 rounded text-center text-xs border border-brandViolet/40" value={v12} onChange={(e) => updateDigitField(m.id, "set1_pair2", e.target.value)} />
                                ) : (
                                  <span className={`inline-flex h-6 w-7 items-center justify-center rounded text-xs ${scoreBoxClass(m.set1_pair2 != null, false)}`}>{v12}</span>
                                )}
                                <span className="w-8 text-[9px] text-slate-400 text-center">S1</span>
                              </div>

                              {torneo?.match_format === "best_of_3_super_tb" && (
                                <div className="flex items-center justify-center gap-0.5">
                                  {canEditSet2 ? (
                                    <input ref={registerScoreInput(m.id, "set2_pair1")} type="text" inputMode="numeric" maxLength={1} className="h-6 w-7 rounded text-center text-xs border border-brandViolet/40" value={v21} onChange={(e) => updateDigitField(m.id, "set2_pair1", e.target.value)} />
                                  ) : (
                                    <span className={`inline-flex h-6 w-7 items-center justify-center rounded text-xs ${scoreBoxClass(m.set2_pair1 != null, false)}`}>{v21}</span>
                                  )}
                                  <span className="text-[9px] text-slate-400">-</span>
                                  {canEditSet2 ? (
                                    <input ref={registerScoreInput(m.id, "set2_pair2")} type="text" inputMode="numeric" maxLength={1} className="h-6 w-7 rounded text-center text-xs border border-brandViolet/40" value={v22} onChange={(e) => updateDigitField(m.id, "set2_pair2", e.target.value)} />
                                  ) : (
                                    <span className={`inline-flex h-6 w-7 items-center justify-center rounded text-xs ${scoreBoxClass(m.set2_pair2 != null, false)}`}>{v22}</span>
                                  )}
                                  <span className="w-8 text-[9px] text-slate-400 text-center">S2</span>
                                </div>
                              )}

                              {torneo?.match_format === "best_of_3_super_tb" && (
                                <div className="flex items-center justify-center gap-0.5">
                                  {canEdit ? (
                                    <input ref={registerScoreInput(m.id, "supertb_pair1")} type="text" inputMode="numeric" maxLength={1} className="h-6 w-7 rounded text-center text-xs border border-brandViolet/40" value={form.supertb_pair1 || ""} onChange={(e) => updateDigitField(m.id, "supertb_pair1", e.target.value)} />
                                  ) : (
                                    <span className={`inline-flex h-6 w-7 items-center justify-center rounded text-xs ${scoreBoxClass(m.supertb_pair1 != null, false)}`}>{m.supertb_pair1 ?? "-"}</span>
                                  )}
                                  <span className="text-[9px] text-slate-400">-</span>
                                  {canEdit ? (
                                    <input ref={registerScoreInput(m.id, "supertb_pair2")} type="text" inputMode="numeric" maxLength={1} className="h-6 w-7 rounded text-center text-xs border border-brandViolet/40" value={form.supertb_pair2 || ""} onChange={(e) => updateDigitField(m.id, "supertb_pair2", e.target.value)} />
                                  ) : (
                                    <span className={`inline-flex h-6 w-7 items-center justify-center rounded text-xs ${scoreBoxClass(m.supertb_pair2 != null, false)}`}>{m.supertb_pair2 ?? "-"}</span>
                                  )}
                                  <span className="w-8 text-[9px] text-slate-400 text-center">STB</span>
                                </div>
                              )}
                            </div>

                            <span className="text-right text-xs text-slate-800 line-clamp-1">{p2}</span>

                            {canEdit && (
                              <button ref={registerFinalizeButton(m.id)} className="rounded-full bg-brandGreen px-2 py-1 text-xs text-white whitespace-nowrap" onClick={() => guardarResultado(m)}>
                                Finalizar
                              </button>
                            )}
                          </div>

                          {canEdit && torneo?.match_format === "best_of_3_super_tb" && m.pair1_id && m.pair2_id && (
                            <div className="flex flex-wrap gap-1 items-center justify-end mb-2">
                              <button className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-700" onClick={() => marcarWO(m.id, m.pair1_id)}>
                                W.O. P1
                              </button>
                              <button className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-700" onClick={() => marcarWO(m.id, m.pair2_id)}>
                                W.O. P2
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
                </>
              )}
            </article>
          );
        })}
      </section>

      <div className="zonas-toast-stack">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`zonas-toast ${
              t.type === "error"
                ? "zonas-toast-error"
                : t.type === "warn"
                  ? "zonas-toast-warn"
                  : "zonas-toast-success"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
