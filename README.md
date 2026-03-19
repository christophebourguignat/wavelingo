# Wavelingo

**Real-time shortwave radio translator** — Listen to ham radio stations worldwide and get live translations, right in your browser (desktop or smartphone).

[![Beta](https://img.shields.io/badge/status-beta-orange)](https://wavelingo.lovable.app) [![Telegram](https://img.shields.io/badge/Telegram-Join%20Group-blue?logo=telegram)](https://t.me/+l5Y_cyYFsXBhODBk)

## What is Wavelingo?

[Wavelingo](https://wavelingo.app/) connects to [KiwiSDR](http://kiwisdr.com/) receivers around the world, streams their audio in real time, transcribes spoken content, and translates it into your chosen language — all from a single web interface (dektop, tablet or smartphone).

## ✨ Features

- **🗺️ Interactive World Map** — Browse and select KiwiSDR receivers worldwide (new added regularly)
- **📻 Live Radio Streaming** — Connect to any KiwiSDR (if it is available) and listen to shortwave frequencies (0–30 MHz) with LSB/USB modulation
- **🎙️ Real-time Transcription** — Automatic speech-to-text
- **🌍 Live Translation** — Transcribed text is translated on-the-fly into 9 languages
- **📱 Responsive Design** — Tabbed mobile layout and split-panel desktop layout

## 🚀 User Guide

### Quick Start

1. **Select a receiver** — Click a marker on the map to pick a KiwiSDR station
2. **Set the frequency** — Enter a frequency in kHz. Modulation is auto-selected (LSB below 10 MHz, USB above)
3. **Connect** — Click **Connect** to start streaming audio from the receiver
4. **Translate** — Click **Translate** to begin real-time transcription and translation
5. **Choose your language** — Use the language selector to pick your target translation language

### Tips

- If a server is busy or down, try another one — status messages will guide you
- The audio level meter shows signal activity in real time
- Translations appear as subtitle-style text below the original transcription. You can change the target language at any time and all translations will be updated.
- Bold green text in translations highlights named entities (call signs, location, ...)

### Beta Limitations

- Transcription sessions are limited in time
- Join the [Telegram group](https://t.me/+l5Y_cyYFsXBhODBk) for updates and support

## 🛠️ Tech Stack

| Layer          | Technology                                               |
| -------------- | -------------------------------------------------------- |
| Frontend       | React 18, TypeScript, Vite                               |
| UI             | Tailwind CSS, shadcn/ui, Lucide icons                    |
| Maps           | Leaflet + React-Leaflet                                  |
| Themes         | next-themes                                              |
| Radio Backend  | KiwiSDR WebSocket API via Edge Functions (SSE streaming) |
| Transcription  | ElevenLabs Scribe v2 (real-time WebSocket)               |
| Translation    | Gemini 3 Flash via Lovable cloud backend                 |
| Infrastructure | Supabase Edge Functions                                  |

## 📁 Project Structure

```
src/
├── components/
│   ├── ControlPanel.tsx      # Radio connection, frequency, volume controls
│   ├── MapPanel.tsx           # Leaflet map with KiwiSDR markers
│   ├── SubtitlesPanel.tsx     # Transcription + translation display
│   └── ThemeToggle.tsx        # Dark/light mode switch
├── hooks/
│   ├── useKiwiSDR.ts          # KiwiSDR streaming via SSE
│   ├── useTranscription.ts    # ElevenLabs Scribe integration
│   └── useTranslation.ts      # Translation pipeline
├── lib/
│   └── constants.ts           # Server list, languages, types
├── pages/
│   └── Index.tsx              # Main app layout (mobile + desktop)
supabase/functions/
├── kiwi-stream/               # Proxies KiwiSDR WebSocket → SSE
├── elevenlabs-scribe-token/   # Generates Scribe auth tokens
└── translate/                 # AI-powered translation endpoint
```

## 📋 TODO / Roadmap

- [ ] Add more KiwiSDR receivers
- [ ] Add frequency presets for popular ham bands
- [ ] Support additional languages
- [ ] Support other speech-to-text and transcription LLMs
- [ ] Transcript export (text/SRT)
- [ ] Signal strength (RSSI) display
- [ ] Waterfall / spectrum visualization

<p align="center">
  <img src="https://github.com/user-attachments/assets/fe4548e8-27d2-4ccd-a7ee-c2568fde8b4a" width="700"><br><br>
  <img src="https://github.com/user-attachments/assets/e8755959-70cf-42c6-ac8f-c511f439cbdb" width="250">
  <img src="https://github.com/user-attachments/assets/9ab43784-1065-4806-9604-5165b6496a13" width="250">
</p>

## 👤 Authors

**F4DAN**

**Claude Code**

<a href='https://ko-fi.com/W7W51W6DP8' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi6.png?v=6' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>

## 📄 License

MIT

Copyright 2026 Christophe Bourguignat

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
