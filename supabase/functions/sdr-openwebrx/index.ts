// SDR transport: OpenWebRX (and OpenWebRX+).
//
// Bridges browser → OpenWebRX (ws://) and emits the unified SSE protocol
// defined in `_shared/sdr-protocol.ts`. Same shape as `sdr-kiwi`.
//
// OWRX wire protocol (jketterl/openwebrx):
//   - Text handshake: client sends "SERVER DE CLIENT client=<name> type=receiver",
//     server replies "CLIENT DE SERVER ...".
//   - Then JSON text messages flow both ways. Client must send `connectionproperties`
//     before tuning; server sends `config` (with samp_rate, audio_compression, sdrs,
//     center_freq, profile_id, ...) once a profile is selected.
//   - Binary frames carry [type byte][payload]:
//       0x01 = FFT/spectrum    (ignored)
//       0x02 = audio           (PCM or ADPCM, depending on `audio_compression`)
//       0x04 = HD audio        (ignored — we request standard rate)
//   - smeter values arrive as JSON {"type":"smeter","value":<float dBFS-ish>}.
//
// We request `audio_compression: "adpcm"` (the default) and decode in this
// edge function, then re-encode samples as 16-bit big-endian to match the
// Kiwi wire format the client already understands.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { encodeSdrEvent, type SdrEvent } from "../_shared/sdr-protocol.ts";
import { ImaAdpcmDecoder, int16ToBigEndianBytes } from "../_shared/adpcm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ProfileEntry {
  id: string;
  name?: string;
  center_freq?: number;
  samp_rate?: number;
  start_freq?: number;
  start_mod?: string;
  sdr_id?: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { server, port, frequency, modulation, path, secure } = await req.json();
    if (!server || !port) {
      return new Response(JSON.stringify({ error: "Missing server or port" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const freqKHz = frequency || 7200;
    const freqHz = Math.round(freqKHz * 1000);
    const mod = (modulation || "lsb") as string;

    // Hardcoded SSB passbands (Hz, relative to offset_freq).
    const passband =
      mod === "lsb" ? { low_cut: -3000, high_cut: -300 }
      : mod === "usb" ? { low_cut: 300, high_cut: 3000 }
      : mod === "am" ? { low_cut: -4000, high_cut: 4000 }
      : { low_cut: -3000, high_cut: 3000 };

    const wsPath = (typeof path === "string" && path) ? path : "/ws/";
    const scheme = secure ? "wss" : "ws";
    const wsUrl = `${scheme}://${server}:${port}${wsPath}`;
    const wsCreatedAt = Date.now();
    console.log(`[sdr-openwebrx ${wsCreatedAt}] Connecting: ${wsUrl} freq=${freqHz}Hz mod=${mod}`);

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    let clientCancelled = false;

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const adpcm = new ImaAdpcmDecoder();
        let sampleRate = 12000;
        let audioCompression: "adpcm" | "none" = "adpcm";
        let serverCenterFreq: number | null = null;
        let profiles: Record<string, ProfileEntry> = {};
        let selectedProfileId: string | null = null;
        let configReceived = false;
        let tuned = false;
        let readyEmitted = false;
        let closed = false;
        let keepaliveInterval: number | undefined;
        let connectTimeout: number | undefined;
        let hardLimitTimer: number | undefined;
        let profileFallbackTimer: number | null = null;

        const emit = (event: SdrEvent) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(encodeSdrEvent(event)));
          } catch {
            closed = true;
          }
        };

        const wsSendJson = (obj: Record<string, unknown>) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const s = JSON.stringify(obj);
          console.log(`[sdr-openwebrx TX] ${s}`);
          ws.send(s);
        };

        const cleanup = () => {
          if (keepaliveInterval) clearInterval(keepaliveInterval);
          if (connectTimeout) clearTimeout(connectTimeout);
          if (hardLimitTimer) clearTimeout(hardLimitTimer);
          if (profileFallbackTimer != null) { clearTimeout(profileFallbackTimer); profileFallbackTimer = null; }
        };

        // Pick a profile whose [start, end] window contains freqHz.
        // OWRX profile range = [center_freq - samp_rate/2, center_freq + samp_rate/2].
        const pickProfile = (): ProfileEntry | null => {
          // First try: exact range match using center_freq + samp_rate (only available
          // if we got the full sdrs[].profiles config payload).
          for (const p of Object.values(profiles)) {
            if (p.center_freq == null || p.samp_rate == null) continue;
            const half = p.samp_rate / 2;
            if (freqHz >= p.center_freq - half && freqHz <= p.center_freq + half) {
              return p;
            }
          }
          // Second try: heuristic match by profile name vs. requested frequency band.
          // OWRX 1.2.x sends a separate `profiles` message with only {id, name},
          // so center_freq is unknown until we actually select. Match keywords.
          const byBand = pickProfileByBand();
          if (byBand) return byBand;
          // Fallback: first profile; server may reject but at least we try.
          const all = Object.values(profiles);
          return all.length > 0 ? all[0] : null;
        };

        // Match the requested frequency to ham/SWL band keywords found in profile names.
        // Returns the first profile whose (lowercased) name contains ANY of the keywords
        // for the band that contains freqHz. Order matters — most-specific keywords first.
        const pickProfileByBand = (): ProfileEntry | null => {
          const fMHz = freqHz / 1_000_000;
          // [matcher, keywords (lowercased)] in priority order.
          // Each entry is checked against fMHz; first match wins.
          const bands: Array<{ test: (f: number) => boolean; keys: string[] }> = [
            { test: (f) => f >= 0.15 && f < 0.55, keys: ["lw", "long wave", "longwave"] },
            { test: (f) => f >= 0.52 && f < 1.71, keys: ["mw", "medium wave", "mediumwave", "bcb", "am broadcast"] },
            { test: (f) => f >= 1.8 && f <= 2.0, keys: ["160m", "160 m", "topband", "top band"] },
            { test: (f) => f >= 3.5 && f <= 4.0, keys: ["80m", "80 m", "75m"] },
            { test: (f) => f >= 5.25 && f <= 5.45, keys: ["60m", "60 m"] },
            { test: (f) => f >= 6.9 && f <= 7.4, keys: ["40m", "40 m"] },
            { test: (f) => f >= 9.0 && f <= 10.2, keys: ["30m", "30 m", "9mhz", "10mhz"] },
            { test: (f) => f >= 13.9 && f <= 14.4, keys: ["20m", "20 m"] },
            { test: (f) => f >= 18.0 && f <= 18.2, keys: ["17m", "17 m"] },
            { test: (f) => f >= 21.0 && f <= 21.5, keys: ["15m", "15 m"] },
            { test: (f) => f >= 24.8 && f <= 25.0, keys: ["12m", "12 m"] },
            { test: (f) => f >= 26.9 && f <= 27.5, keys: ["cb", "11m", "11 m"] },
            { test: (f) => f >= 28.0 && f <= 29.7, keys: ["10m", "10 m"] },
            { test: (f) => f >= 50 && f <= 54, keys: ["6m", "6 m"] },
            { test: (f) => f >= 144 && f <= 148, keys: ["2m", "2 m", "vhf"] },
            { test: (f) => f >= 222 && f <= 225, keys: ["1.25m", "125cm"] },
            { test: (f) => f >= 430 && f <= 440, keys: ["70cm", "70 cm", "uhf"] },
            { test: (f) => f >= 446 && f <= 446.2, keys: ["pmr"] },
            { test: (f) => f >= 1240 && f <= 1300, keys: ["23cm", "23 cm"] },
          ];

          const list = Object.values(profiles);
          for (const band of bands) {
            if (!band.test(fMHz)) continue;
            for (const p of list) {
              const name = (p.name || "").toLowerCase();
              if (band.keys.some((k) => name.includes(k))) return p;
            }
          }

          // Coarse fallback by frequency range.
          const coarseKeys =
            fMHz < 30 ? ["hf", "sw", "shortwave", "short wave"]
            : fMHz < 300 ? ["vhf"]
            : fMHz < 3000 ? ["uhf"]
            : [];
          if (coarseKeys.length > 0) {
            for (const p of list) {
              const name = (p.name || "").toLowerCase();
              if (coarseKeys.some((k) => name.includes(k))) return p;
            }
          }
          return null;
        };

        const sendTune = () => {
          if (tuned || serverCenterFreq == null) return;
          const offset = freqHz - serverCenterFreq;
          wsSendJson({
            type: "dspcontrol",
            params: {
              offset_freq: offset,
              mod,
              low_cut: passband.low_cut,
              high_cut: passband.high_cut,
              squelch_level: -150,
            },
          });
          // Start the DSP (some OWRX versions require an explicit "action: start").
          wsSendJson({ type: "dspcontrol", action: "start" });
          tuned = true;

          if (!readyEmitted) {
            emit({ type: "ready", sampleRate });
            readyEmitted = true;
          }

          // Hard 600s limit (matches Kiwi).
          hardLimitTimer = setTimeout(() => {
            console.log(`[sdr-openwebrx] hard 600s limit reached`);
            emit({ type: "closed", reason: "hard_limit" });
            closed = true;
            cleanup();
            try { ws.close(1000, "Going Away"); } catch { /* ignore */ }
            try { controller.close(); } catch { /* ignore */ }
          }, 600_000) as unknown as number;
        };

        // 10-second connection timeout.
        connectTimeout = setTimeout(() => {
          console.error(`[sdr-openwebrx] connect timeout 10s elapsed=${Date.now() - wsCreatedAt}ms`);
          emit({ type: "error", code: "timeout", message: "Connection timed out (server unreachable)" });
          emit({ type: "closed", reason: "server" });
          closed = true;
          cleanup();
          try { ws.close(1000, "Going Away"); } catch { /* ignore */ }
          try { controller.close(); } catch { /* ignore */ }
        }, 10000) as unknown as number;

        ws.onopen = () => {
          console.log(`[sdr-openwebrx] WS open in ${Date.now() - wsCreatedAt}ms`);
          if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = undefined; }
          // Handshake.
          ws.send("SERVER DE CLIENT client=wavelingo type=receiver");
          // Declare connection properties up front. We accept ADPCM (default).
          wsSendJson({
            type: "connectionproperties",
            params: { output_rate: 12000, hd_output_rate: 48000 },
          });

          keepaliveInterval = setInterval(() => {
            try {
              if (ws.readyState === WebSocket.OPEN) {
                wsSendJson({ type: "ping" });
              }
            } catch { /* ignore */ }
          }, 25000) as unknown as number;
        };

        ws.onmessage = (event) => {
          const data = event.data;

          if (typeof data === "string") {
            // Either the SERVER DE handshake reply, or JSON.
            if (data.startsWith("CLIENT DE SERVER")) {
              console.log(`[sdr-openwebrx] handshake: ${data}`);
              return;
            }
            let msg: Record<string, unknown>;
            try {
              msg = JSON.parse(data);
            } catch {
              console.log(`[sdr-openwebrx] non-JSON text: ${data.slice(0, 120)}`);
              return;
            }
            const type = msg.type as string | undefined;

            if (type === "config") {
              const value = (msg.value ?? msg) as Record<string, unknown>;
              // NOTE: `samp_rate` in OWRX `config` is the SDR/IQ rate (e.g. 2_000_000),
              // NOT the audio output rate. The audio rate is what we negotiated via
              // `connectionproperties.output_rate` (12000 Hz). Do NOT overwrite it here,
              // or downstream playback speed will be completely wrong (silent/garbled).
              if (typeof value.audio_compression === "string") {
                audioCompression = value.audio_compression as "adpcm" | "none";
              }
              if (typeof value.center_freq === "number") {
                serverCenterFreq = value.center_freq as number;
              }
              // Profile list may live under sdrs[*].profiles or directly.
              if (value.sdrs && typeof value.sdrs === "object") {
                profiles = {};
                for (const [sdrId, sdr] of Object.entries(value.sdrs as Record<string, unknown>)) {
                  const sdrObj = sdr as Record<string, unknown>;
                  const ps = sdrObj.profiles as Record<string, unknown> | undefined;
                  if (ps) {
                    for (const [pid, p] of Object.entries(ps)) {
                      const pObj = p as Record<string, unknown>;
                      profiles[`${sdrId}|${pid}`] = {
                        id: `${sdrId}|${pid}`,
                        name: pObj.name as string,
                        center_freq: pObj.center_freq as number,
                        samp_rate: pObj.samp_rate as number,
                        start_freq: pObj.start_freq as number,
                        start_mod: pObj.start_mod as string,
                        sdr_id: sdrId,
                      };
                    }
                  }
                }
              }
              configReceived = true;
              console.log(`[sdr-openwebrx] config: iq_samp_rate=${value.samp_rate ?? 'n/a'} audio_rate=${sampleRate} center=${serverCenterFreq} comp=${audioCompression} profiles=${Object.keys(profiles).length}`);

              // If we have profiles and none yet selected, pick one for the requested freq.
              if (!selectedProfileId && Object.keys(profiles).length > 0) {
                const p = pickProfile();
                if (p) {
                  selectedProfileId = p.id;
                  console.log(`[sdr-openwebrx] selectprofile=${p.id} (${p.name})`);
                  adpcm.reset();
                  wsSendJson({ type: "selectprofile", params: { profile: p.id } });
                  // The new profile will trigger another `config`; wait for it before tuning.
                  return;
                }
              }

              // Profile already selected → tune now.
              if (selectedProfileId && serverCenterFreq != null) {
                sendTune();
                return;
              }

              // No profile picked yet (profiles list not yet received). Schedule a
              // short fallback: if `profiles` doesn't arrive within 1.5s, tune with
              // whatever center we have. This keeps single-profile servers (like OH6KK)
              // working while giving multi-profile servers (like 9A6NDZ) a chance to
              // send their profile list first.
              if (!selectedProfileId && profileFallbackTimer == null && serverCenterFreq != null) {
                profileFallbackTimer = setTimeout(() => {
                  if (!selectedProfileId && !tuned && serverCenterFreq != null) {
                    console.log(`[sdr-openwebrx] no profiles message received in 1.5s — tuning with default profile (center=${serverCenterFreq})`);
                    sendTune();
                  }
                }, 1500) as unknown as number;
              }
              return;
            }

            if (type === "profiles") {
              // OWRX 1.2.x profile listing: { type:"profiles", value:[{id:"sdrId|profileId", name:"40m"}, ...] }
              const arr = msg.value as Array<{ id?: string; name?: string }> | undefined;
              if (Array.isArray(arr)) {
                // Cancel the "tune anyway" fallback — we got our profile list.
                if (profileFallbackTimer != null) { clearTimeout(profileFallbackTimer); profileFallbackTimer = null; }
                for (const entry of arr) {
                  if (!entry?.id) continue;
                  // Don't clobber richer entries (with center_freq) from sdrs[] config.
                  if (!profiles[entry.id]) {
                    profiles[entry.id] = { id: entry.id, name: entry.name };
                  } else if (!profiles[entry.id].name && entry.name) {
                    profiles[entry.id].name = entry.name;
                  }
                }
                console.log(`[sdr-openwebrx] profiles received: [${arr.map((p) => p.name ?? p.id).join(", ")}]`);

                // If we haven't selected yet, pick now and request the band-specific profile.
                if (!selectedProfileId && Object.keys(profiles).length > 0) {
                  const p = pickProfile();
                  if (p) {
                    selectedProfileId = p.id;
                    console.log(`[sdr-openwebrx] selectprofile=${p.id} (${p.name ?? "?"}) for ${freqHz}Hz`);
                    // Reset center so we wait for the new config before tuning.
                    serverCenterFreq = null;
                    tuned = false;
                    // New profile → fresh ADPCM stream → reset codec state.
                    adpcm.reset();
                    wsSendJson({ type: "selectprofile", params: { profile: p.id } });
                  }
                }
              }
              return;
            }

            if (type === "smeter") {
              const v = msg.value as number | undefined;
              if (typeof v === "number" && Number.isFinite(v)) {
                // OWRX `smeter.value` is a LINEAR power ratio (e.g. 4e-8). Convert to dB, then map to UI's dBm range.
                const dB = v > 0 ? 10 * Math.log10(v) : -120;
                emit({ type: "rssi", dbm: Math.max(-127, Math.min(-43, dB - 10)) });
              }
              return;
            }

            if (type === "backoff" || type === "Backoff") {
              const reason = (msg.reason as string) || "Server is too busy";
              emit({ type: "error", code: "too_many_clients", message: reason });
              emit({ type: "closed", reason: "server" });
              closed = true;
              cleanup();
              try { ws.close(1000, "Going Away"); } catch { /* ignore */ }
              try { controller.close(); } catch { /* ignore */ }
              return;
            }

            if (type === "log_message") {
              console.log(`[sdr-openwebrx] log: ${JSON.stringify(msg)}`);
              return;
            }

            // Useful but otherwise ignored: receiver_details, features, modes, bookmarks, etc.
            return;
          }

          // Binary frame.
          if (data instanceof ArrayBuffer) {
            const bytes = new Uint8Array(data);
            if (bytes.length < 2) return;
            const tag = bytes[0];
            const payload = bytes.subarray(1);

            if (tag === 0x02) {
              // Audio frame.
              let samples: Int16Array;
              if (audioCompression === "adpcm") {
                samples = adpcm.decodeWithSync(payload);
              } else {
                // Raw 16-bit signed little-endian PCM.
                const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
                const n = Math.floor(payload.byteLength / 2);
                samples = new Int16Array(n);
                for (let i = 0; i < n; i++) samples[i] = view.getInt16(i * 2, true);
              }
              if (samples.length === 0) return; // pre-sync ADPCM bytes — drop silently
              // OWRX audio is post-AGC and runs near full-scale. The client
              // RMS meter (calibrated for Kiwi's quieter PCM) saturates at 1.0
              // almost continuously. Attenuate samples here so the meter is
              // useful; the user can compensate with the Volume slider.
              const OWRX_AUDIO_GAIN = 0.25;
              for (let i = 0; i < samples.length; i++) {
                samples[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * OWRX_AUDIO_GAIN)));
              }
              const beBytes = int16ToBigEndianBytes(samples);
              emit({ type: "audio", pcm: base64Encode(beBytes), len: beBytes.length });
              return;
            }

            // 0x01 spectrum / 0x04 hd audio — ignore.
          }
        };

        ws.onerror = (e: Event & { message?: string }) => {
          if (closed) return;
          console.error(`[sdr-openwebrx] WS error type=${e.type} message=${e.message || "N/A"}`);
          emit({ type: "error", code: "ws_error", message: "WebSocket connection error" });
        };

        ws.onclose = (ev: CloseEvent) => {
          if (closed) return;
          const reason = clientCancelled ? "client" : "server";
          console.log(`[sdr-openwebrx] WS closed code=${ev.code} reason="${ev.reason}" trigger=${reason} configReceived=${configReceived}`);
          cleanup();
          if (!configReceived) {
            emit({ type: "error", code: "server_down", message: "Server closed before handshake completed" });
          }
          emit({ type: "closed", reason });
          closed = true;
          try { controller.close(); } catch { /* already closed */ }
        };
      },
      cancel() {
        console.log(`[sdr-openwebrx] SSE cancelled by client after ${Date.now() - wsCreatedAt}ms`);
        clientCancelled = true;
        try { ws.close(1000, "Going Away"); } catch { /* ignore */ }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    console.error("[sdr-openwebrx] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
