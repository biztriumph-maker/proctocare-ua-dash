import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.SYNC_SERVER_PORT || 8787);
const DB_PATH = path.join(__dirname, "sync-state.json");

async function readDb() {
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { entries: {} };
  }
}

async function writeDb(db) {
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

const server = createServer(async (req, res) => {
  if (!req.url) return json(res, 400, { error: "Missing URL" });

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  if (req.method === "GET" && req.url === "/sync-api/health") {
    return json(res, 200, { ok: true });
  }

  if (req.method === "GET" && req.url === "/sync-api/state") {
    const db = await readDb();
    return json(res, 200, { entries: db.entries || {} });
  }

  if (req.method === "POST" && req.url === "/sync-api/state") {
    const body = await readBody(req);
    if (typeof body.key !== "string") {
      return json(res, 400, { error: "Invalid key" });
    }

    const db = await readDb();
    db.entries ||= {};

    if (body.value == null) {
      delete db.entries[body.key];
    } else {
      db.entries[body.key] = { value: String(body.value), updatedAt: Date.now() };
    }

    await writeDb(db);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && req.url === "/sync-api/state/bulk") {
    const body = await readBody(req);
    const entries = body.entries;
    if (!entries || typeof entries !== "object") {
      return json(res, 400, { error: "Invalid entries" });
    }

    const db = await readDb();
    db.entries ||= {};
    for (const [key, value] of Object.entries(entries)) {
      db.entries[key] = { value: String(value), updatedAt: Date.now() };
    }

    await writeDb(db);
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ProctoCare sync server listening on http://0.0.0.0:${PORT}`);
});