// Verschickt Push-Mitteilungen: "X hat ein Training abgeschlossen" und den Wochenrückblick.
// Wird nur von der Datenbank aufgerufen (Trigger bzw. pg_cron), geschützt über x-push-secret.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
let cfg: Record<string, string> | null = null;

async function config() {
  if (cfg) return cfg;
  const { data, error } = await sb.rpc("push_config");
  if (error) throw error;
  cfg = Object.fromEntries((data as { name: string; secret: string }[]).map((r) => [r.name, r.secret]));
  webpush.setVapidDetails("mailto:lasse_krueger@icloud.com", cfg.vapid_public, cfg.vapid_private);
  return cfg;
}

type Target = { endpoint: string; p256dh: string; auth: string; title: string; body: string };

async function send(targets: Target[], tag: string) {
  let sent = 0, removed = 0;
  await Promise.all(targets.map(async (t) => {
    try {
      await webpush.sendNotification(
        { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
        JSON.stringify({ title: t.title, body: t.body, tag, url: tag === "weekly" ? "#rueckblick" : "#social" }),
        { TTL: 60 * 60 * 12, urgency: "high" },
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) { await sb.rpc("push_remove_sub", { p_endpoint: t.endpoint }); removed++; }
      else console.error("push failed", code, (e as Error).message);
    }
  }));
  return { sent, removed };
}

Deno.serve(async (req) => {
  try {
    const c = await config();
    if (req.headers.get("x-push-secret") !== c.push_secret) return new Response("forbidden", { status: 403 });
    const p = await req.json();
    // Optional nur an ein Gerät eines Nutzers schicken (zum Testen)
    const only = async (t: Target[]) => {
      if (!p.only_user) return t;
      const { data } = await sb.from("push_subscriptions").select("endpoint").eq("user_id", p.only_user);
      const eps = new Set((data ?? []).map((r) => r.endpoint));
      return t.filter((x) => eps.has(x.endpoint));
    };
    if (p.type === "workout" && p.user_id) {
      const { data, error } = await sb.rpc("push_targets_workout", { p_user: p.user_id });
      if (error) throw error;
      return Response.json(await send(await only(data as Target[]), "workout-" + p.user_id));
    }
    if (p.type === "test" && p.user_id) {
      const { data, error } = await sb.from("push_subscriptions").select("endpoint,p256dh,auth").eq("user_id", p.user_id);
      if (error) throw error;
      return Response.json(await send((data ?? []).map((r) => ({ ...r, title: p.title ?? "Test 🔔", body: p.body ?? "Wenn du das liest, funktionieren die Mitteilungen." })), p.tag ?? "test"));
    }
    if (p.type === "weekly") {
      // Cron läuft 17 und 18 Uhr UTC – nur senden, wenn es in Deutschland 19 Uhr ist (Sommer-/Winterzeit)
      const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Europe/Berlin" }).formatToParts(new Date()).find((x) => x.type === "hour")?.value);
      if (hour !== 19 && !p.force) return Response.json({ skipped: true, hour });
      const { data, error } = await sb.rpc("push_targets_weekly");
      if (error) throw error;
      return Response.json(await send(await only((data as Target[]).map((t) => ({ ...t, body: t.body + "\nTippen für deinen ganzen Rückblick" }))), "weekly"));
    }
    return new Response("bad request", { status: 400 });
  } catch (e) {
    console.error(e);
    return new Response("error", { status: 500 });
  }
});
