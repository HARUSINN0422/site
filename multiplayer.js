"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.MULTIPLAYER_PORT || 3011);
const HOST = process.env.MULTIPLAYER_HOST || "127.0.0.1";
const WAIT_MS = 20_000;
const COUNTDOWN_MS = 5_000;
const MATCH_MS = 60_000;
const rooms = new Map();
const waiting = [];
const players = new Map();
const dataDir = path.join(__dirname, "data");
const rankingFile = path.join(dataDir, "pazuru-ranking.json");
let ranking = [];
try { ranking = JSON.parse(fs.readFileSync(rankingFile, "utf8")); if (!Array.isArray(ranking)) ranking = []; } catch {}

function saveRanking() {
  fs.mkdirSync(dataDir, { recursive: true });
  const tmp = rankingFile + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(ranking.slice(0, 200), null, 2));
  fs.renameSync(tmp, rankingFile);
}
function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "https://harusinn.com", "Vary": "Origin" });
  res.end(JSON.stringify(body));
}
function body(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; if (raw.length > 8192) req.destroy(); });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error("invalid json")); } });
    req.on("error", reject);
  });
}
function cleanName(value) {
  return String(value || "").replace(/[<>]/g, "").trim().slice(0, 16);
}
function publicRoom(p) {
  const room = rooms.get(p.roomId);
  if (!room) return { state: "gone" };
  return {
    state: p.state,
    playerId: p.id,
    roomId: room.id,
    opponent: room.players.find(x => x.id !== p.id)?.name || "",
    startAt: room.startAt || null,
    endsAt: room.endsAt || null,
    duration: MATCH_MS
  };
}
function removePlayer(p) {
  if (!p) return;
  const room = rooms.get(p.roomId);
  if (room) {
    room.players = room.players.filter(x => x.id !== p.id);
    if (!room.players.length) rooms.delete(room.id);
  }
  players.delete(p.id);
  const idx = waiting.indexOf(p);
  if (idx >= 0) waiting.splice(idx, 1);
}
function makeRoom(a, b, solo) {
  const id = crypto.randomUUID();
  const room = { id, players: [a, ...(b ? [b] : [])], solo, startAt: Date.now() + COUNTDOWN_MS, endsAt: Date.now() + COUNTDOWN_MS + MATCH_MS };
  rooms.set(id, room);
  for (const p of room.players) { p.roomId = id; p.state = "countdown"; }
}
function cleanup() {
  const now = Date.now();
  for (const p of [...players.values()]) {
    if (now - p.lastSeen > 90_000) removePlayer(p);
    else if (p.state === "waiting" && now - p.joinedAt >= WAIT_MS) makeRoom(p, null, true);
  }
  for (const [id, room] of rooms) if (now > room.endsAt + 120_000) rooms.delete(id);
}
setInterval(cleanup, 1000).unref();

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "https://harusinn.com", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" });
    return res.end();
  }
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true });
    if (req.method === "POST" && url.pathname === "/join") {
      const data = await body(req), name = cleanName(data.name);
      if (!name) return send(res, 400, { error: "名前を入力してください" });
      const p = { id: crypto.randomUUID(), name, state: "waiting", joinedAt: Date.now(), lastSeen: Date.now(), roomId: null };
      players.set(p.id, p);
      while (waiting.length) {
        const other = waiting.shift();
        if (players.has(other.id) && other.state === "waiting" && Date.now() - other.lastSeen < 30_000) {
          makeRoom(other, p, false);
          return send(res, 200, publicRoom(p));
        }
      }
      waiting.push(p);
      return send(res, 200, publicRoom(p));
    }
    if (req.method === "GET" && url.pathname === "/status") {
      const p = players.get(url.searchParams.get("id"));
      if (!p) return send(res, 404, { state: "gone" });
      p.lastSeen = Date.now();
      if (p.state === "countdown" && Date.now() >= rooms.get(p.roomId)?.startAt) p.state = "playing";
      return send(res, 200, publicRoom(p));
    }
    if (req.method === "POST" && url.pathname === "/finish") {
      const data = await body(req), p = players.get(String(data.id || ""));
      if (!p) return send(res, 404, { error: "対戦が見つかりません" });
      p.lastSeen = Date.now();
      const room = rooms.get(p.roomId);
      const score = Math.max(0, Math.min(1_000_000_000, Math.floor(Number(data.score) || 0)));
      p.score = score; p.finished = true;
      if (room && room.players.every(x => x.finished || !players.has(x.id))) {
        for (const x of room.players) if (typeof x.score === "number") {
          ranking.push({ name: x.name, score: x.score, date: new Date().toISOString() });
        }
        ranking.sort((a, b) => b.score - a.score);
        ranking = ranking.slice(0, 200);
        saveRanking();
        room.completed = true;
      }
      return send(res, 200, { ok: true, waitingForOpponent: !!room && !room.completed });
    }
    if (req.method === "GET" && url.pathname === "/ranking") return send(res, 200, { ranking: ranking.slice(0, 20) });
    if (req.method === "POST" && url.pathname === "/leave") {
      const data = await body(req);
      removePlayer(players.get(String(data.id || "")));
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "not found" });
  } catch (e) {
    return send(res, 400, { error: e.message || "bad request" });
  }
});
server.listen(PORT, HOST, () => console.log("Pazuru multiplayer API listening on " + HOST + ":" + PORT));
