import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createNotifyHandler, type PushMessage, type PushTicket } from "./handler.ts";

const supabase = createClient(
  Deno.env.get("SB_URL") ?? "",
  Deno.env.get("SB_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

const handler = createNotifyHandler({
  secret: Deno.env.get("NOTIFY_SECRET") ?? "",

  async fetchTokens(userId) {
    const { data, error } = await supabase
      .from("device_tokens")
      .select("expo_token")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.expo_token as string);
  },

  async sendPush(messages: PushMessage[]): Promise<PushTicket[]> {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      console.error("expo push failed", res.status, await res.text());
      return messages.map(() => ({ status: "error", message: `http_${res.status}` }));
    }
    const body = await res.json();
    return (body?.data ?? []) as PushTicket[];
  },

  async removeTokens(tokens) {
    const { error } = await supabase.from("device_tokens").delete().in("expo_token", tokens);
    if (error) console.error("failed to remove stale tokens", error.message);
  },
});

serve(async (req) => {
  try {
    return await handler(req);
  } catch (err) {
    console.error("notify failed", err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
