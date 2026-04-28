export interface KiwiServer {
  id: string;
  name: string;
  host: string;
  port: number;
  lat: number;
  lng: number;
}

export const KIWI_SERVERS: KiwiServer[] = [
  {
    id: "sa4bna",
    name: "SA4BNA",
    host: "sa4bna.hopto.org",
    port: 8073,
    lat: 59.610583, // 59°36'38.1"N
    lng: 12.525306, // 12°31'31.1"E
  },
  {
    id: "f4joy",
    name: "F4JOY",
    host: "f4joy.ddns.net",
    port: 8073,
    lat: 45.269722, // 45°16'11.0"N
    lng: 2.924139, // 2°55'26.9"E
  },
  {
    id: "lu5lcr",
    name: "LU5LCR",
    host: "22200.proxy.kiwisdr.com",
    port: 8073,
    lat: -27.304438,
    lng: -58.553839,
  },
  {
    id: "Himalayas",
    name: "Himalayas",
    host: "ktm.twrmon.net",
    port: 8073,
    lat: 27.73,
    lng: 85.30111,
  },
  {
    id: "Thessaloniki",
    name: "Thessaloniki",
    host: "elektrongr.ddns.net",
    port: 8073,
    lat: 40.623552,
    lng: 22.969851,
  },
  {
    id: "la6lu",
    name: "LA6LU",
    host: "la6lukiwisdrth.ddns.net",
    port: 8073,
    lat: 12.79,
    lng: 99.97,
  },
  {
    id: "w4bf",
    name: "W4BF",
    host: "21470.proxy2.kiwisdr.com",
    port: 8073,
    lat: 28.087838,
    lng: -80.69581,
  },
  {
    id: "kr6la",
    name: "KR6LA",
    host: "kr6la.proxy.kiwisdr.com",
    port: 8073,
    lat: 40.62,
    lng: -121.92,
  },
  {
    id: "ja5fp",
    name: "JA5FP",
    host: "ja5fp2.proxy.kiwisdr.com",
    port: 8073,
    lat: 35.667916,
    lng: 140.171996,
  },
  {
    id: "et3aa",
    name: "ET3AA",
    host: "21114.proxy.kiwisdr.com",
    port: 8073,
    lat: 9.040892,
    lng: 38.76379,
  },
  {
    id: "wk4gfr",
    name: "VK4GFR",
    host: "21982.proxy2.kiwisdr.com",
    port: 8073,
    lat: -19.398133,
    lng: 146.708223,
  },
  {
    id: "w3hfu",
    name: "W3HFU",
    host: "sdr.hfunderground.com",
    port: 8075,
    lat: 39.704, // 39°42'14.4"N
    lng: -76.974, // 76°58'26.4"W
  },
];

export const LANGUAGES = [
  { code: "EN", label: "English" },
  { code: "FR", label: "Français" },
  { code: "DE", label: "Deutsch" },
  { code: "ES", label: "Español" },
  { code: "PT", label: "Português" },
  { code: "IT", label: "Italiano" },
  { code: "NL", label: "Nederlands" },
  { code: "SV", label: "Svenska" },
  { code: "JA", label: "日本語" },
  { code: "ZH", label: "简体中文" },
  { code: "ZH-TW", label: "繁體中文" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface TranscriptSegment {
  id: string;
  text: string;
  timestamp: number;
}
