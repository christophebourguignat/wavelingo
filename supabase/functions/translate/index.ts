import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LANGUAGE_NAMES: Record<string, string> = {
  EN: "English",
  FR: "French",
  DE: "German",
  ES: "Spanish",
  PT: "Portuguese",
  IT: "Italian",
  NL: "Dutch",
  SV: "Swedish",
  JA: "Japanese",
  ZH: "Simplified Chinese (Mandarin, 简体中文)",
  "ZH-TW": "Traditional Chinese (繁體中文)",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, targetLanguage, segmentId } = await req.json();

    if (!text || !targetLanguage) {
      return new Response(JSON.stringify({ error: "Missing text or targetLanguage" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const langName = LANGUAGE_NAMES[targetLanguage] || targetLanguage;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are a translator for amateur radio HF voice QSO conversations between ham radio operators. Translate the following text to ${langName}. Output ONLY the translation, nothing else. No quotes, no explanation. If the text is already in ${langName}, output it unchanged. If the text is unintelligible or empty, output an empty string. When you detect an amateur radio callsign (e.g. F1OBT, WB6BCU, K7UGA) or a callsign spelled out using the NATO/ICAO phonetic alphabet (e.g. "Kilo Seven Uniform Golf Bravo"), wrap it in **bold** markdown in your output. Keep callsigns in their standard alphanumeric form (e.g. **K7UGB**), not phonetic.`,
          },
          { role: "user", content: text },
        ],
      }),
    });

    if (response.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly.", segmentId }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (response.status === 402) {
      return new Response(JSON.stringify({ error: "Credits exhausted. Please add funds.", segmentId }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!response.ok) {
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const result = await response.json();
    const translation = result.choices?.[0]?.message?.content?.trim() || "";

    return new Response(JSON.stringify({ translation, segmentId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("translate error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
