import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import api from "../api";
import { useAuthStore } from "../store/authStore";
import { useTournamentStore } from "../store/tournamentStore";

function navClass(isActive, collapsed) {
  return `group flex w-full items-center ${collapsed ? "justify-center" : "justify-start"} gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive
      ? "bg-brandViolet text-white"
      : "text-slate-700 hover:bg-slate-100"
  }`;
}

function SidebarIcon({ children }) {
  return <span className="inline-flex h-5 w-5 items-center justify-center">{children}</span>;
}

export default function AppShell() {
  const { user, login, logout } = useAuthStore();
  const setActiveTournamentId = useTournamentStore((s) => s.setActiveTournamentId);

  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [appModeLabel, setAppModeLabel] = useState(null);
  const [appVersion, setAppVersion] = useState(null);
  const [installationMode, setInstallationMode] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();

  const [showCP, setShowCP] = useState(false);
  const [cpForm, setCpForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [cpSaving, setCpSaving] = useState(false);
  const [cpMsg, setCpMsg] = useState(null); // { type: 'success'|'error', text }
  const cpMsgTimer = useRef(null);

  useEffect(() => {
    const match = location.pathname.match(/^\/torneos\/(\d+)(?:\/|$)/);
    if (match?.[1]) {
      setActiveTournamentId(match[1]);
    }
  }, [location.pathname, setActiveTournamentId]);

  useEffect(() => {
    let ignore = false;

    async function loadAppConfig() {
      try {
        const { data } = await api.get("/public/app-config");
        if (!ignore) {
          setAppModeLabel(data?.modeLabel || null);
          setAppVersion(data?.version || null);
          setInstallationMode(data?.installationMode || null);
        }
      } catch {
        if (!ignore) {
          setAppModeLabel(null);
          setInstallationMode(null);
        }
      }
    }

    loadAppConfig();

    return () => {
      ignore = true;
    };
  }, []);

  const onLogout = () => {
    logout();
    navigate("/login");
  };

  const openCP = () => {
    setCpForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    setCpMsg(null);
    setShowCP(true);
  };

  const submitCP = async (e) => {
    e.preventDefault();
    if (cpForm.newPassword !== cpForm.confirmPassword) {
      setCpMsg({ type: "error", text: "Las contraseñas nuevas no coinciden" });
      return;
    }
    setCpSaving(true);
    setCpMsg(null);
    try {
      const { data } = await api.post("/auth/change-password", {
        currentPassword: cpForm.currentPassword,
        newPassword: cpForm.newPassword,
      });
      login({ token: data.token, user });
      setCpMsg({ type: "success", text: "Contraseña actualizada" });
      setCpForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      clearTimeout(cpMsgTimer.current);
      cpMsgTimer.current = window.setTimeout(() => {
        setShowCP(false);
        setCpMsg(null);
      }, 1800);
    } catch (err) {
      setCpMsg({ type: "error", text: err.response?.data?.error || "No se pudo cambiar la contraseña" });
    } finally {
      setCpSaving(false);
    }
  };

  const desktopSidebarWidth = sidebarCollapsed ? "lg:w-20" : "lg:w-80";
  const desktopContentOffset = sidebarCollapsed ? "lg:ml-20" : "lg:ml-80";

  return (
    <div className="h-screen overflow-hidden bg-slate-50">
      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Cerrar menu"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-80 ${desktopSidebarWidth} border-r border-slate-200 bg-white shadow-card transition-all duration-300 ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="flex h-full flex-col">
          <div className="border-b border-slate-100 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className={`flex items-center gap-3 ${sidebarCollapsed ? "lg:justify-center lg:w-full" : ""}`}>
                <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-brandGreen to-brandViolet" />
                {!sidebarCollapsed && (
                  <div>
                    <p className="font-bold leading-none">Tournament Tracker</p>
                    <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-brandViolet">
                      {appModeLabel || "Loading Mode"}
                    </p>
                    <p className="text-xs text-slate-500">Simple Line Solutions{appVersion ? ` · v${appVersion}` : ""}</p>
                  </div>
                )}
              </div>

              <button
                type="button"
                className="hidden lg:inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                onClick={() => setSidebarCollapsed((value) => !value)}
                title={sidebarCollapsed ? "Expandir menu" : "Colapsar menu"}
              >
                <SidebarIcon>{sidebarCollapsed ? "›" : "‹"}</SidebarIcon>
              </button>
            </div>

            {!sidebarCollapsed && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Usuario</p>
                <p className="mt-1 font-semibold text-slate-800">{user?.nombre || "Sin usuario"}</p>
                <p className="text-xs text-slate-500 capitalize">{user?.role || ""}</p>

                {!showCP && (
                  <button
                    type="button"
                    className="mt-2 text-xs text-brandViolet underline underline-offset-2 hover:text-brandViolet/70"
                    onClick={openCP}
                  >
                    🔑 Cambiar contraseña
                  </button>
                )}

                {showCP && (
                  <form onSubmit={submitCP} className="mt-3 space-y-2">
                    <input
                      type="password"
                      placeholder="Contraseña actual"
                      autoComplete="current-password"
                      required
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brandViolet/40"
                      value={cpForm.currentPassword}
                      onChange={(e) => setCpForm((p) => ({ ...p, currentPassword: e.target.value }))}
                    />
                    <input
                      type="password"
                      placeholder="Nueva contraseña (mín. 6)"
                      autoComplete="new-password"
                      required
                      minLength={6}
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brandViolet/40"
                      value={cpForm.newPassword}
                      onChange={(e) => setCpForm((p) => ({ ...p, newPassword: e.target.value }))}
                    />
                    <input
                      type="password"
                      placeholder="Confirmar nueva contraseña"
                      autoComplete="new-password"
                      required
                      minLength={6}
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brandViolet/40"
                      value={cpForm.confirmPassword}
                      onChange={(e) => setCpForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                    />
                    {cpMsg && (
                      <p className={`text-xs font-medium ${cpMsg.type === "error" ? "text-red-600" : "text-emerald-600"}`}>
                        {cpMsg.text}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={cpSaving}
                        className="flex-1 rounded-lg bg-brandViolet px-2 py-1.5 text-xs font-semibold text-white hover:bg-brandViolet/90 disabled:opacity-50"
                      >
                        {cpSaving ? "Guardando..." : "Guardar"}
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
                        onClick={() => setShowCP(false)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {sidebarCollapsed && (
              <div className="mt-3 flex justify-center">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-700"
                  title={user?.nombre || "Usuario"}
                >
                  {(user?.nombre || "U").slice(0, 1).toUpperCase()}
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            <nav className="space-y-1.5">
              <NavLink
                className={({ isActive }) => navClass(isActive, sidebarCollapsed)}
                to="/torneos"
                onClick={() => setMobileOpen(false)}
                title="Torneos"
              >
                <SidebarIcon>🏆</SidebarIcon>
                {!sidebarCollapsed && <span>Torneos</span>}
              </NavLink>

              {installationMode === "circuit" && (
                <NavLink
                  className={({ isActive }) => navClass(isActive, sidebarCollapsed)}
                  to="/jugadores"
                  onClick={() => setMobileOpen(false)}
                  title="Jugadores"
                >
                  <SidebarIcon>🎾</SidebarIcon>
                  {!sidebarCollapsed && <span>Jugadores</span>}
                </NavLink>
              )}

              {(user?.role === "admin" || user?.role === "superadmin") && (
                <>
                  <NavLink
                    className={({ isActive }) => navClass(isActive, sidebarCollapsed)}
                    to="/configuracion"
                    end
                    onClick={() => setMobileOpen(false)}
                    title="Config Global"
                  >
                    <SidebarIcon>⚙️</SidebarIcon>
                    {!sidebarCollapsed && <span>Config Global</span>}
                  </NavLink>
                  <NavLink
                    className={({ isActive }) => navClass(isActive, sidebarCollapsed)}
                    to="/configuracion/torneo"
                    onClick={() => setMobileOpen(false)}
                    title="Config Torneo"
                  >
                    <SidebarIcon>🧩</SidebarIcon>
                    {!sidebarCollapsed && <span>Config Torneo</span>}
                  </NavLink>
                </>
              )}

              {user?.role === "superadmin" && (
                <>
                  {!sidebarCollapsed && (
                    <p className="mt-3 mb-1 px-3 text-[10px] uppercase tracking-widest text-slate-400">
                      SuperAdmin
                    </p>
                  )}
                  {sidebarCollapsed && <div className="my-2 border-t border-slate-100" />}
                  <NavLink
                    className={({ isActive }) => navClass(isActive, sidebarCollapsed)}
                    to="/superadmin/usuarios"
                    onClick={() => setMobileOpen(false)}
                    title="SA: Usuarios"
                  >
                    <SidebarIcon>👥</SidebarIcon>
                    {!sidebarCollapsed && <span>Usuarios</span>}
                  </NavLink>
                  <NavLink
                    className={({ isActive }) => navClass(isActive, sidebarCollapsed)}
                    to="/superadmin/jugadores"
                    onClick={() => setMobileOpen(false)}
                    title="SA: Jugadores"
                  >
                    <SidebarIcon>🎾</SidebarIcon>
                    {!sidebarCollapsed && <span>Jugadores</span>}
                  </NavLink>
                  <NavLink
                    className={({ isActive }) => navClass(isActive, sidebarCollapsed)}
                    to="/superadmin/torneos"
                    onClick={() => setMobileOpen(false)}
                    title="SA: Torneos"
                  >
                    <SidebarIcon>🛠️</SidebarIcon>
                    {!sidebarCollapsed && <span>Torneos (SA)</span>}
                  </NavLink>
                  <NavLink
                    className={({ isActive }) => navClass(isActive, sidebarCollapsed)}
                    to="/superadmin/auditoria"
                    onClick={() => setMobileOpen(false)}
                    title="SA: Auditoría"
                  >
                    <SidebarIcon>📋</SidebarIcon>
                    {!sidebarCollapsed && <span>Auditoría</span>}
                  </NavLink>
                </>
              )}
            </nav>
          </div>

          <div className="border-t border-slate-100 p-3">
            <button
              className={`btn-secondary w-full ${sidebarCollapsed ? "lg:px-0" : ""}`}
              onClick={onLogout}
              title="Salir"
            >
              <span className={`inline-flex items-center ${sidebarCollapsed ? "w-full justify-center" : "gap-2"}`}>
                <span>↩️</span>
                {!sidebarCollapsed && <span>Salir</span>}
              </span>
            </button>
          </div>
        </div>
      </aside>

      <div className={`h-screen ${desktopContentOffset} transition-[margin] duration-300`}>
        <main className="h-full overflow-y-auto px-4 py-6">
          <div className="mb-4 lg:hidden">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700"
              onClick={() => setMobileOpen((value) => !value)}
            >
              <span>☰</span>
              <span>Menu</span>
            </button>
          </div>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
