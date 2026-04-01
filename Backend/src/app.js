const express = require("express");
const cors = require("cors");
const { config } = require("./config");
const { requireAuth } = require("./middleware/auth");
const { errorHandler } = require("./middleware/errorHandler");
const { db } = require("./db/connection");

const authRoutes = require("./routes/auth");
const usersRoutes = require("./routes/users");
const paymentMethodsRoutes = require("./routes/paymentMethods");
const globalClubsRoutes = require("./routes/globalClubs");
const globalCourtsRoutes = require("./routes/globalCourts");
const tournamentsRoutes = require("./routes/tournaments");
const matchesRoutes = require("./routes/matches");
const superadminRoutes = require("./routes/superadmin");
const playersRoutes = require("./routes/players");

const app = express();

app.use(cors({
  origin: function(origin, callback) {
    // Permite cualquier localhost + el dominio de producción
    if (!origin || origin.startsWith('http://localhost:') || origin === 'https://torneoslf.simpleline.solutions') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/api/public/app-config", (req, res) => {
	res.json({
		installationMode: config.installationMode,
		circuitEnabled: config.circuitEnabled,
		modeLabel: config.isCircuitMode ? "Circuit Mode" : "Club Mode",
	});
});
app.get("/api/jugadores/debug", async (req, res) => {
	// Debug endpoint - NO auth required
	try {
		const countResult = await db.query("SELECT COUNT(*) as total FROM players");
		const playerCount = parseInt(countResult.rows[0].total);
		
		const columnsResult = await db.query(
			`SELECT column_name FROM information_schema.columns 
			 WHERE table_name = 'players' AND table_schema = 'public'
			 ORDER BY ordinal_position`
		);
		const columnCheck = columnsResult.rows.map(c => c.column_name);
		
		res.json({
			debug: true,
			playerCount,
			columns: columnCheck,
			message: "Debug OK",
			circuitMode: config.isCircuitMode
		});
	} catch (e) {
		res.status(500).json({ error: e.message });
	}
});

app.use("/api/auth", authRoutes);

app.use("/api", requireAuth);
app.use("/api/usuarios", usersRoutes);
app.use("/api/medios-pago", paymentMethodsRoutes);
app.use("/api/clubs-globales", globalClubsRoutes);
app.use("/api/canchas-globales", globalCourtsRoutes);
app.use("/api/torneos", tournamentsRoutes);
app.use("/api/partidos", matchesRoutes);
app.use("/api/superadmin", superadminRoutes);
app.use("/api/jugadores", playersRoutes);

app.use(errorHandler);

module.exports = { app };
