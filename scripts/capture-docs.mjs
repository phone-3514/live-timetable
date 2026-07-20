import { spawn } from "node:child_process";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import process from "node:process";
import { chromium } from "playwright";

const BASE_URL = "http://127.0.0.1:5173";
const OUTPUT_DIR = new URL("../docs/screenshots/", import.meta.url);
const VIEWER_CODE = "DOCSDEMO";
// The app validates resolved room IDs as eight lower-case alphanumerics.
// Keep the requested human-readable cache alias as well, but use this valid
// fictional ID for the actual in-app resolution. Neither ID exists remotely.
const ROOM_ID = "docsdemo";
const ROOM_ALIAS = "docs-demo-room";
const FIXED_B = "2026-08-23T13:45:00+09:00";
const FIXED_C = "2026-08-23T14:20:00+09:00";
const FIXED_TIMESTAMP = Date.parse("2026-08-20T12:00:00+09:00");

const expectedFiles = [
  "CAP-01-viewer-timetable-mobile.png",
  "CAP-02-current-performance-mobile.png",
  "CAP-03-digital-pamphlet-mobile.png",
  "CAP-04-timetable-editor-desktop.png",
  "CAP-05-command-center-desktop.png",
  "CAP-06-command-center-mobile.png",
  "CAP-07-venue-screen-desktop.png",
];

const performers = [
  ["neon-harbor", "Neon Harbor", "13:00", "13:25"],
  ["blue-canvas", "Blue Canvas", "13:35", "14:00"],
  ["moonlit-echo", "Moonlit Echo", "14:10", "14:35"],
  ["paper-satellites", "Paper Satellites", "14:45", "15:10"],
  ["amber-signal", "Amber Signal", "15:20", "15:45"],
  ["velvet-transit", "Velvet Transit", "15:55", "16:20"],
  ["northbound", "Northbound", "16:30", "16:55"],
  ["last-scene", "Last Scene", "17:05", "17:30"],
];

function makeBand([id, name]) {
  return {
    id,
    name,
    members: [],
    setlist: [],
    desiredTime: "",
    ngTime: "",
    allowedDayIds: [],
    hasSync: false,
    hasKeyboard: false,
    gearTags: [],
    raw: name,
  };
}

function makeSlot([id, , startTime, endTime], delayMinutes = 0, shiftMinutes = 0) {
  const shift = (value) => {
    if (!shiftMinutes) return value;
    const [hour, minute] = value.split(":").map(Number);
    const total = hour * 60 + minute + shiftMinutes;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  };
  return {
    id: `slot-${id}`,
    bandId: id,
    customLabel: null,
    customDurationMinutes: null,
    startTimeOverride: shiftMinutes ? shift(startTime) : null,
    delayMinutes,
    startTime: shift(startTime),
    endTime: shift(endTime),
  };
}

function makeFixture(state) {
  const delayed = state === "C";
  const slots = performers.map((performer, index) =>
    makeSlot(performer, delayed && index >= 2 ? 5 : 0, delayed && index >= 2 ? 5 : 0),
  );
  const bands = performers.map(makeBand);
  const days = [{
    id: "showcase-day",
    label: "SHOWCASE DAY",
    date: "2026-08-23",
    settings: { startTime: "13:00", performanceMinutes: 25, transitionMinutes: 10 },
    slots,
  }];
  const eventInfo = {
    liveName: "LIVE TIMETABLE SHOWCASE 2026",
    venue: "Studio Hall",
    organizationName: "Eight bands. One connected stage.",
  };
  const progress = {
    dayId: "showcase-day",
    slotId: delayed ? "slot-moonlit-echo" : "slot-blue-canvas",
    phase: "performing",
    updatedAt: delayed ? Date.parse(FIXED_C) : Date.parse(FIXED_B),
    updatedBy: "Documentation Demo",
    logs: [],
  };
  const publicDoc = {
    ...eventInfo,
    bands: bands.map(({ id, name, members, setlist }) => ({ id, name, members, setlist })),
    days: days.map(({ id, label, date, slots: publicSlots }) => ({
      id,
      label,
      date,
      slots: publicSlots.map(({ id: slotId, bandId, customLabel, customDurationMinutes, startTime, endTime, delayMinutes }) => ({
        id: slotId,
        bandId,
        customLabel,
        customDurationMinutes,
        startTime,
        endTime,
        delayMinutes,
      })),
    })),
    publishedAt: FIXED_TIMESTAMP,
  };
  return { bands, days, eventInfo, progress, publicDoc };
}

function persisted(state) {
  return JSON.stringify({ state, version: 0 });
}

async function waitForServer(child) {
  // This repository's Vite config can take roughly 25 seconds to load on a
  // cold cache, followed by dependency discovery. Leave enough headroom for
  // that legitimate startup work while still failing clearly if it stalls.
  const deadline = Date.now() + 120_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Vite exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Vite did not become ready: ${lastError?.message ?? "timeout"}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function newPage(browser, { viewport, state = "B", viewer = false }) {
  const fixture = makeFixture(state);
  const context = await browser.newContext({ viewport, locale: "ja-JP", timezoneId: "Asia/Tokyo", colorScheme: "dark" });
  await context.addInitScript(({ fixtureData, viewerCode, roomId, roomAlias, fixedTimestamp, fixedNow, isViewer }) => {
    const wrap = (value) => JSON.stringify({ state: value, version: 0 });
    localStorage.setItem("live-timetable-app", wrap({
      bands: fixtureData.bands,
      days: fixtureData.days,
      venueHours: { openTime: "13:00", closeTime: "18:00" },
      eventInfo: fixtureData.eventInfo,
      lastDeleted: null,
    }));
    localStorage.setItem("live-timetable-progress", wrap(fixtureData.progress));
    localStorage.setItem("live-timetable-ui", wrap({ activeTab: "timetable" }));
    localStorage.setItem("live-timetable-local-event-owner", "true");
    const cache = JSON.stringify({ doc: fixtureData.publicDoc, cachedAt: fixedTimestamp });
    localStorage.setItem(`live-timetable-pamphlet-cache-${roomId}`, cache);
    localStorage.setItem(`live-timetable-pamphlet-cache-${roomAlias}`, cache);
    if (isViewer) {
      // PublicPamphletRoot performs a one-time smooth auto-focus. Captures
      // own their scroll position explicitly, so suppress that browser API
      // only inside this isolated documentation context.
      Element.prototype.scrollIntoView = function captureScrollIntoView() {};
      const resolutionKey = `live-timetable-viewer-resolution-${viewerCode}`;
      sessionStorage.setItem(resolutionKey, JSON.stringify({
        organizerRoomId: roomId,
        // This hand-off cache has a deliberately short TTL, so use the same
        // deterministic instant that the page clock will receive.
        savedAt: fixedNow,
      }));
      // The hand-off is normally consumed once. React StrictMode may mount
      // this route twice in development, so retain only this fictional key
      // for the lifetime of the isolated capture context.
      const removeItem = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function patchedRemoveItem(key) {
        if (key === resolutionKey) return;
        return removeItem.call(this, key);
      };
    }
  }, {
    fixtureData: fixture,
    viewerCode: VIEWER_CODE,
    roomId: ROOM_ID,
    roomAlias: ROOM_ALIAS,
    fixedTimestamp: FIXED_TIMESTAMP,
    fixedNow: Date.parse(state === "C" ? FIXED_C : FIXED_B),
    isViewer: viewer,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(120_000);
  await page.clock.install({ time: new Date(state === "C" ? FIXED_C : FIXED_B) });
  return { context, page };
}

async function stabilize(page) {
  await page.addStyleTag({ content: `
    *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
    html { scroll-behavior: auto !important; }
    :focus { outline: none !important; }
  ` });
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForFunction(() => document.readyState === "complete");
  // Page timers are intentionally frozen by Playwright Clock. Stabilization
  // therefore waits in Node rather than advancing the application clock.
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function screenshot(page, fileName) {
  await stabilize(page);
  await page.screenshot({ path: new URL(fileName, OUTPUT_DIR).pathname, fullPage: false });
}

async function withCapture(browser, options, run) {
  const { context, page } = await newPage(browser, options);
  try {
    await run(page);
  } finally {
    await context.close();
  }
}

async function openViewer(page, suffix = "") {
  await page.goto(`${BASE_URL}/${VIEWER_CODE}/public${suffix}`, { waitUntil: "domcontentloaded" });
  try {
    await page.getByRole("heading", { name: "LIVE TIMETABLE SHOWCASE 2026" }).waitFor({ state: "visible", timeout: 15_000 });
  } catch (error) {
    const diagnostic = (await page.locator("body").innerText()).slice(0, 800).replaceAll("\n", " | ");
    const storage = await page.evaluate(() => ({
      local: Object.keys(localStorage).sort(),
      session: Object.keys(sessionStorage).sort(),
      now: Date.now(),
    }));
    throw new Error(`Viewer fixture did not render at ${page.url()}. Body: ${diagnostic}. Storage: ${JSON.stringify(storage)}`, { cause: error });
  }
  if (!suffix.includes("mode=screen")) {
    await page.locator("#pamphlet-slot-slot-blue-canvas").waitFor({ state: "attached" });
  }
}

async function openOrganizer(page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "運営スタッフはこちら" }).click();
  await page.getByRole("button", { name: "前回のイベントを再開" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "前回のイベントを再開" }).click();
  await page.getByRole("heading", { name: "Live Timetable" }).waitFor({ state: "visible" });
}

async function runCaptures(browser) {
  await withCapture(browser, { viewport: { width: 390, height: 844 }, viewer: true }, async (page) => {
    await openViewer(page);
    const current = page.locator("#pamphlet-slot-slot-blue-canvas");
    await current.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -180));
    await screenshot(page, expectedFiles[0]);
  });

  await withCapture(browser, { viewport: { width: 390, height: 844 }, viewer: true }, async (page) => {
    await openViewer(page);
    const current = page.locator("#pamphlet-slot-slot-blue-canvas");
    await current.waitFor({ state: "visible" });
    await current.getByText(/出演中！/).waitFor({ state: "visible" });
    await stabilize(page);
    await page.evaluate(() => {
      const root = document.getElementById("root");
      if (!root) throw new Error("Missing #root scroll container");
      root.scrollTop = 190;
      root.scrollLeft = 0;
    });
    await page.waitForFunction(() => (document.getElementById("root")?.scrollTop ?? 0) > 0);
    await screenshot(page, expectedFiles[1]);
  });

  await withCapture(browser, { viewport: { width: 390, height: 844 }, viewer: true }, async (page) => {
    await openViewer(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole("heading", { name: /SHOWCASE DAY/ }).waitFor({ state: "visible" });
    await screenshot(page, expectedFiles[2]);
  });

  await withCapture(browser, { viewport: { width: 1440, height: 1000 } }, async (page) => {
    await openOrganizer(page);
    await page.getByText("Neon Harbor", { exact: true }).first().waitFor({ state: "visible" });
    await screenshot(page, expectedFiles[3]);
  });

  await withCapture(browser, { viewport: { width: 1440, height: 1000 }, state: "C" }, async (page) => {
    await openOrganizer(page);
    await page.getByRole("button", { name: /当日運営を開始/ }).click();
    await page.getByLabel("イベント指揮卓").waitFor({ state: "visible" });
    await page.getByText("Moonlit Echo", { exact: true }).first().waitFor({ state: "visible" });
    await page.getByText("5分遅れ", { exact: true }).first().waitFor({ state: "visible" });
    await screenshot(page, expectedFiles[4]);
  });

  await withCapture(browser, { viewport: { width: 390, height: 844 } }, async (page) => {
    await openOrganizer(page);
    await page.getByRole("button", { name: /当日運営を開始/ }).click();
    await page.getByLabel("イベント指揮卓").waitFor({ state: "visible" });
    await page.getByText("Blue Canvas", { exact: true }).first().waitFor({ state: "visible" });
    await page.getByRole("button", { name: /出演を終了/ }).first().waitFor({ state: "visible" });
    await page.locator('[aria-label="ステージ進行リモコン"] > div').nth(1).evaluate((element) => { element.scrollTop = 0; });
    await screenshot(page, expectedFiles[5]);
  });

  await withCapture(browser, { viewport: { width: 1440, height: 900 }, viewer: true }, async (page) => {
    await openViewer(page, "?mode=screen");
    await page.getByText("現在出演中", { exact: true }).waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "Blue Canvas" }).waitFor({ state: "visible" });
    await page.getByText("Moonlit Echo", { exact: true }).waitFor({ state: "visible" });
    await screenshot(page, expectedFiles[6]);
  });
}

async function validateOutputs() {
  const actual = (await readdir(OUTPUT_DIR)).filter((name) => name.toLowerCase().endsWith(".png")).sort();
  const expected = [...expectedFiles].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected exactly seven PNGs. Found: ${actual.join(", ") || "none"}`);
  }
  for (const fileName of expectedFiles) {
    const details = await stat(new URL(fileName, OUTPUT_DIR));
    if (details.size === 0) throw new Error(`${fileName} is empty`);
  }
}

let server;
let browser;
try {
  await mkdir(OUTPUT_DIR, { recursive: true });
  for (const name of await readdir(OUTPUT_DIR)) {
    if (name.toLowerCase().endsWith(".png")) await rm(new URL(name, OUTPUT_DIR));
  }
  server = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1"], {
    cwd: new URL("../", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });
  server.stdout.on("data", (chunk) => process.stdout.write(`[vite] ${chunk}`));
  server.stderr.on("data", (chunk) => process.stderr.write(`[vite] ${chunk}`));
  await waitForServer(server);
  browser = await chromium.launch({ headless: true });
  await runCaptures(browser);
  await validateOutputs();
  console.log(`Captured ${expectedFiles.length} documentation screenshots in docs/screenshots/.`);
} finally {
  await browser?.close();
  await stopServer(server);
}
