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
    // Permite cualquier localhost + dominios de Vercel + producción
    const allowedOrigins = [
      /^http:\/\/localhost:\d+$/,  // Cualquier puerto localhost
      /\.vercel\.app$/,             // Cualquier subdominio vercel.app
	  /\.simpleline\.solutions$/,  // cualquier subdominio de simpleline.solutions
    ];
    
    if (!origin) {
      // Permite requests sin origin (como Postman, curl, etc.)
      callback(null, true);
    } else {
      const isAllowed = allowedOrigins.some(pattern => {
        if (typeof pattern === 'string') {
          return origin === pattern;
        } else {
          return pattern.test(origin);
        }
      });
      
      if (isAllowed) {
        callback(null, true);
      } else {
        console.warn(`CORS blocked origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    }
  },
  credentials: true
}));
app.use(express.json());

// 🔍 ENDPOINTS DE DIAGNÓSTICO (NO REQUIEREN AUTH) - ELIMINAR EN PRODUCCIÓN
app.get("/debug/db-status", async (req, res) => {
  try {
    const dbUrlExists = !!process.env.DATABASE_URL;
    const dbUrlPreview = process.env.DATABASE_URL 
      ? process.env.DATABASE_URL.substring(0, 30) + "..." 
      : "NOT SET";
    
    // Test query
    const result = await db.query("SELECT version() as version");
    const pgVersion = result.rows[0].version;
    
    // Contar tablas
    const tablesResult = await db.query(
      `SELECT COUNT(*) as count FROM information_schema.tables 
       WHERE table_schema = 'public'`
    );
    const tableCount = parseInt(tablesResult.rows[0].count);
    
    // Contar usuarios
    const usersResult = await db.query("SELECT COUNT(*) as count FROM users");
    const userCount = parseInt(usersResult.rows[0].count);
    
    res.json({
      status: "✅ CONECTADO A POSTGRESQL",
      database: {
        DATABASE_URL_exists: dbUrlExists,
        DATABASE_URL_preview: dbUrlPreview,
        NODE_ENV: process.env.NODE_ENV,
        postgresVersion: pgVersion,
        tablesCount: tableCount,
        usersCount: userCount,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      status: "❌ ERROR DE CONEXIÓN",
      error: error.message,
      stack: error.stack,
      env: {
        DATABASE_URL_exists: !!process.env.DATABASE_URL,
        NODE_ENV: process.env.NODE_ENV,
      }
    });
  }
});

// 🔍 ENDPOINT PARA VER DATOS EN SUPABASE (NO REQUIERE AUTH)
app.get("/debug/data-check", async (req, res) => {
  try {
    // Listar todas las tablas
    const tablesResult = await db.query(
      `SELECT table_name FROM information_schema.tables 
       WHERE table_schema = 'public' ORDER BY table_name`
    );
    const tables = tablesResult.rows.map(r => r.table_name);
    
    // Contar registros en tablas principales
    const counts = {};
    const tablesToCheck = ['users', 'tournaments', 'players', 'matches', 'clubs', 'courts'];
    
    for (const table of tablesToCheck) {
      try {
        const result = await db.query(`SELECT COUNT(*) as count FROM ${table}`);
        counts[table] = parseInt(result.rows[0].count);
      } catch (e) {
        counts[table] = `Error: ${e.message}`;
      }
    }
    
    // Obtener lista de torneos si existen
    let tournaments = [];
    try {
      const tournamentsResult = await db.query(
        `SELECT id, name, created_at FROM tournaments ORDER BY created_at DESC LIMIT 10`
      );
      tournaments = tournamentsResult.rows;
    } catch (e) {
      tournaments = `Error: ${e.message}`;
    }
    
    res.json({
      allTables: tables,
      tableCounts: counts,
      recentTournaments: tournaments,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      stack: error.stack,
    });
  }
});

app.get("/api/health", (req, res) => res.json({ ok: true }));
const APP_VERSION = "1.2.0";
const APP_BUILD_DATE = "2026-04-06";

app.get("/api/public/app-config", (req, res) => {
	res.json({
		installationMode: config.installationMode,
		circuitEnabled: config.circuitEnabled,
		modeLabel: config.isCircuitMode ? "Circuit Mode" : "Club Mode",
		version: APP_VERSION,
		buildDate: APP_BUILD_DATE,
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
