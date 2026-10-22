/* workspace.js — sample project "agrosmart-dashboard": virtual file system. */
(function () {
  "use strict";

  var FILES = {};

  /* ---------------- src/api/client.ts ---------------- */
  FILES["src/api/client.ts"] = {
    language: "ts",
    content: [
      'const BASE_URL = import.meta.env.VITE_API_URL ?? "https://api.agrosmart.dev/v1";',
      "const TIMEOUT_MS = 8_000;",
      "",
      "export class ApiError extends Error {",
      "  constructor(",
      "    readonly status: number,",
      "    message: string,",
      "  ) {",
      '    super(message);',
      '    this.name = "ApiError";',
      "  }",
      "}",
      "",
      "async function request<T>(path: string, init?: RequestInit): Promise<T> {",
      "  const controller = new AbortController();",
      "  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);",
      "",
      "  try {",
      "    const res = await fetch(`${BASE_URL}${path}`, {",
      "      ...init,",
      "      signal: controller.signal,",
      '      headers: { "Content-Type": "application/json", ...init?.headers },',
      "    });",
      "",
      "    if (!res.ok) {",
      "      throw new ApiError(res.status, `GET ${path} failed (${res.status})`);",
      "    }",
      "    return (await res.json()) as T;",
      "  } catch (err) {",
      '    if (err instanceof DOMException && err.name === "AbortError") {',
      "      throw new ApiError(408, `Request timed out after ${TIMEOUT_MS}ms`);",
      "    }",
      "    throw err;",
      "  } finally {",
      "    clearTimeout(timer);",
      "  }",
      "}",
      "",
      "export const api = {",
      "  get: <T>(path: string) => request<T>(path),",
      "  post: <T>(path: string, body: unknown) =>",
      "    request<T>(path, { method: \"POST\", body: JSON.stringify(body) }),",
      "};",
      ""
    ].join("\n")
  };

  /* ---------------- src/components/Dashboard.tsx ---------------- */
  FILES["src/components/Dashboard.tsx"] = {
    language: "tsx",
    content: [
      'import { useMemo, useState } from "react";',
      'import { Activity, Droplets, ThermometerSun } from "lucide-react";',
      "",
      'import { useFarmData, type FarmReading } from "../hooks/useFarmData";',
      'import { Navbar } from "./Navbar";',
      'import { Sidebar } from "./Sidebar";',
      'import { StatsCard } from "./StatsCard";',
      "",
      'const RANGES = ["24h", "7d", "30d"] as const;',
      "type Range = (typeof RANGES)[number];",
      "",
      "const CARDS = [",
      '  { key: "temperature", label: "Avg. temperature", unit: "\u00b0C", Icon: ThermometerSun },',
      '  { key: "humidity", label: "Avg. humidity", unit: "%", Icon: Droplets },',
      '  { key: "moisture", label: "Soil moisture", unit: "%", Icon: Activity },',
      "] as const;",
      "",
      "export function Dashboard() {",
      '  const [range, setRange] = useState<Range>("24h");',
      "  const { data, isLoading, error, refresh } = useFarmData(range);",
      "  const stats = useMemo(() => averageBy(data), [data]);",
      "",
      "  return (",
      '    <div className="dashboard">',
      "      <Navbar />",
      '      <div className="dashboard__body">',
      "        <Sidebar />",
      '        <main className="dashboard__main">',
      '          <header className="dashboard__header">',
      "            <div>",
      "              <h1>Field overview</h1>",
      '              <p className="dashboard__sub">{data.length} sensors reporting</p>',
      "            </div>",
      '            <div className="range-picker" role="tablist" aria-label="Time range">',
      "              {RANGES.map((r) => (",
      "                <button",
      "                  key={r}",
      "                  role=\"tab\"",
      "                  aria-selected={r === range}",
      '                  className={r === range ? "range range--active" : "range"}',
      "                  onClick={() => setRange(r)}",
      "                >",
      "                  {r}",
      "                </button>",
      "              ))}",
      "            </div>",
      "          </header>",
      "",
      "          {error && (",
      '            <div className="banner banner--error" role="alert">',
      "              Failed to load farm data \u2014 {error}",
      '              <button className="banner__retry" onClick={() => void refresh()}>',
      "                Retry",
      "              </button>",
      "            </div>",
      "          )}",
      "",
      '          <section className="stats-grid" aria-busy={isLoading}>',
      "            {CARDS.map((card) => (",
      "              <StatsCard",
      "                key={card.key}",
      "                label={card.label}",
      "                value={stats[card.key]}",
      "                unit={card.unit}",
      "                isLoading={isLoading}",
      "              />",
      "            ))}",
      "          </section>",
      "        </main>",
      "      </div>",
      "    </div>",
      "  );",
      "}",
      "",
      "function averageBy(data: FarmReading[]) {",
      "  const avg = (pick: (r: FarmReading) => number) =>",
      "    data.length ? data.reduce((acc, r) => acc + pick(r), 0) / data.length : 0;",
      "",
      "  return {",
      "    temperature: avg((r) => r.temperature),",
      "    humidity: avg((r) => r.humidity),",
      "    moisture: avg((r) => r.moisture),",
      "  };",
      "}",
      ""
    ].join("\n")
  };

  /* ---------------- src/components/Navbar.tsx ---------------- */
  FILES["src/components/Navbar.tsx"] = {
    language: "tsx",
    content: [
      'import { Bell, RefreshCw, Search } from "lucide-react";',
      "",
      "interface NavbarProps {",
      "  onRefresh?: () => void;",
      "}",
      "",
      "export function Navbar({ onRefresh }: NavbarProps) {",
      "  return (",
      '    <header className="navbar">',
      '      <div className="navbar__brand">',
      '        <span className="navbar__logo" aria-hidden="true">AS</span>',
      "        <div>",
      "          <strong>AgroSmart</strong>",
      '          <small>Farm telemetry console</small>',
      "        </div>",
      "      </div>",
      "",
      '      <div className="navbar__search">',
      "        <Search size={14} />",
      "        <input",
      '          type="search"',
      '          placeholder="Search sensors, fields, reports\u2026"',
      '          aria-label="Search workspace"',
      "        />",
      "      </div>",
      "",
      '      <div className="navbar__actions">',
      "        <button",
      '          className="icon-btn"',
      '          aria-label="Refresh readings"',
      "          onClick={() => onRefresh?.()}",
      "        >",
      "          <RefreshCw size={15} />",
      "        </button>",
      "        <button className=\"icon-btn\" aria-label=\"Notifications\">",
      "          <Bell size={15} />",
      '          <span className="navbar__dot" aria-hidden="true" />',
      "        </button>",
      '        <span className="navbar__avatar" title="Vincent Iraguha">VI</span>',
      "      </div>",
      "    </header>",
      "  );",
      "}",
      ""
    ].join("\n")
  };

  /* ---------------- src/components/Sidebar.tsx ---------------- */
  FILES["src/components/Sidebar.tsx"] = {
    language: "tsx",
    content: [
      'import { CloudSun, Droplets, FileBarChart, Map, Radio, Tractor } from "lucide-react";',
      "",
      "const NAV = [",
      '  { label: "Fields", icon: Map }',
      '  { label: "Sensors", icon: Radio, badge: "18" },',
      '  { label: "Irrigation", icon: Droplets },',
      '  { label: "Machinery", icon: Tractor },',
      '  { label: "Weather", icon: CloudSun },',
      '  { label: "Reports", icon: FileBarChart },',
      "];",
      "",
      "export function Sidebar() {",
      "  return (",
      '    <nav className="sidebar-nav" aria-label="Workspace sections">',
      "      <ul>",
      "        {NAV.map(({ label, icon: Icon, badge }) => (",
      "          <li key={label}>",
      '            <button className="sidebar-nav__item">',
      "              <Icon size={16} />",
      "              <span>{label}</span>",
      "              {badge && <em className=\"badge\">{badge}</em>}",
      "            </button>",
      "          </li>",
      "        ))}",
      "      </ul>",
      "",
      '      <footer className="sidebar-nav__footer">',
      '        <span className="status-dot status-dot--ok" aria-hidden="true" />',
      "        <div>",
      "          <strong>Gateway online</strong>",
      "          <small>Packets flowing \u00b7 99.98% uptime</small>",
      "        </div>",
      "      </footer>",
      "    </nav>",
      "  );",
      "}",
      ""
    ].join("\n")
  };

  /* ---------------- src/components/StatsCard.tsx (working tree) ---------------- */
  FILES["src/components/StatsCard.tsx"] = {
    language: "tsx",
    content: [
      "/**",
      " * Compact KPI tile used across the dashboard grid.",
      " * Renders an animated skeleton while farm data is loading.",
      " */",
      'import { TrendingDown, TrendingUp } from "lucide-react";',
      "",
      'import { formatDelta, formatValue } from "../utils/format";',
      "",
      'import { Skeleton } from "./Skeleton";',
      "",
      "interface StatsCardProps {",
      "  label: string;",
      "  value: number;",
      "  delta?: number;",
      "  unit?: string;",
      "  isLoading?: boolean;",
      "}",
      "",
      "export function StatsCard({ label, value, delta, unit, isLoading }: StatsCardProps) {",
      "  const isUp = (delta ?? 0) >= 0;",
      "  const TrendIcon = isUp ? TrendingUp : TrendingDown;",
      "",
      "  if (isLoading) {",
      "    return (",
      '      <div className="stats-card stats-card--loading">',
      '        <Skeleton h={12} w="40%" />',
      '        <Skeleton h={24} w="70%" />',
      '        <Skeleton h={12} w="30%" />',
      "      </div>",
      "    );",
      "  }",
      "",
      "  return (",
      '    <div className="stats-card">',
      '      <span className="stats-card__label">{label}</span>',
      '      <span className="stats-card__value">',
      "        {formatValue(value)}",
      "        {unit && <small>{unit}</small>}",
      "      </span>",
      "      {delta !== undefined && (",
      '        <span className={isUp ? "delta delta--up" : "delta delta--down"}>',
      "          <TrendIcon size={14} />",
      "          {formatDelta(delta)}",
      "        </span>",
      "      )}",
      "    </div>",
      "  );",
      "}"
    ].join("\n"),
    head: [
      'import { TrendingDown, TrendingUp } from "lucide-react";',
      "",
      'import { formatDelta, formatValue } from "../utils/format";',
      "",
      "interface StatsCardProps {",
      "  label: string;",
      "  value: number;",
      "  delta?: number;",
      "  unit?: string;",
      "}",
      "",
      "export function StatsCard({ label, value, delta, unit }: StatsCardProps) {",
      "  const isUp = (delta ?? 0) >= 0;",
      "  const TrendIcon = isUp ? TrendingUp : TrendingDown;",
      "",
      "  return (",
      '    <div className="stats-card">',
      '      <span className="stats-card__label">{label}</span>',
      '      <span className="stats-card__value">',
      "        {formatValue(value)}",
      "        {unit && <small>{unit}</small>}",
      "      </span>",
      "      {delta !== undefined && (",
      '        <span className={isUp ? "delta delta--up" : "delta delta--down"}>',
      "          <TrendIcon size={14} />",
      "          {formatDelta(delta)}",
      "        </span>",
      "      )}",
      "    </div>",
      "  );",
      "}"
    ].join("\n")
  };

  /* ---------------- src/components/Skeleton.tsx (created by agent session) ---------------- */
  FILES["src/components/Skeleton.tsx"] = {
    language: "tsx",
    hidden: true,
    head: "",
    content: [
      "interface SkeletonProps {",
      "  h: number;",
      "  w: string;",
      "}",
      "",
      "export function Skeleton({ h, w }: SkeletonProps) {",
      "  return (",
      "    <span",
      '      className="skeleton"',
      "      style={{ height: h, width: w }}",
      "    />",
      "  );",
      "}"
    ].join("\n")
  };

  /* ---------------- src/hooks/useFarmData.ts (working tree) ---------------- */
  FILES["src/hooks/useFarmData.ts"] = {
    language: "ts",
    content: [
      'import { useCallback, useEffect, useState } from "react";',
      "",
      'import { api } from "../api/client";',
      "",
      "export interface FarmReading {",
      '  sensorId: string;',
      "  temperature: number;",
      "  humidity: number;",
      "  moisture: number;",
      "  recordedAt: string;",
      "}",
      "",
      'export function useFarmData(range: "24h" | "7d" | "30d" = "24h") {',
      "  const [data, setData] = useState<FarmReading[]>([]);",
      "  const [isLoading, setIsLoading] = useState(true);",
      '  const [error, setError] = useState<string | null>(null);',
      "",
      "  const refresh = useCallback(async () => {",
      "    setIsLoading(true);",
      "    setError(null);",
      "    try {",
      "      const readings = await api.get<FarmReading[]>(`/readings?range=${range}`);",
      "      setData(readings);",
      "    } catch (err) {",
      "      setError(err instanceof Error ? err.message : \"Request failed\");",
      "    } finally {",
      "      setIsLoading(false);",
      "    }",
      "  }, [range]);",
      "",
      "  useEffect(() => {",
      "    void refresh();",
      "  }, [refresh]);",
      "",
      "  return { data, isLoading, error, refresh };",
      "}"
    ].join("\n"),
    head: [
      'import { useCallback, useEffect, useState } from "react";',
      "",
      'import { api } from "../api/client";',
      "",
      "export interface FarmReading {",
      '  sensorId: string;',
      "  temperature: number;",
      "  humidity: number;",
      "  moisture: number;",
      "  recordedAt: string;",
      "}",
      "",
      'export function useFarmData(range: "24h" | "7d" | "30d" = "24h") {',
      "  const [data, setData] = useState<FarmReading[]>([]);",
      '  const [error, setError] = useState<string | null>(null);',
      "",
      "  const refresh = useCallback(async () => {",
      "    try {",
      "      const readings = await api.get<FarmReading[]>(`/readings?range=${range}`);",
      "      setData(readings);",
      "    } catch (err) {",
      "      setError(err instanceof Error ? err.message : \"Request failed\");",
      "    }",
      "  }, [range]);",
      "",
      "  useEffect(() => {",
      "    void refresh();",
      "  }, [refresh]);",
      "",
      "  return { data, error, refresh };",
      "}"
    ].join("\n")
  };

  /* ---------------- src/utils/format.ts ---------------- */
  FILES["src/utils/format.ts"] = {
    language: "ts",
    content: [
      'const compact = new Intl.NumberFormat("en-US", {',
      '  notation: "compact",',
      "  maximumFractionDigits: 1,",
      "});",
      "",
      'const percent = new Intl.NumberFormat("en-US", {',
      '  style: "percent",',
      '  signDisplay: "exceptZero",',
      "  maximumFractionDigits: 1,",
      "});",
      "",
      "/** 12400 -> \"12.4K\" */",
      "export function formatValue(value: number): string {",
      "  if (!Number.isFinite(value)) return \"\u2014\";",
      "  return compact.format(value);",
      "}",
      "",
      "/** 2.4 -> \"+2.4%\" */",
      "export function formatDelta(delta: number): string {",
      "  return percent.format(delta / 100);",
      "}",
      "",
      "/** ISO timestamp -> \"Mar 14, 09:32\" */",
      "export function formatDate(iso: string): string {",
      '  return new Intl.DateTimeFormat("en-US", {',
      '    month: "short",',
      '    day: "numeric",',
      '    hour: "2-digit",',
      '    minute: "2-digit",',
      "  }).format(new Date(iso));",
      "}",
      "",
      "/** 5700000 -> \"1h 35m\" */",
      "export function formatUptime(ms: number): string {",
      "  const minutes = Math.floor(ms / 60_000);",
      "  const hours = Math.floor(minutes / 60);",
      "  if (hours >= 1) return `${hours}h ${minutes % 60}m`;",
      "  return `${minutes}m`;",
      "}",
      "",
      "export function clamp(value: number, min: number, max: number): number {",
      "  return Math.min(Math.max(value, min), max);",
      "}",
      ""
    ].join("\n")
  };

  /* ---------------- src/App.tsx ---------------- */
  FILES["src/App.tsx"] = {
    language: "tsx",
    content: [
      'import { Dashboard } from "./components/Dashboard";',
      "",
      "/**",
      " * Application root. The dashboard is the only route today;",
      " * field-level routes land in v2 (see docs/roadmap.md).",
      " */",
      "export default function App() {",
      "  return (",
      '    <main className="app">',
      '      <header className="app__skip">',
      '        <a href="#dashboard">Skip to dashboard</a>',
      "      </header>",
      "      <Dashboard />",
      '      <footer className="app__foot">',
      "        AgroSmart \u00b7 farm telemetry, distilled \u00b7 v0.4.2",
      "      </footer>",
      "    </main>",
      "  );",
      "}",
      ""
    ].join("\n")
  };

  /* ---------------- src/main.tsx ---------------- */
  FILES["src/main.tsx"] = {
    language: "tsx",
    content: [
      'import { StrictMode } from "react";',
      'import { createRoot } from "react-dom/client";',
      "",
      'import App from "./App";',
      'import "./index.css";',
      "",
      'const container = document.getElementById("root");',
      'if (!container) throw new Error("Root element #root not found");',
      "",
      "createRoot(container).render(",
      "  <StrictMode>",
      "    <App />",
      "  </StrictMode>,",
      ");",
      ""
    ].join("\n")
  };

  /* ---------------- src/index.css ---------------- */
  FILES["src/index.css"] = {
    language: "css",
    content: [
      ":root {",
      "  --surface: #0f1412;",
      "  --surface-raised: #16201c;",
      "  --accent: #3fae7a;",
      "  --text: #e8f2ed;",
      "  --text-muted: #9db4aa;",
      "  --radius: 10px;",
      "}",
      "",
      "* {",
      "  box-sizing: border-box;",
      "}",
      "",
      "body {",
      '  margin: 0;',
      '  font-family: "Inter", system-ui, sans-serif;',
      "  background: var(--surface);",
      "  color: var(--text);",
      "}",
      "",
      ".dashboard {",
      "  display: grid;",
      "  grid-template-rows: 56px 1fr;",
      "  height: 100dvh;",
      "}",
      "",
      ".dashboard__body {",
      "  display: grid;",
      "  grid-template-columns: 232px 1fr;",
      "  min-height: 0;",
      "}",
      "",
      ".dashboard__main {",
      "  padding: 24px;",
      "  overflow-y: auto;",
      "}",
      "",
      ".dashboard__header {",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: space-between;",
      "}",
      "",
      ".dashboard__sub {",
      "  margin: 4px 0 0;",
      "  color: var(--text-muted);",
      "  font-size: 13px;",
      "}",
      "",
      ".range-picker {",
      "  display: inline-flex;",
      "  gap: 4px;",
      "  padding: 4px;",
      "  background: var(--surface-raised);",
      "  border-radius: 999px;",
      "}",
      "",
      ".range {",
      "  border: 0;",
      "  padding: 6px 14px;",
      "  border-radius: 999px;",
      "  background: transparent;",
      "  color: var(--text-muted);",
      "  cursor: pointer;",
      "}",
      "",
      ".range--active {",
      "  background: var(--accent);",
      "  color: #fff;",
      "}",
      ""
    ].join("\n")
  };

  /* ---------------- index.html ---------------- */
  FILES["index.html"] = {
    language: "html",
    content: [
      "<!doctype html>",
      '<html lang="en">',
      "  <head>",
      '    <meta charset="UTF-8" />',
      '    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />',
      '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      '    <meta name="theme-color" content="#0f1412" />',
      "    <title>AgroSmart Dashboard</title>",
      "  </head>",
      "  <body>",
      '    <div id="root"></div>',
      '    <script type="module" src="/src/main.tsx"></script>',
      "  </body>",
      "</html>",
      ""
    ].join("\n")
  };

  /* ---------------- package.json ---------------- */
  FILES["package.json"] = {
    language: "json",
    content: [
      "{",
      '  "name": "agrosmart-dashboard",',
      '  "private": true,',
      '  "version": "0.4.2",',
      '  "type": "module",',
      '  "scripts": {',
      '    "dev": "vite",',
      '    "build": "tsc -b && vite build",',
      '    "preview": "vite preview",',
      '    "test": "vitest run",',
      '    "format": "prettier --write ."',
      "  },",
      '  "dependencies": {',
      '    "lucide-react": "^0.462.0",',
      '    "react": "^19.0.0",',
      '    "react-dom": "^19.0.0",',
      '    "recharts": "^2.13.3"',
      "  },",
      '  "devDependencies": {',
      '    "@testing-library/react": "^16.1.0",',
      '    "@types/react": "^19.0.0",',
      '    "@types/react-dom": "^19.0.0",',
      '    "@vitejs/plugin-react": "^4.3.4",',
      '    "jsdom": "^25.0.1",',
      '    "prettier": "^3.4.2",',
      '    "typescript": "~5.7.2",',
      '    "vite": "^6.0.3",',
      '    "vitest": "^2.1.8"',
      "  }",
      "}",
      ""
    ].join("\n")
  };

  /* ---------------- tsconfig.json ---------------- */
  FILES["tsconfig.json"] = {
    language: "json",
    content: [
      "{",
      '  "compilerOptions": {',
      '    "target": "ES2022",',
      '    "lib": ["ES2022", "DOM", "DOM.Iterable"],',
      '    "module": "ESNext",',
      '    "moduleResolution": "bundler",',
      '    "jsx": "react-jsx",',
      '    "strict": true,',
      '    "noUnusedLocals": true,',
      '    "noUnusedParameters": true,',
      '    "noFallthroughCasesInSwitch": true,',
      '    "verbatimModuleSyntax": true,',
      '    "skipLibCheck": true,',
      '    "isolatedModules": true,',
      '    "noEmit": true,',
      '    "types": ["vite/client"]',
      "  },",
      '  "include": ["src"]',
      "}",
      ""
    ].join("\n")
  };

  /* ---------------- README.md ---------------- */
  FILES["README.md"] = {
    language: "md",
    content: [
      "# AgroSmart Dashboard",
      "",
      "Farm telemetry, distilled. Real-time sensor readings, irrigation state",
      "and machinery overview for the Rubona pilot fields.",
      "",
      "![React](https://img.shields.io/badge/React-19-61dafb) ![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6) ![Vite](https://img.shields.io/badge/Vite-6-646cff) ![License](https://img.shields.io/badge/License-MIT-3fae7a)",
      "",
      "## Quick start",
      "",
      "```bash",
      "pnpm install",
      "cp .env.example .env.local",
      "pnpm dev",
      "```",
      "",
      "The dev server starts on `http://localhost:5173`.",
      "",
      "## Scripts",
      "",
      "| Command         | Description                    |",
      "| --------------- | ------------------------------ |",
      "| `pnpm dev`      | Start the Vite dev server      |",
      "| `pnpm build`    | Type-check and bundle for prod |",
      "| `pnpm test`     | Run the vitest suite           |",
      "| `pnpm format`   | Prettier pass over the repo    |",
      "",
      "## Architecture",
      "",
      "- `src/api/client.ts` \u2014 typed fetch wrapper with timeouts and `ApiError`",
      "- `src/hooks/useFarmData.ts` \u2014 readings + loading/error state for the grid",
      "- `src/components/` \u2014 presentational tiles, navbar and section nav",
      "- `src/utils/format.ts` \u2014 `Intl`-based number, date and uptime helpers",
      "",
      "## Data contract",
      "",
      "Sensors publish `FarmReading` payloads every 60 seconds:",
      "",
      "```json",
      "{",
      '  "sensorId": "RBN-041",',
      '  "temperature": 23.4,',
      '  "humidity": 61,',
      '  "moisture": 38.2,',
      '  "recordedAt": "2026-10-22T09:32:00Z"',
      "}",
      "```",
      "",
      "MIT \u00a9 IRAGUHA Vincent",
      ""
    ].join("\n")
  };

  /* ---------------- .env.example ---------------- */
  FILES[".env.example"] = {
    language: "env",
    content: [
      "# AgroSmart Dashboard \u2014 local development environment",
      "# Copy to .env.local and fill in real values.",
      "",
      "VITE_API_URL=https://api.agrosmart.dev/v1",
      "VITE_WS_URL=wss://ws.agrosmart.dev/telemetry",
      "VITE_MAP_TILE_URL=https://tiles.agrosmart.dev/{z}/{x}/{y}.png",
      "VITE_FEATURE_IRRIGATION_PLANNER=true",
      ""
    ].join("\n")
  };

  /* ---------------- .gitignore ---------------- */
  FILES[".gitignore"] = {
    language: "gitignore",
    content: [
      "# Dependencies",
      "node_modules/",
      "",
      "# Build output",
      "dist/",
      "dist-ssr/",
      "*.local",
      "",
      "# Logs",
      "logs/",
      "*.log",
      "npm-debug.log*",
      "",
      "# Editor",
      ".vscode/*",
      "!.vscode/extensions.json",
      "!.vscode/settings.json",
      ".idea/",
      ".DS_Store",
      "",
      "# Env",
      ".env",
      ".env.*",
      "!.env.example",
      ""
    ].join("\n")
  };

  /* ---------------- public/favicon.svg ---------------- */
  FILES["public/favicon.svg"] = {
    language: "html",
    content: [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">',
      '  <rect width="32" height="32" rx="8" fill="#3fae7a" />',
      '  <path d="M16 7l2.4 6.6L25 16l-6.6 2.4L16 25l-2.4-6.6L7 16l6.6-2.4z" fill="#fff" />',
      "</svg>",
      ""
    ].join("\n")
  };

  /* ---------------- .vscode/settings.json ---------------- */
  FILES[".vscode/settings.json"] = {
    language: "json",
    content: [
      "{",
      '  "editor.formatOnSave": true,',
      '  "editor.defaultFormatter": "esbenp.prettier-vscode",',
      '  "editor.tabSize": 2,',
      '  "files.eol": "\\n",',
      '  "typescript.preferences.importModuleSpecifier": "relative",',
      '  "workbench.colorTheme": "AgroSmart Night"',
      "}",
      ""
    ].join("\n")
  };

  /* ---------------- .vscode/extensions.json ---------------- */
  FILES[".vscode/extensions.json"] = {
    language: "json",
    content: [
      "{",
      '  "recommendations": [',
      '    "esbenp.prettier-vscode",',
      '    "dbaeumer.vscode-eslint",',
      '    "bradlc.vscode-tailwindcss"',
      "  ]",
      "}",
      ""
    ].join("\n")
  };

  /* ================= public API ================= */
  var revealed = {};

  function isVisible(path) {
    return !!FILES[path] && (!FILES[path].hidden || revealed[path]);
  }

  function buildTree() {
    var root = { name: "", path: "", children: {}, dirs: [], files: [] };
    Object.keys(FILES).forEach(function (path) {
      if (!isVisible(path)) return;
      var parts = path.split("/");
      var node = root;
      parts.forEach(function (part, i) {
        var isFile = i === parts.length - 1;
        if (isFile) {
          node.files.push({ name: part, path: path });
        } else {
          if (!node.children[part]) {
            var dir = { name: part, path: parts.slice(0, i + 1).join("/"), children: {}, dirs: [], files: [] };
            node.children[part] = dir;
            node.dirs.push(dir);
          }
          node = node.children[part];
        }
      });
    });
    (function sort(n) {
      n.dirs.sort(function (a, b) { return a.name.localeCompare(b.name); });
      n.files.sort(function (a, b) { return a.name.localeCompare(b.name); });
      n.dirs.forEach(sort);
    })(root);
    return root;
  }

  window.WS = {
    projectName: "agrosmart-dashboard",
    files: FILES,
    isVisible: isVisible,
    content: function (path) { return FILES[path] ? FILES[path].content : null; },
    head: function (path) { return FILES[path] ? (FILES[path].head != null ? FILES[path].head : FILES[path].content) : null; },
    language: function (path) { return FILES[path] ? FILES[path].language : "txt"; },
    setContent: function (path, content) { if (FILES[path]) FILES[path].content = content; },
    reveal: function (path) { revealed[path] = true; },
    buildTree: buildTree,
    visiblePaths: function () { return Object.keys(FILES).filter(isVisible); }
  };
})();
