import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api";
import PageSpinner from "../components/PageSpinner";
import { useAuthStore } from "../store/authStore";
import { useTournamentStore } from "../store/tournamentStore";
import "./TournamentEliminatoriasPage.css";

const emptyForm = {
  set1_pair1: "",
  set1_pair2: "",
  set2_pair1: "",
  set2_pair2: "",
  supertb_pair1: "",
  supertb_pair2: "",
};

function scoreBoxClass(hasValue, editing) {
  if (editing) return "border border-brandViolet/40 bg-white";
  if (hasValue) return "border border-brandGreen/30 bg-emerald-50 text-emerald-700";
  return "border border-slate-200 bg-slate-50 text-slate-400";
}

export default function TournamentEliminatoriasPage() {
  const { id } = useParams();
  const user = useAuthStore((s) => s.user);
  const tournamentVersion = useTournamentStore((s) => s.tournamentVersion);
  const [torneo, setTorneo] = useState(null);
  const [parejas, setParejas] = useState([]);
  const [cuadroData, setCuadroData] = useState({ blocked: false, message: null, matches: [], diagnostics: null });
  const [partidos, setPartidos] = useState([]);
  const [canchasList, setCanchasList] = useState([]);
  const [startCourtByMatch, setStartCourtByMatch] = useState({});
  const [resultForms, setResultForms] = useState({});
  const [savingResultByMatch, setSavingResultByMatch] = useState({});
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  const lastBlockedMessageRef = useRef("");
  const scoreInputRefs = useRef({});
  const finalizeButtonRefs = useRef({});
  const pendingFocusMatchRef = useRef(null);

  // SuperAdmin edit state
  const [saOpenMatchId, setSaOpenMatchId] = useState(null);
  const [saMode, setSaMode] = useState(null); // 'resultado' | 'parejas'
  const [saResultForm, setSaResultForm] = useState({});
  const [saPairsForm, setSaPairsForm] = useState({});
  const [saSaving, setSaSaving] = useState(false);

  const load = async () => {
    const [t, p, c, pd, cl] = await Promise.all([
      api.get(`/torneos/${id}`),
      api.get(`/torneos/${id}/parejas`),
      api.get(`/torneos/${id}/cuadro`),
      api.get(`/torneos/${id}/partidos`),
      api.get(`/torneos/${id}/canchas`),
    ]);
    setTorneo(t.data);
    setParejas(p.data || []);
    setCuadroData(c.data || { blocked: false, message: null, matches: [], diagnostics: null });
    setPartidos(pd.data || []);
    setCanchasList(cl.data || []);

    const nextCourtByMatch = {};
    (pd.data || [])
      .filter((match) => match.stage === "eliminatoria")
      .forEach((match) => {
        nextCourtByMatch[match.id] = match.court_id ? String(match.court_id) : match.queue_court_id ? String(match.queue_court_id) : "";
      });
    setStartCourtByMatch(nextCourtByMatch);
  };

  useEffect(() => {
    load().catch(() => setError("No se pudo cargar eliminatorias"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, tournamentVersion]);

  const pushToast = (type, message) => {
    const toastId = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id: toastId, type, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== toastId));
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
    if (!cuadroData?.blocked || !cuadroData?.message) {
      lastBlockedMessageRef.current = "";
      return;
    }
    if (lastBlockedMessageRef.current === cuadroData.message) return;
    lastBlockedMessageRef.current = cuadroData.message;
    pushToast("error", cuadroData.message);
  }, [cuadroData]);

  useEffect(() => {
    if (!pendingFocusMatchRef.current) return;
    const input = scoreInputRefs.current[`${pendingFocusMatchRef.current}:set1_pair1`];
    if (input) {
      input.focus();
      pendingFocusMatchRef.current = null;
    }
  }, [partidos]);

  const pairNameMap = useMemo(() => {
    const map = new Map();
    parejas.forEach((p) => {
      map.set(p.id, `${p.player1_nombre} ${p.player1_apellido} / ${p.player2_nombre} ${p.player2_apellido}`);
    });
    return map;
  }, [parejas]);

  const cuadroReasons = useMemo(() => {
    const reasons = cuadroData?.diagnostics?.reasons;
    return Array.isArray(reasons) ? reasons : [];
  }, [cuadroData]);

  const showCuadroDiagnostics = useMemo(() => {
    if (cuadroData?.blocked) return true;
    return cuadroReasons.length > 0;
  }, [cuadroData, cuadroReasons]);

  const groupedBracket = useMemo(() => {
    const groups = {};
    (cuadroData.matches || []).forEach((m) => {
      if (!groups[m.round || "r1"]) groups[m.round || "r1"] = [];
      groups[m.round || "r1"].push(m);
    });
    return groups;
  }, [cuadroData]);

  const orderedRounds = useMemo(() => {
    const priority = { r1: 10, dieciseisavos: 20, octavos: 30, cuartos: 40, semis: 50, final: 60 };
    return Object.keys(groupedBracket).sort((a, b) => {
      const diffByCount = (groupedBracket[b]?.length || 0) - (groupedBracket[a]?.length || 0);
      if (diffByCount !== 0) return diffByCount;
      return (priority[a] || 999) - (priority[b] || 999);
    });
  }, [groupedBracket]);

  const roundTitle = (round) => {
    const count = groupedBracket[round]?.length || 0;
    if (count >= 9 && count <= 16) return "16avos";
    if (count >= 5 && count <= 8) return "8vos";
    if (count >= 3 && count <= 4) return "4tos";
    if (count === 2) return "Semi";
    if (count === 1) return "Final";
    return "Ronda";
  };

  const scoreColumns = useMemo(() => {
    const columns = [
      { key: "set1", label: "S1", pair1Key: "set1_pair1", pair2Key: "set1_pair2" },
    ];

    if (torneo?.match_format !== "one_set") {
      columns.push({ key: "set2", label: "S2", pair1Key: "set2_pair1", pair2Key: "set2_pair2" });
    }

    if (torneo?.match_format === "best_of_3_super_tb") {
      columns.push({ key: "stb", label: "STB", pair1Key: "supertb_pair1", pair2Key: "supertb_pair2" });
    }

    return columns;
  }, [torneo?.match_format]);

  const bracketLayout = useMemo(() => {
    if (!orderedRounds.length) return null;

    const firstRoundCount = groupedBracket[orderedRounds[0]]?.length || 1;
    const cardHeight = 188;
    const slotHeight = 226;
    const colWidth = 270;
    const colGap = 78;
    const titleBandHeight = 34;
    const topPad = Math.ceil(cardHeight / 2 + titleBandHeight + 12);
    const leftPad = 24;

    const roundNodes = orderedRounds.map((round, roundIndex) => {
      const matches = groupedBracket[round] || [];
      return matches.map((m, matchIndex) => {
        const centerY =
          topPad + ((2 ** roundIndex - 1) * slotHeight) / 2 + matchIndex * (2 ** roundIndex) * slotHeight;
        const x = leftPad + roundIndex * (colWidth + colGap);
        const y = centerY - cardHeight / 2;
        return { round, roundIndex, matchIndex, match: m, x, y, centerY };
      });
    });

    const width = leftPad * 2 + orderedRounds.length * colWidth + (orderedRounds.length - 1) * colGap;
    const height = topPad * 2 + (firstRoundCount - 1) * slotHeight + cardHeight;

    const connectors = [];
    for (let r = 0; r < roundNodes.length - 1; r += 1) {
      const current = roundNodes[r];
      const next = roundNodes[r + 1];
      for (let i = 0; i < next.length; i += 1) {
        const fromA = current[i * 2];
        const fromB = current[i * 2 + 1];
        const to = next[i];
        if (!fromA || !fromB || !to) continue;

        const xFrom = fromA.x + colWidth;
        const xTo = to.x;
        const xMid = xFrom + (xTo - xFrom) * 0.45;

        connectors.push({ type: "h", x1: xFrom, y1: fromA.centerY, x2: xMid, y2: fromA.centerY });
        connectors.push({ type: "h", x1: xFrom, y1: fromB.centerY, x2: xMid, y2: fromB.centerY });
        connectors.push({ type: "v", x1: xMid, y1: fromA.centerY, x2: xMid, y2: fromB.centerY });
        connectors.push({ type: "h", x1: xMid, y1: to.centerY, x2: xTo, y2: to.centerY });
      }
    }

    return { roundNodes, connectors, width, height, colWidth, leftPad, topPad, colGap };
  }, [groupedBracket, orderedRounds]);

  const eliminatoriaMatches = useMemo(
    () => partidos.filter((m) => m.stage === "eliminatoria" && !m.is_bye).sort((a, b) => a.id - b.id),
    [partidos]
  );

  const eliminatoriaMatchById = useMemo(() => {
    const map = new Map();
    eliminatoriaMatches.forEach((m) => map.set(m.id, m));
    return map;
  }, [eliminatoriaMatches]);

  const partidosEnJuego = useMemo(
    () => partidos.filter((m) => m.stage === "eliminatoria" && m.started_at && !m.finished_at),
    [partidos]
  );

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

  const iniciarPartido = async (match) => {
    const courtId = Number(startCourtByMatch[match.id] || match.queue_court_id || match.court_id);
    if (!courtId) {
      setError("Debes asignar una cancha antes de iniciar");
      return;
    }
    try {
      await api.put(`/partidos/${match.id}/iniciar`, { court_id: courtId });
      initializeMatchForm(match);
      pendingFocusMatchRef.current = match.id;
      setInfo("Partido iniciado correctamente");
      await load();
    } catch (err) {
      setError(err.response?.data?.error || "No se pudo iniciar partido");
    }
  };

  const guardarCancha = async (match, nextCourtId) => {
    const previousValue = startCourtByMatch[match.id] || "";
    setStartCourtByMatch((prev) => ({ ...prev, [match.id]: nextCourtId }));

    try {
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

  const toNumberOrNull = (value) => {
    if (value === "" || value == null) return null;
    const numberValue = Number(value);
    return Number.isNaN(numberValue) ? NaN : numberValue;
  };

  const guardarResultado = async (match) => {
    if (savingResultByMatch[match.id]) return;

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
      .filter(([, value]) => value !== null)
      .some(([, value]) => Number.isNaN(value));

    if (invalidNumeric) {
      setError("Los sets deben ser numeros validos");
      return;
    }

    if (torneo.match_format === "one_set") {
      if (payload.set2_pair1 !== null || payload.set2_pair2 !== null || payload.supertb_pair1 !== null || payload.supertb_pair2 !== null) {
        setError("En formato 1 set, solo debes completar Set 1");
        return;
      }
    }

    if (torneo.match_format === "best_of_3") {
      if (payload.set2_pair1 === null || payload.set2_pair2 === null) {
        setError("En mejor de 3 sets, Set 1 y Set 2 son obligatorios");
        return;
      }
      if (payload.supertb_pair1 !== null || payload.supertb_pair2 !== null) {
        setError("En mejor de 3 sets, no debes cargar Super Tie-Break");
        return;
      }
    }

    if (torneo.match_format === "best_of_3_super_tb") {
      if (payload.set2_pair1 === null || payload.set2_pair2 === null) {
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
      setSavingResultByMatch((prev) => ({ ...prev, [match.id]: true }));
      await api.put(`/partidos/${match.id}/resultado`, payload);
      setInfo("Resultado cargado correctamente");
      await load();
    } catch (err) {
      setError(err.response?.data?.error || "No se pudo cargar resultado");
    } finally {
      setSavingResultByMatch((prev) => {
        const next = { ...prev };
        delete next[match.id];
        return next;
      });
    }
  };

  const marcarWO = async (matchId, winnerId) => {
    try {
      await api.put(`/partidos/${matchId}/wo`, { winner_id: winnerId });
      setInfo("W.O. registrado");
      await load();
    } catch (err) {
      setError(err.response?.data?.error || "No se pudo marcar W.O.");
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

  const openSaPanel = (matchId, mode, match) => {
    setSaOpenMatchId(matchId);
    setSaMode(mode);
    if (mode === "resultado") {
      setSaResultForm({
        set1_pair1: match.set1_pair1 ?? "",
        set1_pair2: match.set1_pair2 ?? "",
        set2_pair1: match.set2_pair1 ?? "",
        set2_pair2: match.set2_pair2 ?? "",
        supertb_pair1: match.supertb_pair1 ?? "",
        supertb_pair2: match.supertb_pair2 ?? "",
      });
    }
    if (mode === "parejas") {
      setSaPairsForm({
        pair1_id: match.pair1_id ? String(match.pair1_id) : "",
        pair2_id: match.pair2_id ? String(match.pair2_id) : "",
      });
    }
  };

  const closeSaPanel = () => { setSaOpenMatchId(null); setSaMode(null); };

  const saGuardarResultado = async (matchId) => {
    setSaSaving(true);
    const toNum = (v) => (v === "" || v == null ? null : Number(v));
    try {
      await api.put(`/partidos/${matchId}/resultado-forzado`, {
        set1_pair1: toNum(saResultForm.set1_pair1),
        set1_pair2: toNum(saResultForm.set1_pair2),
        set2_pair1: toNum(saResultForm.set2_pair1),
        set2_pair2: toNum(saResultForm.set2_pair2),
        supertb_pair1: toNum(saResultForm.supertb_pair1),
        supertb_pair2: toNum(saResultForm.supertb_pair2),
      });
      setInfo("Resultado corregido (SA)");
      closeSaPanel();
      await load();
    } catch (err) {
      setError(err.response?.data?.error || "No se pudo guardar el resultado");
    } finally {
      setSaSaving(false);
    }
  };

  const saGuardarParejas = async (matchId) => {
    setSaSaving(true);
    try {
      await api.put(`/partidos/${matchId}/parejas`, {
        pair1_id: saPairsForm.pair1_id ? Number(saPairsForm.pair1_id) : null,
        pair2_id: saPairsForm.pair2_id ? Number(saPairsForm.pair2_id) : null,
      });
      setInfo("Parejas actualizadas (SA). Partidos dependientes reseteados.");
      closeSaPanel();
      await load();
    } catch (err) {
      setError(err.response?.data?.error || "No se pudo actualizar las parejas");
    } finally {
      setSaSaving(false);
    }
  };

  const finalizarTorneo = async () => {
    try {
      await api.put(`/torneos/${id}/finalizar`);
      setInfo("Torneo finalizado correctamente");
      await load();
    } catch (err) {
      setError(err.response?.data?.error || "No se pudo finalizar torneo");
    }
  };

  if (!torneo) {
    return <PageSpinner title="Cargando eliminatorias" subtitle="Sincronizando cuadro, cruces y canchas..." />;
  }

  return (
    <div className="space-y-5">
      <section className="card p-5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Eliminatorias</h1>
          <p className="text-slate-600 mt-1">Cuadro final · {torneo.match_format}</p>
        </div>
        <div className="flex gap-2">
          <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-sm">En juego: {partidosEnJuego.length}</span>
          <button className="btn-secondary" onClick={finalizarTorneo} disabled={torneo.status === "finalizado"}>Finalizar torneo</button>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-bold text-lg">Cuadro eliminatorio</h2>

        {showCuadroDiagnostics && (
          <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-800">
            <p className="text-sm font-semibold">No se pudo completar la actualizacion automatica del cuadro</p>
            {cuadroReasons.length > 0 ? (
              <div className="mt-2 space-y-1 text-sm">
                {cuadroReasons.map((reason, idx) => (
                  <p key={`diag-${idx}`}>- {reason}</p>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm">Hay cruces aun sin parejas definidas. Revisa los resultados y posiciones de zonas.</p>
            )}
          </div>
        )}

        {bracketLayout && (
          <div className="mt-3 overflow-x-auto eliminatorias-bracket-scroll">
            <div
              className="relative rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 eliminatorias-bracket-surface"
              style={{ width: `${bracketLayout.width}px`, minHeight: `${bracketLayout.height}px` }}
            >
              <svg
                className="absolute inset-0 pointer-events-none"
                width={bracketLayout.width}
                height={bracketLayout.height}
                viewBox={`0 0 ${bracketLayout.width} ${bracketLayout.height}`}
                fill="none"
              >
                {bracketLayout.connectors.map((line, i) => (
                  <line
                    key={`line-${i}`}
                    x1={line.x1}
                    y1={line.y1}
                    x2={line.x2}
                    y2={line.y2}
                    stroke="#cbd5e1"
                    strokeWidth="2"
                  />
                ))}
              </svg>

              {orderedRounds.map((round, roundIndex) => {
                const colX = bracketLayout.leftPad + roundIndex * (bracketLayout.colWidth + bracketLayout.colGap);
                return (
                  <div
                    key={`title-${round}`}
                    className="absolute text-[11px] uppercase tracking-widest text-slate-500 font-semibold"
                    style={{ left: `${colX}px`, top: "12px", width: `${bracketLayout.colWidth}px`, textAlign: "center" }}
                  >
                    {roundTitle(round)}
                  </div>
                );
              })}

              {bracketLayout.roundNodes.flat().map((node) => {
                const liveMatch = eliminatoriaMatchById.get(node.match.id);
                const m = { ...node.match, ...(liveMatch || {}) };
                const p1Label = m.pair1_id ? (pairNameMap.get(m.pair1_id) || m.pair1_placeholder || "Por definir") : (m.pair1_placeholder || "Por definir");
                const p2Label = m.pair2_id ? (pairNameMap.get(m.pair2_id) || m.pair2_placeholder || "Por definir") : (m.pair2_placeholder || "Por definir");
                const p1IsBye = p1Label === "BYE";
                const p2IsBye = p2Label === "BYE";
                const isStarted = Boolean(m.started_at);
                const isFinished = Boolean(m.finished_at || m.winner_id);
                const canEdit = isStarted && !isFinished;
                const canEditSet2 = canEdit && torneo?.match_format !== "one_set";
                const form = resultForms[m.id] || emptyForm;
                const assignedCourtId = m.court_id || m.queue_court_id;
                const courtName = canchasList.find((court) => Number(court.id) === Number(assignedCourtId))?.nombre
                  || canchasList.find((court) => Number(court.id) === Number(assignedCourtId))?.identificador
                  || null;
                const canAssignCourt = Boolean(m.pair1_id && m.pair2_id) && !isFinished && !m.is_bye;
                const v11 = canEdit ? form.set1_pair1 : (m.set1_pair1 ?? "-");
                const v12 = canEdit ? form.set1_pair2 : (m.set1_pair2 ?? "-");
                const v21 = canEdit ? form.set2_pair1 : (m.set2_pair1 ?? "-");
                const v22 = canEdit ? form.set2_pair2 : (m.set2_pair2 ?? "-");

                return (
                  <div
                    key={`match-${m.id}`}
                    className="absolute eliminatoria-match-node"
                    style={{ left: `${node.x}px`, top: `${node.y}px`, width: `${bracketLayout.colWidth}px`, minHeight: "188px" }}
                  >
                    <p className="eliminatoria-match-meta">{roundTitle(m.round || "r1")} · Partido #{m.id}</p>

                    <div className="eliminatoria-match-headline">
                      {!isStarted && !isFinished && !m.is_bye && (
                        <>
                          <select
                            className="eliminatoria-court-select"
                            value={startCourtByMatch[m.id] || ""}
                            onChange={(e) => guardarCancha(m, e.target.value)}
                            disabled={!canAssignCourt}
                          >
                            <option value="">Cancha</option>
                            {canchasList.map((court) => (
                              <option key={court.id} value={court.id}>{court.nombre || court.identificador}</option>
                            ))}
                          </select>
                          <button className="eliminatoria-start-btn" onClick={() => iniciarPartido(m)} disabled={!canAssignCourt}>
                            Iniciar
                          </button>
                        </>
                      )}

                      {(courtName || m.is_bye) && (
                        <span className="eliminatoria-status-pill">
                          {m.is_bye ? "BYE · Pasa directo" : isFinished ? `Finalizado · ${courtName}` : isStarted ? `En cancha · ${courtName}` : `En cola · ${courtName}${m.queue_orden ? ` #${m.queue_orden}` : ""}`}
                        </span>
                      )}
                    </div>

                    {m.is_bye && (
                      <div className="eliminatoria-bye-players">
                        <p className={`eliminatoria-player-label ${
                          p1IsBye ? "text-slate-400 italic" :
                          m.winner_id && m.winner_id === m.pair1_id ? "font-bold text-brandGreen" : "text-slate-700"
                        }`}>{p1Label}</p>
                        <p className="eliminatoria-bye-vs">vs</p>
                        <p className={`eliminatoria-player-label ${
                          p2IsBye ? "text-slate-400 italic" :
                          m.winner_id && m.winner_id === m.pair2_id ? "font-bold text-brandGreen" : "text-slate-700"
                        }`}>{p2Label}</p>
                      </div>
                    )}

                    {!m.is_bye && (
                      <>
                        <div className="eliminatoria-score-table">
                          <div className="eliminatoria-score-head">
                            <span className="eliminatoria-score-head-player">Pareja</span>
                            {scoreColumns.map((column) => (
                              <span key={`${m.id}-${column.key}-head`} className="eliminatoria-score-head-set">{column.label}</span>
                            ))}
                          </div>

                          <div className="eliminatoria-score-row">
                            <p className={`eliminatoria-player-label ${
                              p1IsBye ? "text-slate-400 italic" :
                              m.winner_id && m.winner_id === m.pair1_id ? "font-bold text-brandGreen" : "text-slate-700"
                            }`}>{p1Label}</p>
                            {scoreColumns.map((column) => {
                              const isEditableField = canEdit && (column.key !== "set2" || canEditSet2);
                              const rawValue = canEdit ? form[column.pair1Key] : (m[column.pair1Key] ?? "-");
                              const hasValue = m[column.pair1Key] != null;

                              return isEditableField ? (
                                <input
                                  key={`${m.id}-${column.key}-p1`}
                                  ref={registerScoreInput(m.id, column.pair1Key)}
                                  type="text"
                                  inputMode="numeric"
                                  maxLength={1}
                                  className="eliminatoria-score-input"
                                  value={rawValue}
                                  onChange={(e) => updateDigitField(m.id, column.pair1Key, e.target.value)}
                                />
                              ) : (
                                <span key={`${m.id}-${column.key}-p1`} className={`eliminatoria-score-box ${scoreBoxClass(hasValue, false)}`}>{rawValue}</span>
                              );
                            })}
                          </div>

                          <div className="eliminatoria-score-row">
                            <p className={`eliminatoria-player-label ${
                              p2IsBye ? "text-slate-400 italic" :
                              m.winner_id && m.winner_id === m.pair2_id ? "font-bold text-brandGreen" : "text-slate-700"
                            }`}>{p2Label}</p>
                            {scoreColumns.map((column) => {
                              const isEditableField = canEdit && (column.key !== "set2" || canEditSet2);
                              const rawValue = canEdit ? form[column.pair2Key] : (m[column.pair2Key] ?? "-");
                              const hasValue = m[column.pair2Key] != null;

                              return isEditableField ? (
                                <input
                                  key={`${m.id}-${column.key}-p2`}
                                  ref={registerScoreInput(m.id, column.pair2Key)}
                                  type="text"
                                  inputMode="numeric"
                                  maxLength={1}
                                  className="eliminatoria-score-input"
                                  value={rawValue}
                                  onChange={(e) => updateDigitField(m.id, column.pair2Key, e.target.value)}
                                />
                              ) : (
                                <span key={`${m.id}-${column.key}-p2`} className={`eliminatoria-score-box ${scoreBoxClass(hasValue, false)}`}>{rawValue}</span>
                              );
                            })}
                          </div>
                        </div>

                        <div className="eliminatoria-actions-row">
                          {canEdit && (
                            <button
                              ref={registerFinalizeButton(m.id)}
                              className="eliminatoria-finish-btn"
                              onClick={() => guardarResultado(m)}
                              disabled={Boolean(savingResultByMatch[m.id])}
                            >
                              {savingResultByMatch[m.id] ? "Guardando..." : "Finalizar"}
                            </button>
                          )}
                          {canEdit && m.pair1_id && m.pair2_id && (
                            <>
                              <button className="eliminatoria-wo-btn" onClick={() => marcarWO(m.id, m.pair1_id)}>
                                W.O. P1
                              </button>
                              <button className="eliminatoria-wo-btn" onClick={() => marcarWO(m.id, m.pair2_id)}>
                                W.O. P2
                              </button>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Operacion de partidos integrada dentro del cuadro */}

      {user?.role === "superadmin" && (
        <section className="card p-5">
          <h2 className="font-bold text-lg">🔧 SuperAdmin — Edición de partidos</h2>
          <p className="mt-1 mb-4 text-sm text-slate-500">
            Corregir resultados o cambiar parejas en cualquier partido del cuadro.
          </p>
          {eliminatoriaMatches.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Aun no hay partidos de eliminatoria para editar. Genera el cuadro y vuelve a esta pantalla.
            </div>
          )}
          <div className="space-y-2">
            {eliminatoriaMatches.map((m) => {
              const p1Label = m.pair1_id
                ? (pairNameMap.get(m.pair1_id) || `Pareja #${m.pair1_id}`)
                : "Por definir";
              const p2Label = m.pair2_id
                ? (pairNameMap.get(m.pair2_id) || `Pareja #${m.pair2_id}`)
                : "Por definir";
              const isOpen = saOpenMatchId === m.id;
              const inputSm =
                "w-16 rounded border border-slate-300 px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-brandViolet/40";
              const selectPair =
                "rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brandViolet/40";

              return (
                <div key={m.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm">
                      <span className="font-semibold text-slate-700">
                        {roundTitle(m.round || "r1")} · Partido #{m.id}
                      </span>
                      <span className="ml-3 text-slate-500">{p1Label}</span>
                      <span className="mx-1 text-slate-400">vs</span>
                      <span className="text-slate-500">{p2Label}</span>
                      {m.winner_id && (
                        <span className="ml-3 text-xs text-emerald-600 font-medium">
                          ✓ Ganador: {pairNameMap.get(m.winner_id) || `#${m.winner_id}`}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        className={`rounded-lg border px-3 py-1 text-xs font-medium ${
                          isOpen && saMode === "resultado"
                            ? "border-brandViolet bg-brandViolet text-white"
                            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                        onClick={() =>
                          isOpen && saMode === "resultado"
                            ? closeSaPanel()
                            : openSaPanel(m.id, "resultado", m)
                        }
                      >
                        Resultado
                      </button>
                      <button
                        className={`rounded-lg border px-3 py-1 text-xs font-medium ${
                          isOpen && saMode === "parejas"
                            ? "border-brandViolet bg-brandViolet text-white"
                            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                        onClick={() =>
                          isOpen && saMode === "parejas"
                            ? closeSaPanel()
                            : openSaPanel(m.id, "parejas", m)
                        }
                      >
                        Parejas
                      </button>
                    </div>
                  </div>

                  {isOpen && saMode === "resultado" && (
                    <div className="mt-3 border-t border-slate-100 pt-3">
                      <p className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                        Corregir resultado · Sobrescribe el resultado actual
                      </p>
                      <div className="flex flex-wrap gap-4 items-end">
                        <div>
                          <p className="mb-1 text-xs text-slate-500">Set 1</p>
                          <div className="flex items-center gap-1">
                            <input
                              className={inputSm}
                              type="text"
                              inputMode="numeric"
                              maxLength={1}
                              placeholder="P1"
                              value={saResultForm.set1_pair1}
                              onChange={(e) => setSaResultForm((p) => ({ ...p, set1_pair1: e.target.value.replace(/\D/g, "").slice(0, 1) }))}
                            />
                            <span className="text-slate-400">-</span>
                            <input
                              className={inputSm}
                              type="text"
                              inputMode="numeric"
                              maxLength={1}
                              placeholder="P2"
                              value={saResultForm.set1_pair2}
                              onChange={(e) => setSaResultForm((p) => ({ ...p, set1_pair2: e.target.value.replace(/\D/g, "").slice(0, 1) }))}
                            />
                          </div>
                        </div>
                        {torneo?.match_format !== "one_set" && (
                          <div>
                            <p className="mb-1 text-xs text-slate-500">Set 2</p>
                            <div className="flex items-center gap-1">
                              <input
                                className={inputSm}
                                type="text"
                                inputMode="numeric"
                                maxLength={1}
                                placeholder="P1"
                                value={saResultForm.set2_pair1}
                                onChange={(e) => setSaResultForm((p) => ({ ...p, set2_pair1: e.target.value.replace(/\D/g, "").slice(0, 1) }))}
                              />
                              <span className="text-slate-400">-</span>
                              <input
                                className={inputSm}
                                type="text"
                                inputMode="numeric"
                                maxLength={1}
                                placeholder="P2"
                                value={saResultForm.set2_pair2}
                                onChange={(e) => setSaResultForm((p) => ({ ...p, set2_pair2: e.target.value.replace(/\D/g, "").slice(0, 1) }))}
                              />
                            </div>
                          </div>
                        )}
                        {torneo?.match_format === "best_of_3_super_tb" && (
                          <div>
                            <p className="mb-1 text-xs text-slate-500">Super TB</p>
                            <div className="flex items-center gap-1">
                              <input
                                className={inputSm}
                                type="text"
                                inputMode="numeric"
                                maxLength={2}
                                placeholder="P1"
                                value={saResultForm.supertb_pair1}
                                onChange={(e) => setSaResultForm((p) => ({ ...p, supertb_pair1: e.target.value.replace(/\D/g, "").slice(0, 2) }))}
                              />
                              <span className="text-slate-400">-</span>
                              <input
                                className={inputSm}
                                type="text"
                                inputMode="numeric"
                                maxLength={2}
                                placeholder="P2"
                                value={saResultForm.supertb_pair2}
                                onChange={(e) => setSaResultForm((p) => ({ ...p, supertb_pair2: e.target.value.replace(/\D/g, "").slice(0, 2) }))}
                              />
                            </div>
                          </div>
                        )}
                        <button
                          className="btn-primary py-1.5 px-4 text-sm disabled:opacity-50"
                          disabled={saSaving}
                          onClick={() => saGuardarResultado(m.id)}
                        >
                          {saSaving ? "Guardando..." : "Guardar resultado"}
                        </button>
                        <button className="btn-secondary py-1.5 px-3 text-sm" onClick={closeSaPanel}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  {isOpen && saMode === "parejas" && (
                    <div className="mt-3 border-t border-slate-100 pt-3">
                      <p className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                        Cambiar parejas · Borra resultado y partidos dependientes
                      </p>
                      <div className="flex flex-wrap gap-3 items-end">
                        <div>
                          <label className="mb-1 block text-xs text-slate-500">Pareja 1</label>
                          <select
                            className={selectPair}
                            value={saPairsForm.pair1_id}
                            onChange={(e) => setSaPairsForm((p) => ({ ...p, pair1_id: e.target.value }))}
                          >
                            <option value="">— Por definir —</option>
                            {parejas.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.player1_apellido} / {p.player2_apellido} (#{p.id})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-slate-500">Pareja 2</label>
                          <select
                            className={selectPair}
                            value={saPairsForm.pair2_id}
                            onChange={(e) => setSaPairsForm((p) => ({ ...p, pair2_id: e.target.value }))}
                          >
                            <option value="">— Por definir —</option>
                            {parejas.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.player1_apellido} / {p.player2_apellido} (#{p.id})
                              </option>
                            ))}
                          </select>
                        </div>
                        <button
                          className="btn-primary py-1.5 px-4 text-sm disabled:opacity-50"
                          disabled={saSaving}
                          onClick={() => saGuardarParejas(m.id)}
                        >
                          {saSaving ? "Guardando..." : "Guardar parejas"}
                        </button>
                        <button className="btn-secondary py-1.5 px-3 text-sm" onClick={closeSaPanel}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`rounded-xl border px-4 py-3 text-sm shadow-lg ${toast.type === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}
