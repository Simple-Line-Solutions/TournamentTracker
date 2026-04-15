import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api";

export default function TournamentPresentismoPagosPage() {
  const { id } = useParams();
  const [torneo, setTorneo] = useState(null);
  const [parejas, setParejas] = useState([]);
  const [pagos, setPagos] = useState([]);
  const [mediosPago, setMediosPago] = useState([]);
  const [paymentForms, setPaymentForms] = useState({});
  const [estadoSelects, setEstadoSelects] = useState({});
  const [txEdit, setTxEdit] = useState({});
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const load = async () => {
    const [t, p, pg, mp] = await Promise.all([
      api.get(`/torneos/${id}`),
      api.get(`/torneos/${id}/parejas`),
      api.get(`/torneos/${id}/pagos`),
      api.get("/medios-pago"),
    ]);
    setTorneo(t.data);
    setParejas(p.data || []);
    setPagos(pg.data || []);
    setMediosPago(mp.data || []);
  };

  useEffect(() => {
    load().catch(() => setError("No se pudo cargar presentismo y pagos"));
  }, [id]);

  const paymentKey = (pairId, playerNum) => `${pairId}-${playerNum}`;

  const paymentsByPairPlayer = useMemo(() => {
    const map = new Map();
    pagos.forEach((row) => {
      const key = paymentKey(row.pair_id, row.player_num);
      if (!map.has(key)) {
        map.set(key, {
          estado: row.estado,
          transacciones: [],
        });
      }
      const item = map.get(key);
      item.estado = row.estado;
      if (row.tx_id) {
        item.transacciones.push({
          id: row.tx_id,
          payment_method_id: row.payment_method_id,
          monto: row.monto,
          created_at: row.tx_created_at,
        });
      }
    });
    return map;
  }, [pagos]);

  const setPresencia = async (pairId, present) => {
    setError("");
    setInfo("");
    try {
      await api.put(`/torneos/${id}/parejas/${pairId}/${present ? "presente" : "ausente"}`);
      setInfo("Estado de presencia actualizado");
      await load();
    } catch (err) {
      setError(err.response?.data?.error || "No se pudo cambiar presencia");
    }
  };

  const addTransaction = async (pairId, playerNum) => {
    const key = paymentKey(pairId, playerNum);
    const form = paymentForms[key] || {};
    if (!form.payment_method_id || form.monto === undefined) return;
    try {
      await api.post(`/torneos/${id}/pagos/${pairId}/jugador/${playerNum}/transaccion`, {
        payment_method_id: Number(form.payment_method_id),
        monto: Number(form.monto),
      });
      setPaymentForms((s) => ({ ...s, [key]: { payment_method_id: form.payment_method_id, monto: "" } }));
      setInfo("Transaccion agregada");
      await load();
    } catch (err) {
      setError(err.response?.data?.error || "No se pudo agregar transaccion");
    }
  };

  const setEstadoPago = async (pairId, playerNum, estado) => {
    try {
      await api.put(`/torneos/${id}/pagos/${pairId}/jugador/${playerNum}/estado`, { estado });
      setInfo("Estado de pago actualizado");
      await load();
    } catch (err) {
      setError(err.response?.data?.error || "No se pudo actualizar estado de pago");
    }
  };

  const updateTransaction = async (txId) => {
    try {
      await api.put(`/torneos/${id}/pagos/transacciones/${txId}`, {
        monto: Number(txEdit[txId] || 0),
      });
      setInfo("Transaccion actualizada");
      await load();
    } catch (err) {
      setError(err.response?.data?.error || "No se pudo editar transaccion");
    }
  };

  const warnings = useMemo(
    () => ({
      pagos: parejas.filter((p) => p.warning_pago).length,
      presencia: parejas.filter((p) => p.presente === null).length,
    }),
    [parejas]
  );

  if (!torneo) return <p>Cargando...</p>;

  return (
    <div className="space-y-5">
      <section className="card p-5 flex flex-wrap items-center gap-2 justify-between">
        <div>
          <h1 className="text-2xl font-bold">{torneo.name}</h1>
          <p className="text-slate-600 mt-1">Presentismo y Pagos</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-sm">Pagos pendientes: {warnings.pagos}</span>
          <span className="px-3 py-1 rounded-full bg-yellow-100 text-yellow-800 text-sm">Sin presencia: {warnings.presencia}</span>
        </div>
      </section>

      {(error || info) && (
        <section className="card p-4">
          {error && <p className="text-red-600">{error}</p>}
          {info && <p className="text-emerald-700">{info}</p>}
        </section>
      )}

      <section className="card p-5">
        <h2 className="font-bold text-lg">Estado por pareja</h2>
        <div className="mt-3 space-y-4">
          {parejas.map((p) => (
            <div key={p.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">{p.player1_nombre} {p.player1_apellido} / {p.player2_nombre} {p.player2_apellido}</p>
                  <p className="text-xs text-slate-500">Presencia: {p.presente === null ? "Sin marcar" : p.presente ? "Presente" : "Ausente"}</p>
                </div>
                <div className="flex gap-2">
                  <button className="btn-primary" onClick={() => setPresencia(p.id, true)}>Presente</button>
                  <button className="btn-secondary" onClick={() => setPresencia(p.id, false)}>Ausente</button>
                </div>
              </div>

              {[1, 2].map((num) => {
                const key = paymentKey(p.id, num);
                const bucket = paymentsByPairPlayer.get(key) || { estado: "sin_pago", transacciones: [] };
                const playerName = num === 1
                  ? `${p.player1_nombre} ${p.player1_apellido}`
                  : `${p.player2_nombre} ${p.player2_apellido}`;
                const estadoActual = estadoSelects[key] ?? bucket.estado;
                return (
                  <div key={key} className="mt-3 rounded-lg bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{playerName} · Estado: {bucket.estado}</p>
                      <div className="flex gap-2 items-center">
                        <select
                          className="input"
                          value={estadoActual}
                          onChange={(e) => setEstadoSelects((s) => ({ ...s, [key]: e.target.value }))}
                        >
                          <option value="sin_pago">Sin pago</option>
                          <option value="parcial">Parcial</option>
                          <option value="pagado">Pagado / Saldado</option>
                        </select>
                        <button
                          className="btn-primary"
                          onClick={() => setEstadoPago(p.id, num, estadoActual)}
                        >
                          Guardar
                        </button>
                      </div>
                    </div>

                    <div className="grid md:grid-cols-3 gap-2 mt-2">
                      <select
                        className="input"
                        value={paymentForms[key]?.payment_method_id || ""}
                        onChange={(e) =>
                          setPaymentForms((s) => ({
                            ...s,
                            [key]: { ...(s[key] || {}), payment_method_id: e.target.value },
                          }))
                        }
                      >
                        <option value="">Medio de pago</option>
                        {mediosPago.map((m) => (
                          <option key={m.id} value={m.id}>{m.nombre}</option>
                        ))}
                      </select>
                      <input
                        className="input"
                        type="number"
                        placeholder="Monto"
                        value={paymentForms[key]?.monto || ""}
                        onChange={(e) =>
                          setPaymentForms((s) => ({
                            ...s,
                            [key]: { ...(s[key] || {}), monto: e.target.value },
                          }))
                        }
                      />
                      <button className="btn-primary" onClick={() => addTransaction(p.id, num)}>
                        Agregar transaccion
                      </button>
                    </div>

                    <div className="mt-2 space-y-1 text-sm">
                      {bucket.transacciones.map((tx) => (
                        <div key={tx.id} className="flex flex-wrap items-center gap-2">
                          <span>Tx #{tx.id}</span>
                          <span>$ {tx.monto}</span>
                          <input
                            className="input max-w-28"
                            type="number"
                            value={txEdit[tx.id] ?? tx.monto}
                            onChange={(e) => setTxEdit((s) => ({ ...s, [tx.id]: e.target.value }))}
                          />
                          <button className="px-2 py-1 rounded bg-slate-200" onClick={() => updateTransaction(tx.id)}>
                            Guardar
                          </button>
                          <button
                            className="px-2 py-1 rounded bg-red-100"
                            onClick={() => {
                              setTxEdit((s) => ({ ...s, [tx.id]: 0 }));
                              setTimeout(() => updateTransaction(tx.id), 0);
                            }}
                          >
                            Poner en 0
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          {!parejas.length && <p className="text-sm text-slate-500">No hay parejas cargadas para gestionar pagos.</p>}
        </div>
      </section>
    </div>
  );
}
