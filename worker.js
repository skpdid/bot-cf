/**
 * Cloudflare Domain Manager + Telegram Bot
 * Multi-key via D1 + Auto webhook registration
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ⭐ AUTO-SETUP WEBHOOK — jalan sekali per request, non-blocking
    //    Jika URL webhook sudah sama dengan origin sekarang, langsung skip.
    ctx.waitUntil(
      ensureWebhook(env, url.origin).catch((e) =>
        console.error("ensureWebhook:", e.message)
      )
    );

    try {
      if (path === "/telegram/webhook" && request.method === "POST") {
        return await handleTelegram(request, env);
      }
      if (path === "/telegram/setup" && request.method === "GET") {
        return await forceSetupWebhook(env, url);
      }
      return await handleApi(request, env, path);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  },
};

/* ============================================================
 * Auto webhook
 * ============================================================ */
async function ensureWebhook(env, origin) {
  if (!env.TELEGRAM_BOT_TOKEN) return;

  const desired = `${origin}/telegram/webhook`;

  // Cek cache di D1
  let cached = null;
  try {
    cached = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'webhook_url'"
    ).first();
  } catch {
    // Tabel settings mungkin belum ada — lanjut saja, akan gagal set
  }

  if (cached?.value === desired) return; // sudah sama, tidak perlu apa-apa

  const body = {
    url: desired,
    allowed_updates: ["message", "channel_post"],
  };
  if (env.WEBHOOK_SECRET) body.secret_token = env.WEBHOOK_SECRET;

  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const data = await res.json();
  if (!data.ok) throw new Error(`setWebhook: ${data.description}`);

  // Simpan cache
  try {
    await env.DB.prepare(
      "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('webhook_url', ?, CURRENT_TIMESTAMP)"
    )
      .bind(desired)
      .run();
  } catch {}

  console.log("Webhook registered:", desired);
}

async function forceSetupWebhook(env, url) {
  if (url.searchParams.get("token") !== env.ADMIN_TOKEN) {
    return json({ error: "add ?token=<ADMIN_TOKEN>" }, 401);
  }
  // Reset cache agar ensureWebhook dipaksa daftar ulang
  try {
    await env.DB.prepare("DELETE FROM settings WHERE key = 'webhook_url'").run();
  } catch {}
  await ensureWebhook(env, url.origin);
  return json({ ok: true, webhook: `${url.origin}/telegram/webhook` });
}

/* ============================================================
 * Helpers umum
 * ============================================================ */
function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function cfApi(token, endpoint, method = "GET", body = null) {
  const opts = {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`https://api.cloudflare.com/client/v4${endpoint}`, opts);
  const data = await res.json();
  if (!data.success) {
    const msg = data.errors?.map((e) => e.message).join("; ") || `CF API ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function getAllZones(token) {
  let page = 1;
  const all = [];
  while (true) {
    const data = await cfApi(token, `/zones?page=${page}&per_page=50`);
    all.push(...data.result);
    if (page >= (data.result_info?.total_pages || 1)) break;
    page++;
  }
  return all;
}

async function detectAccountId(token) {
  try {
    const data = await cfApi(token, "/zones?per_page=1");
    return data.result[0]?.account?.id || null;
  } catch {
    return null;
  }
}

/* ============================================================
 * D1 – API key storage
 * ============================================================ */
async function getKey(env, label) {
  const row = await env.DB.prepare(
    "SELECT * FROM api_keys WHERE label = ? AND is_active = 1"
  )
    .bind(label)
    .first();
  if (!row) throw new Error(`API key "${label}" tidak ditemukan / nonaktif`);
  return row;
}

async function listKeys(env) {
  const res = await env.DB.prepare(
    "SELECT id, label, account_id, is_active, created_at FROM api_keys ORDER BY id"
  ).all();
  return res.results;
}

async function addKey(env, label, token, accountId = null) {
  if (!accountId) accountId = await detectAccountId(token);
  await env.DB.prepare(
    "INSERT INTO api_keys (label, api_token, account_id) VALUES (?, ?, ?)"
  )
    .bind(label, token, accountId)
    .run();
  return { label, account_id: accountId };
}

async function deleteKey(env, label) {
  const res = await env.DB.prepare("DELETE FROM api_keys WHERE label = ?")
    .bind(label)
    .run();
  return res.meta.changes > 0;
}

async function setKeyActive(env, label, active) {
  await env.DB.prepare("UPDATE api_keys SET is_active = ? WHERE label = ?")
    .bind(active ? 1 : 0, label)
    .run();
}

/* ============================================================
 * REST API (sama seperti sebelumnya)
 * ============================================================ */
async function handleApi(request, env, path) {
  const url = new URL(request.url);
  const method = request.method;

  if (path.startsWith("/admin/")) {
    if (request.headers.get("X-Admin-Token") !== env.ADMIN_TOKEN) {
      return json({ error: "Unauthorized" }, 401);
    }
    if (path === "/admin/keys" && method === "GET") return json(await listKeys(env));
    if (path === "/admin/keys" && method === "POST") {
      const { label, token, account_id } = await request.json();
      if (!label || !token) return json({ error: "label & token wajib" }, 400);
      return json(await addKey(env, label, token, account_id || null), 201);
    }
    if (path.startsWith("/admin/keys/")) {
      const parts = path.split("/").filter(Boolean);
      const label = decodeURIComponent(parts[2]);
      if (method === "DELETE") return json({ success: await deleteKey(env, label) });
      if (parts[3] === "enable") { await setKeyActive(env, label, true); return json({ success: true }); }
      if (parts[3] === "disable") { await setKeyActive(env, label, false); return json({ success: true }); }
    }
  }

  const keyLabel = url.searchParams.get("key");
  if (!keyLabel) return json({ error: "Missing ?key=<label>" }, 400);
  const keyRow = await getKey(env, keyLabel);
  const token = keyRow.api_token;
  const accountId = keyRow.account_id;

  if (path === "/zones" && method === "GET") {
    const zones = await getAllZones(token);
    return json(zones.map((z) => ({
      id: z.id, name: z.name, status: z.status,
      account: z.account?.name, plan: z.plan?.name,
    })));
  }

  let m = path.match(/^\/zones\/([^/]+)\/dns_records$/);
  if (m) {
    const zoneId = m[1];
    if (method === "GET") return json((await cfApi(token, `/zones/${zoneId}/dns_records`)).result);
    if (method === "POST") {
      const body = await request.json();
      return json((await cfApi(token, `/zones/${zoneId}/dns_records`, "POST", body)).result, 201);
    }
  }
  m = path.match(/^\/zones\/([^/]+)\/dns_records\/([^/]+)$/);
  if (m) {
    const [, zoneId, recordId] = m;
    if (method === "PUT") {
      const body = await request.json();
      return json((await cfApi(token, `/zones/${zoneId}/dns_records/${recordId}`, "PUT", body)).result);
    }
    if (method === "DELETE") {
      const data = await cfApi(token, `/zones/${zoneId}/dns_records/${recordId}`, "DELETE");
      return json({ success: true, result: data.result });
    }
  }

  if (path.startsWith("/workers/domains") && !accountId) {
    return json({ error: "Key ini tidak punya account_id" }, 400);
  }
  if (path === "/workers/domains") {
    if (method === "GET") return json((await cfApi(token, `/accounts/${accountId}/workers/domains`)).result);
    if (method === "PUT") {
      const body = await request.json();
      return json((await cfApi(token, `/accounts/${accountId}/workers/domains`, "PUT", body)).result, 201);
    }
  }
  m = path.match(/^\/workers\/domains\/([^/]+)$/);
  if (m && method === "DELETE") {
    const data = await cfApi(token, `/accounts/${accountId}/workers/domains/${m[1]}`, "DELETE");
    return json({ success: true, result: data.result });
  }

  return json({ error: "Not Found" }, 404);
}

/* ============================================================
 * Telegram handler
 * ============================================================ */
async function handleTelegram(request, env) {
  // ⭐ Verifikasi secret token (jika WEBHOOK_SECRET diset)
  if (env.WEBHOOK_SECRET) {
    const incoming = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (incoming !== env.WEBHOOK_SECRET) {
      return json({ error: "Unauthorized" }, 401);
    }
  }

  const update = await request.json();
  const msg = update.message || update.channel_post;
  if (!msg || !msg.text) return json({ ok: true });

  const chatId = msg.chat.id;
  const userId = String(msg.from?.id || "");
  const text = msg.text.trim();

  const allowed = (env.TELEGRAM_ALLOWED_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(userId)) {
    await sendMessage(env, chatId, "⛔ Unauthorized.");
    return json({ ok: true });
  }

  try {
    await routeTelegram(env, chatId, text);
  } catch (err) {
    await sendMessage(env, chatId, `❌ <b>Error:</b> ${escapeHtml(err.message)}`);
  }
  return json({ ok: true });
}

async function routeTelegram(env, chatId, text) {
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (cmd) {
    case "/start":
    case "/help":
      return sendMessage(env, chatId, HELP_TEXT);
    case "/keys": {
      const keys = await listKeys(env);
      if (!keys.length) return sendMessage(env, chatId, "Belum ada key. Pakai /addkey");
      const txt = keys.map((k) =>
        `• <b>${escapeHtml(k.label)}</b> ${k.is_active ? "✅" : "⛔"}\n  acc: <code>${escapeHtml(k.account_id || "-")}</code>`
      ).join("\n");
      return sendMessage(env, chatId, `🔑 <b>API Keys:</b>\n${txt}`);
    }
    case "/addkey": {
      if (args.length < 2) return sendMessage(env, chatId, "Format: /addkey <label> <token> [account_id]");
      const r = await addKey(env, args[0], args[1], args[2] || null);
      return sendMessage(env, chatId, `✅ Key <b>${escapeHtml(r.label)}</b> ditambahkan\nacc: <code>${escapeHtml(r.account_id || "-")}</code>`);
    }
    case "/delkey": {
      if (!args[0]) return sendMessage(env, chatId, "Format: /delkey <label>");
      const ok = await deleteKey(env, args[0]);
      return sendMessage(env, chatId, ok ? "✅ Dihapus" : "❌ Tidak ditemukan");
    }
    case "/zones": {
      if (!args[0]) return sendMessage(env, chatId, "Format: /zones <label>");
      const k = await getKey(env, args[0]);
      const zones = await getAllZones(k.api_token);
      if (!zones.length) return sendMessage(env, chatId, "Tidak ada zone.");
      const shown = zones.slice(0, 40).map((z) => `• <b>${escapeHtml(z.name)}</b> [${z.status}]\n  <code>${z.id}</code>`).join("\n");
      const more = zones.length > 40 ? `\n\n… dan ${zones.length - 40} lainnya` : "";
      return sendMessage(env, chatId, `🌐 <b>${zones.length} zone:</b>\n${shown}${more}`);
    }
    case "/dns": {
      if (args.length < 2) return sendMessage(env, chatId, "Format: /dns <label> <zone_id>");
      const k = await getKey(env, args[0]);
      const data = await cfApi(k.api_token, `/zones/${args[1]}/dns_records`);
      if (!data.result.length) return sendMessage(env, chatId, "Tidak ada DNS record.");
      const shown = data.result.slice(0, 25).map((r) =>
        `• <b>${r.type}</b> ${escapeHtml(r.name)}\n  → <code>${escapeHtml(r.content)}</code>\n  id: <code>${r.id}</code>`
      ).join("\n");
      return sendMessage(env, chatId, `📋 <b>DNS:</b>\n${shown}`);
    }
    case "/adddns": {
      if (args.length < 5) return sendMessage(env, chatId, "Format: /adddns <label> <zone_id> <type> <name> <content> [true|false]");
      const k = await getKey(env, args[0]);
      const type = args[2].toUpperCase();
      const body = { type, name: args[3], content: args[4], ttl: 1, proxied: args[5] ? args[5] === "true" : ["A", "CNAME"].includes(type) };
      const r = await cfApi(k.api_token, `/zones/${args[1]}/dns_records`, "POST", body);
      return sendMessage(env, chatId, `✅ DNS dibuat:\n<code>${r.result.id}</code>`);
    }
    case "/deldns": {
      if (args.length < 3) return sendMessage(env, chatId, "Format: /deldns <label> <zone_id> <record_id>");
      const k = await getKey(env, args[0]);
      await cfApi(k.api_token, `/zones/${args[1]}/dns_records/${args[2]}`, "DELETE");
      return sendMessage(env, chatId, "✅ DNS dihapus.");
    }
    case "/workers": {
      if (!args[0]) return sendMessage(env, chatId, "Format: /workers <label>");
      const k = await getKey(env, args[0]);
      if (!k.account_id) return sendMessage(env, chatId, "❌ Key ini tidak punya account_id");
      const data = await cfApi(k.api_token, `/accounts/${k.account_id}/workers/domains`);
      if (!data.result.length) return sendMessage(env, chatId, "Tidak ada worker domain.");
      const shown = data.result.map((d) => `• <b>${escapeHtml(d.hostname)}</b> → ${escapeHtml(d.service)}\n  id: <code>${d.id}</code>\n  zone: <code>${d.zone_name}</code>`).join("\n");
      return sendMessage(env, chatId, `⚙️ <b>Worker Domains:</b>\n${shown}`);
    }
    case "/attach": {
      if (args.length < 5) return sendMessage(env, chatId, "Format: /attach <label> <hostname> <service> <zone_id> <zone_name>");
      const k = await getKey(env, args[0]);
      if (!k.account_id) return sendMessage(env, chatId, "❌ Key ini tidak punya account_id");
      const r = await cfApi(k.api_token, `/accounts/${k.account_id}/workers/domains`, "PUT", {
        hostname: args[1], service: args[2], zone_id: args[3], zone_name: args[4],
      });
      return sendMessage(env, chatId, `✅ Attached:\n<code>${r.result.id}</code>`);
    }
    case "/detach": {
      if (args.length < 2) return sendMessage(env, chatId, "Format: /detach <label> <domain_id>");
      const k = await getKey(env, args[0]);
      if (!k.account_id) return sendMessage(env, chatId, "❌ Key ini tidak punya account_id");
      await cfApi(k.api_token, `/accounts/${k.account_id}/workers/domains/${args[1]}`, "DELETE");
      return sendMessage(env, chatId, "✅ Detached.");
    }
    default:
      return sendMessage(env, chatId, "❓ Command tidak dikenal. Ketik /help");
  }
}

const HELP_TEXT = `🤖 <b>Cloudflare Domain Manager Bot</b>

<b>Key Management:</b>
/keys — List semua API key
/addkey &lt;label&gt; &lt;token&gt; [account_id] — Tambah key
/delkey &lt;label&gt; — Hapus key

<b>Zones:</b>
/zones &lt;label&gt; — List semua zone + Zone ID

<b>DNS:</b>
/dns &lt;label&gt; &lt;zone_id&gt;
/adddns &lt;label&gt; &lt;zone_id&gt; &lt;type&gt; &lt;name&gt; &lt;content&gt; [true|false]
/deldns &lt;label&gt; &lt;zone_id&gt; &lt;record_id&gt;

<b>Worker Domains:</b>
/workers &lt;label&gt;
/attach &lt;label&gt; &lt;hostname&gt; &lt;service&gt; &lt;zone_id&gt; &lt;zone_name&gt;
/detach &lt;label&gt; &lt;domain_id&gt;`;

async function sendMessage(env, chatId, text) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true,
    }),
  });
}