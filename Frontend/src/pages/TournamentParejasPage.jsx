import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api";
import { useTournamentStore } from "../store/tournamentStore";
import styles from "./TournamentParejasPage.module.css";

export default function TournamentParejasPage() {
  const { id } = useParams();
  const tournamentVersion = useTournamentStore((s) => s.tournamentVersion);
  const [torneo, setTorneo] = useState(null);
  const [parejas, setParejas] = useState([]);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [pairLimits, setPairLimits] = useState({ min: 6, max: 24 });
  const [mediosPago, setMediosPago] = useState([]);
  const [pagos, setPagos] = useState([]);
  const [editingPairId, setEditingPairId] = useState(null);
  const [editPairForm, setEditPairForm] = useState(null);
  const [paymentModal, setPaymentModal] = useState({
    open: false,
    pair: null,
    estadoObjetivo: "pendiente",
    rows: [{ player_num: 1, payment_method_id: "", monto: "" }],
  });
  const nombreJ1Ref = useRef(null);
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  const [nuevoPar, setNuevoPar] = useState({
    player1: { nombre: "", apellido: "", telefono: "+54" },
    player2: { nombre: "", apellido: "", telefono: "+54" },
  });

  const paymentKey = (pairId, playerNum) => `${pairId}-${playerNum}`;

  const load = async () => {
    const [t, p, mp, pg] = await Promise.all([
      api.get(`/torneos/${id}`),
      api.get(`/torneos/${id}/parejas`),
      api.get(`/torneos/${id}/medios-pago?enabledOnly=1`),
      api.get(`/torneos/${id}/pagos`),
    ]);
    const options = await api.get("/torneos/opciones-creacion");
    setTorneo(t.data);
    setParejas(p.data || []);
    setMediosPago(mp.data || []);
    setPagos(pg.data || []);
    setPairLimits({
      min: Number(options.data?.min_pairs || 6),
      max: Number(options.data?.max_pairs || 24),
    });
  };

  useEffect(() => {
    load().catch(() => setError("No se pudo cargar la pantalla de parejas"));
  }, [id, tournamentVersion]);

  const pushToast = useCallback((type, message) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, type, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  useEffect(() => {
    if (!error) return;
    pushToast("error", error);
    setError("");
  }, [error, pushToast]);

  useEffect(() => {
    if (!info) return;
    pushToast("success", info);
    setInfo("");
  }, [info, pushToast]);

  const addPair = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    if (parejas.length >= pairLimits.max) {
      setError(`Ya llegaste al maximo permitido de ${pairLimits.max} parejas`);
      return;
    }
    try {
      await api.post(`/torneos/${id}/parejas`, nuevoPar);
      setNuevoPar({
        player1: { nombre: "", apellido: "", telefono: "+54" },
        player2: { nombre: "", apellido: "", telefono: "+54" },
      });
      setInfo("Pareja agregada correctamente");
      await load();
      requestAnimationFrame(() => {
        nombreJ1Ref.current?.focus();
      });
    } catch (err) {
      setError(err.response?.data?.error || "No se pudo crear la pareja");
    }
  };

  const startEditPair = (pair) => {
    setEditingPairId(pair.id);
    setEditPairForm({
      player1: {
        nombre: pair.player1_nombre,
        apellido: pair.player1_apellido,
        telefono: pair.player1_telefono,
      },
      player2: {
        nombre: pair.player2_nombre,
        apellido: pair.player2_apellido,
        telefono: pair.player2_telefono,
      },
    });
  };

  const saveEditPair = async (pairId) => {
    try {
      await api.put(`/torneos/${id}/parejas/${pairId}`, editPairForm);
      setEditingPairId(null);
      setEditPairForm(null);
      setInfo("Pareja editada correctamente");
      await load();
    } catch (err) {
      setError(err.response?.data?.error || "No se pudo editar la pareja");
    }
  };

  const deletePair = async (pairId) => {
    try {
      await api.delete(`/torneos/${id}/parejas/${pairId}`);
      setInfo("Pareja eliminada correctamente");
      await load();
    } catch (err) {
      setError(err.response?.data?.error || "No se pudo eliminar la pareja");
    }
  };

  const setPresencia = async (pairId, present) => {
    setError("");
    setInfo("");
    try {
      await api.put(`/torneos/${id}/parejas/${pairId}/${present ? "presente" : "ausente"}`);
      setInfo("Estado de presencia actualizado");
      await load();
    } catch (err) {
      setError(err.response?.data?.error || "No se pudo actualizar presencia");
    }
  };

  const openPaymentModal = (pair) => {
    setPaymentModal({
      open: true,
      pair,
      estadoObjetivo: "pendiente",
      rows: [],
    });
  };

  const closePaymentModal = () => {
    setPaymentModal({
      open: false,
      pair: null,
      estadoObjetivo: "pendiente",
      rows: [],
    });
  };

  const paymentStateByPair = useMemo(() => {
    const map = new Map();
    pagos.forEach((row) => {
      if (!map.has(row.pair_id)) {
        map.set(row.pair_id, { 1: "sin_pago", 2: "sin_pago" });
      }
      map.get(row.pair_id)[row.player_num] = row.estado;
    });
    return map;
  }, [pagos]);

  const paymentMethodNameById = useMemo(() => {
    const map = new Map();
    mediosPago.forEach((m) => map.set(Number(m.id), m.nombre));
    return map;
  }, [mediosPago]);

  const paymentTxByPairPlayer = useMemo(() => {
    const map = new Map();
    pagos.forEach((row) => {
      const key = paymentKey(row.pair_id, row.player_num);
      if (!map.has(key)) map.set(key, []);
      if (row.tx_id) {
        map.get(key).push({
          id: row.tx_id,
          payment_method_id: row.payment_method_id,
          monto: Number(row.monto || 0),
          created_at: row.tx_created_at,
        });
      }
    });
    return map;
  }, [pagos]);

  const pairPaymentTotals = useMemo(() => {
    const totals = new Map();
    pagos.forEach((row) => {
      if (!totals.has(row.pair_id)) totals.set(row.pair_id, { 1: 0, 2: 0, total: 0 });
      if (row.tx_id) {
        const amount = Number(row.monto || 0);
        const bucket = totals.get(row.pair_id);
        bucket[row.player_num] += amount;
        bucket.total += amount;
      }
    });
    return totals;
  }, [pagos]);

  const addPaymentRow = () => {
    setPaymentModal((s) => ({
      ...s,
      rows: [...s.rows, { player_num: 1, payment_method_id: "", monto: "" }],
    }));
  };

  const removePaymentRow = (idx) => {
    setPaymentModal((s) => ({
      ...s,
      rows: s.rows.filter((_, i) => i !== idx),
    }));
  };

  const updatePaymentRow = (idx, key, value) => {
    setPaymentModal((s) => ({
      ...s,
      rows: s.rows.map((row, i) => (i === idx ? { ...row, [key]: value } : row)),
    }));
  };

  const savePayments = async () => {
    if (!paymentModal.pair) return;
    if (paymentModal.rows.length > 0 && !mediosPago.length) {
      setError("No hay medios de pago disponibles. Crea al menos uno para registrar pagos.");
      return;
    }

    const rowsConContenido = paymentModal.rows.filter(
      (row) => row.payment_method_id || row.monto !== ""
    );
    const invalid = rowsConContenido.some(
      (row) => !row.player_num || !row.payment_method_id || row.monto === "" || Number(row.monto) <= 0
    );
    if (invalid) {
      setError("Completa jugador, medio de pago y monto en todas las transacciones");
      return;
    }

    setError("");
    setInfo("");
    try {
      const touchedPlayers = new Set();
      for (const row of rowsConContenido) {
        const playerNum = Number(row.player_num);
        await api.post(`/torneos/${id}/pagos/${paymentModal.pair.id}/jugador/${Number(row.player_num)}/transaccion`, {
          payment_method_id: Number(row.payment_method_id),
          monto: Number(row.monto),
        });
        touchedPlayers.add(playerNum);
      }

      if (paymentModal.estadoObjetivo === "saldado") {
        await Promise.all(
          [1, 2].map((playerNum) =>
            api.put(`/torneos/${id}/pagos/${paymentModal.pair.id}/jugador/${playerNum}/estado`, {
              estado: "pagado",
            })
          )
        );
      } else if (touchedPlayers.size > 0) {
        await Promise.all(
          [...touchedPlayers].map((playerNum) =>
            api.put(`/torneos/${id}/pagos/${paymentModal.pair.id}/jugador/${playerNum}/estado`, {
              estado: "parcial",
            })
          )
        );
      }

      setInfo("Pagos registrados correctamente");
      closePaymentModal();
      await load();
    } catch (err) {
      setError(err.response?.data?.error || "No se pudieron registrar los pagos");
    }
  };

  if (!torneo) return <p>Cargando...</p>;

  const targetPairs = torneo.zonas_generadas ? torneo.planned_pairs : pairLimits.max;
  const canAddPairs = !torneo.zonas_generadas && parejas.length < pairLimits.max;

  return (
    <div className={styles.page}>
      <section className={`${styles.block} card p-5`}>
        <div className={styles.sectionTitleRow}>
          <h2 className="font-bold text-lg">Cargar pareja</h2>
          <span className={styles.counterBadge}>Parejas {parejas.length}/{targetPairs}</span>
        </div>
        <p className="text-sm text-slate-500 mb-3">
          Minimo para iniciar: {pairLimits.min} · Maximo permitido: {pairLimits.max}
        </p>
        <form className={styles.form} onSubmit={addPair}>
          <div>
            <p className={styles.formRowTitle}>Jugador 1</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input
                ref={nombreJ1Ref}
                className="input"
                placeholder="Nombre J1"
                value={nuevoPar.player1.nombre}
                onChange={(e) => setNuevoPar((s) => ({ ...s, player1: { ...s.player1, nombre: e.target.value } }))}
              />
              <input
                className="input"
                placeholder="Apellido J1"
                value={nuevoPar.player1.apellido}
                onChange={(e) => setNuevoPar((s) => ({ ...s, player1: { ...s.player1, apellido: e.target.value } }))}
              />
              <input
                className="input"
                placeholder="Telefono J1 (+54...)"
                value={nuevoPar.player1.telefono}
                onChange={(e) => setNuevoPar((s) => ({ ...s, player1: { ...s.player1, telefono: e.target.value } }))}
              />
            </div>
          </div>

          <div>
            <p className={styles.formRowTitle}>Jugador 2</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input
                className="input"
                placeholder="Nombre J2"
                value={nuevoPar.player2.nombre}
                onChange={(e) => setNuevoPar((s) => ({ ...s, player2: { ...s.player2, nombre: e.target.value } }))}
              />
              <input
                className="input"
                placeholder="Apellido J2"
                value={nuevoPar.player2.apellido}
                onChange={(e) => setNuevoPar((s) => ({ ...s, player2: { ...s.player2, apellido: e.target.value } }))}
              />
              <input
                className="input"
                placeholder="Telefono J2 (+54...)"
                value={nuevoPar.player2.telefono}
                onChange={(e) => setNuevoPar((s) => ({ ...s, player2: { ...s.player2, telefono: e.target.value } }))}
              />
            </div>
          </div>

          <button className="btn-primary" disabled={!canAddPairs}>Agregar pareja</button>
        </form>
      </section>

      <section className={`${styles.block} card p-5`}>
        <h2 className="font-bold text-lg">Lista de parejas</h2>
        <div className={styles.listViewport}>
          <div className={styles.listGrid}>
            {parejas.map((p) => {
              const pairPaymentState = paymentStateByPair.get(p.id) || { 1: "sin_pago", 2: "sin_pago" };
              const isPaid = pairPaymentState[1] === "pagado" && pairPaymentState[2] === "pagado";
              const totals = pairPaymentTotals.get(p.id) || { 1: 0, 2: 0, total: 0 };
              const txCount =
                (paymentTxByPairPlayer.get(paymentKey(p.id, 1)) || []).length +
                (paymentTxByPairPlayer.get(paymentKey(p.id, 2)) || []).length;
              const hoverToneClass = isPaid
                ? styles.pairCardPaid
                : totals.total > 0 || pairPaymentState[1] !== "sin_pago" || pairPaymentState[2] !== "sin_pago"
                  ? styles.pairCardPartial
                  : styles.pairCardPending;
              return (
              <div key={p.id} className={`${styles.pairCard} ${hoverToneClass}`}>
                <div className={styles.cardTopRow}>
                  <div>
                    <p className="font-semibold">{p.player1_nombre} {p.player1_apellido} / {p.player2_nombre} {p.player2_apellido}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
                      <span className={`px-2 py-1 rounded-full border ${isPaid ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"}`}>
                        {isPaid ? "Pago Saldado" : "Pago Pendiente"}
                      </span>
                      <label className="inline-flex items-center gap-2 text-slate-700">
                        <span className="font-medium">{p.presente ? "Presente" : "Ausente"}</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={Boolean(p.presente)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${p.presente ? "bg-emerald-500" : "bg-slate-300"}`}
                          onClick={() => setPresencia(p.id, !p.presente)}
                        >
                          <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${p.presente ? "translate-x-5" : "translate-x-1"}`} />
                        </button>
                      </label>
                    </div>
                  </div>

                  <button className={styles.payButton} onClick={() => openPaymentModal(p)}>
                    Registrar pago
                  </button>
                </div>

                <div className={styles.paymentSummary}>
                  <p className="font-medium text-slate-800">Resumen de pagos</p>
                  <p className="mt-1">Total pagado: <span className="font-semibold">${totals.total.toFixed(2)}</span></p>
                  <p className="text-slate-600">Jugador 1: ${totals[1].toFixed(2)} · Jugador 2: ${totals[2].toFixed(2)}</p>
                  <p className="text-slate-500">Transacciones registradas: {txCount}</p>
                </div>

                <div className="flex flex-wrap gap-3 mt-2 text-xs">
                  <a className="text-brandGreen" href={`https://wa.me/${p.player1_telefono.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">WhatsApp {p.player1_nombre} {p.player1_apellido}</a>
                  <a className="text-brandViolet" href={`https://wa.me/${p.player2_telefono.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">WhatsApp {p.player2_nombre} {p.player2_apellido}</a>
                </div>

                {!torneo.zonas_generadas && (
                  <div className="flex gap-2 mt-2">
                    <button className="px-3 py-2 rounded-lg bg-slate-200" onClick={() => startEditPair(p)}>Editar</button>
                    <button className="px-3 py-2 rounded-lg bg-red-100" onClick={() => deletePair(p.id)}>Eliminar</button>
                  </div>
                )}

                {editingPairId === p.id && editPairForm && (
                  <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3">
                    <input className="input" value={editPairForm.player1.nombre} onChange={(e) => setEditPairForm((s) => ({ ...s, player1: { ...s.player1, nombre: e.target.value } }))} />
                    <input className="input" value={editPairForm.player1.apellido} onChange={(e) => setEditPairForm((s) => ({ ...s, player1: { ...s.player1, apellido: e.target.value } }))} />
                    <input className="input col-span-2" value={editPairForm.player1.telefono} onChange={(e) => setEditPairForm((s) => ({ ...s, player1: { ...s.player1, telefono: e.target.value } }))} />
                    <input className="input" value={editPairForm.player2.nombre} onChange={(e) => setEditPairForm((s) => ({ ...s, player2: { ...s.player2, nombre: e.target.value } }))} />
                    <input className="input" value={editPairForm.player2.apellido} onChange={(e) => setEditPairForm((s) => ({ ...s, player2: { ...s.player2, apellido: e.target.value } }))} />
                    <input className="input col-span-2" value={editPairForm.player2.telefono} onChange={(e) => setEditPairForm((s) => ({ ...s, player2: { ...s.player2, telefono: e.target.value } }))} />

                    <div className="col-span-2 flex gap-2">
                      <button className="btn-primary" onClick={() => saveEditPair(p.id)}>Guardar cambios</button>
                      <button className="px-3 py-2 rounded-lg bg-slate-200" onClick={() => { setEditingPairId(null); setEditPairForm(null); }}>Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            );})}

            {!parejas.length && <p className="text-sm text-slate-500">Todavia no hay parejas cargadas.</p>}
          </div>
        </div>
      </section>

      {paymentModal.open && paymentModal.pair && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalCard}>
            <div className={styles.modalHeader}>
              <div>
                <h3 className="font-bold text-lg">Registrar pago</h3>
                <p className="text-sm text-slate-600">
                  {paymentModal.pair.player1_nombre} {paymentModal.pair.player1_apellido} / {paymentModal.pair.player2_nombre} {paymentModal.pair.player2_apellido}
                </p>
              </div>
              <button type="button" className={styles.closeButton} onClick={closePaymentModal}>Cerrar</button>
            </div>

            <div className={styles.modalBody}>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">Pagos ya cargados</p>
                {[1, 2].map((playerNum) => {
                  const txs = paymentTxByPairPlayer.get(paymentKey(paymentModal.pair.id, playerNum)) || [];
                  const subtotal = txs.reduce((acc, tx) => acc + Number(tx.monto || 0), 0);
                  const playerName = playerNum === 1
                    ? `${paymentModal.pair.player1_nombre} ${paymentModal.pair.player1_apellido}`
                    : `${paymentModal.pair.player2_nombre} ${paymentModal.pair.player2_apellido}`;
                  return (
                    <div key={`existing-${playerNum}`} className="mb-2 last:mb-0">
                      <p className="text-sm font-medium text-slate-700">{playerName} · Subtotal ${subtotal.toFixed(2)}</p>
                      {txs.length ? (
                        <div className="mt-1 space-y-1">
                          {txs.map((tx) => (
                            <div key={tx.id} className="text-xs text-slate-600 flex justify-between gap-2 rounded border border-slate-200 bg-white px-2 py-1">
                              <span>
                                #{tx.id} · {paymentMethodNameById.get(Number(tx.payment_method_id)) || "Medio"}
                                {tx.created_at ? ` · ${String(tx.created_at).slice(0, 16).replace("T", " ")}` : ""}
                              </span>
                              <span className="font-medium">${Number(tx.monto || 0).toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 mt-1">Sin transacciones registradas.</p>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <label className="text-sm text-slate-700">
                  Estado luego del registro
                  <select
                    className="input mt-1"
                    value={paymentModal.estadoObjetivo}
                    onChange={(e) => setPaymentModal((s) => ({ ...s, estadoObjetivo: e.target.value }))}
                  >
                    <option value="pendiente">Pago Pendiente</option>
                    <option value="saldado">Pago Saldado</option>
                  </select>
                </label>
                <div className="text-xs text-slate-500 self-end pb-1">
                  El estado cambia a saldado solo si lo seleccionas aqui.
                </div>
              </div>

              {paymentModal.rows.map((row, idx) => (
                <div key={`tx-${idx}`} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-center rounded-lg border border-slate-200 p-3 bg-slate-50">
                  <select className="input" value={row.player_num} onChange={(e) => updatePaymentRow(idx, "player_num", e.target.value)}>
                    <option value={1}>{paymentModal.pair.player1_nombre} {paymentModal.pair.player1_apellido}</option>
                    <option value={2}>{paymentModal.pair.player2_nombre} {paymentModal.pair.player2_apellido}</option>
                  </select>

                  <select className="input md:col-span-2" value={row.payment_method_id} onChange={(e) => updatePaymentRow(idx, "payment_method_id", e.target.value)}>
                    <option value="">Medio de pago</option>
                    {mediosPago.map((m) => (
                      <option key={m.id} value={m.id}>{m.nombre}</option>
                    ))}
                  </select>

                  <div className="flex gap-2">
                    <input className="input" type="number" placeholder="Monto" value={row.monto} onChange={(e) => updatePaymentRow(idx, "monto", e.target.value)} />
                    {paymentModal.rows.length > 1 && (
                      <button type="button" className="px-2 py-1 rounded bg-red-100 text-red-700" onClick={() => removePaymentRow(idx)}>-</button>
                    )}
                  </div>
                </div>
              ))}

              <button type="button" className="px-3 py-2 rounded-lg bg-brandViolet text-white" onClick={addPaymentRow}>+ Agregar transaccion</button>
            </div>

            <div className={styles.modalFooter}>
              <button type="button" className="px-3 py-2 rounded-lg bg-slate-200" onClick={closePaymentModal}>Cancelar</button>
              <button type="button" className="btn-primary" onClick={savePayments}>Guardar pagos</button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.toastStack}>
        {toasts.map((t) => (
          <div key={t.id} className={`${styles.toast} ${t.type === "error" ? styles.toastError : styles.toastSuccess}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
