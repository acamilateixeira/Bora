import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SB_URL") ?? "";
const serviceRoleKey = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

type Payload = {
  user_id: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

async function sendExpoPush(tokens: string[], payload: Payload) {
  if (tokens.length === 0) return;

  const messages = tokens.map((token) => ({
    to: token,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
  }));

  // Expo push API limit is 100 messages per request
  const chunks: typeof messages[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chunk),
    });
  }
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const payload = (await req.json()) as Payload;
  if (!payload?.user_id || !payload?.title || !payload?.body) {
    return new Response("Invalid payload", { status: 400 });
  }

  const { data, error } = await supabase
    .from("device_tokens")
    .select("expo_token")
    .eq("user_id", payload.user_id);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const tokens = (data || []).map((t) => t.expo_token);
  await sendExpoPush(tokens, payload);

  return new Response(JSON.stringify({ sent: tokens.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
