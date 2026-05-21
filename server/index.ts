import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import { assertAuthConfig, authStatus, login, logout, requireAuth } from "./auth.js";
import { connectDB } from "./db.js";
import apiRouter from "./routes/api.js";

dotenv.config({ path: ".env.local" });
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProduction = process.env.NODE_ENV === "production";
const app = express();
const port = Number(process.env.PORT ?? 5173);

app.use(express.json({ limit: "1mb" }));
app.get("/api/auth/status", authStatus);
app.post("/api/auth/login", login);
app.post("/api/auth/logout", logout);
app.use("/api", requireAuth, apiRouter);

async function attachFrontend() {
  if (!isProduction) {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
    return;
  }

  const distPath = path.resolve(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

async function start() {
  try {
    assertAuthConfig();
    await connectDB();
    await attachFrontend();

    app.listen(port, () => {
      console.log(`Investment Planner is running at http://localhost:${port}`);
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

void start();
