const fs = require("fs");
const path = require("path");
const { TextDecoder } = require("util");

const ROOT = process.cwd();
const SOURCE_DIR = path.join(ROOT, "종목정보파일");
const OUTPUT_KR = path.join(ROOT, "src", "lib", "universe", "kr.json");
const OUTPUT_US = path.join(ROOT, "src", "lib", "universe", "us.json");
const OUTPUT_US_EXCHANGE_MAP = path.join(
  ROOT,
  "src",
  "lib",
  "universe",
  "us_exchange_map.json"
);
const OUTPUT_KR_NAME_MAP = path.join(
  ROOT,
  "src",
  "lib",
  "universe",
  "kr_name_map.json"
);

const krFiles = [
  "kospi_code.mst",
  "kosdaq_code.mst",
  "nxt_kospi_code.mst",
  "nxt_kosdaq_code.mst",
];

const usFiles = ["NASMST.COD", "NYSMST.COD", "AMSMST.COD"];

const loadLinesLatin1 = (filePath) => {
  const data = fs.readFileSync(filePath);
  return data.toString("latin1").split("\n");
};

const loadLinesEucKr = (filePath) => {
  const data = fs.readFileSync(filePath);
  const decoder = new TextDecoder("euc-kr");
  return decoder.decode(data).split("\n");
};

const normalizeName = (value) =>
  value
    .toUpperCase()
    .replace(/[\s\(\)\[\]\.\-·]/g, "")
    .trim();

const parseKrLine = (line) => {
  if (line.length < 18) return null;
  const code = line.slice(0, 6);
  if (!/^\d{6}$/.test(code)) return null;
  const rest = line.slice(6).trimStart();
  if (rest.length < 12) return null;
  const nameRaw = rest.slice(12);
  const name = nameRaw.split(/\s{2,}/)[0].trim();
  if (!name) return null;
  return { code, name };
};

const buildKrUniverse = () => {
  const set = new Set();
  const nameMap = {};
  for (const file of krFiles) {
    const filePath = path.join(SOURCE_DIR, file);
    if (!fs.existsSync(filePath)) continue;
    const lines = loadLinesEucKr(filePath);
    for (const line of lines) {
      const parsed = parseKrLine(line);
      if (!parsed) continue;
      set.add(parsed.code);
      const key = normalizeName(parsed.name);
      if (key && !nameMap[key]) {
        nameMap[key] = parsed.code;
      }
    }
  }
  return { tickers: Array.from(set).sort(), nameMap };
};

const exchangeForFile = (file) => {
  if (file.startsWith("NAS")) return "NAS";
  if (file.startsWith("NYS")) return "NYS";
  if (file.startsWith("AMS")) return "AMS";
  return "NAS";
};

const buildUsUniverse = () => {
  const set = new Set();
  const exchangeMap = {};
  for (const file of usFiles) {
    const filePath = path.join(SOURCE_DIR, file);
    if (!fs.existsSync(filePath)) continue;
    const lines = loadLinesLatin1(filePath);
    for (const line of lines) {
      if (!line) continue;
      const parts = line.split("\t");
      if (parts.length < 5) continue;
      const symbol = (parts[4] || "").trim().toUpperCase();
      if (!symbol) continue;
      if (/^[A-Z0-9.]+$/.test(symbol)) {
        set.add(symbol);
        if (!exchangeMap[symbol]) {
          exchangeMap[symbol] = exchangeForFile(file);
        }
      }
    }
  }
  return { tickers: Array.from(set).sort(), exchangeMap };
};

if (!fs.existsSync(SOURCE_DIR)) {
  console.error(`Source folder not found: ${SOURCE_DIR}`);
  process.exit(1);
}

const kr = buildKrUniverse();
const us = buildUsUniverse();

fs.mkdirSync(path.dirname(OUTPUT_KR), { recursive: true });
fs.writeFileSync(OUTPUT_KR, JSON.stringify(kr.tickers, null, 2));
fs.writeFileSync(OUTPUT_US, JSON.stringify(us.tickers, null, 2));
fs.writeFileSync(OUTPUT_US_EXCHANGE_MAP, JSON.stringify(us.exchangeMap, null, 2));
fs.writeFileSync(OUTPUT_KR_NAME_MAP, JSON.stringify(kr.nameMap, null, 2));

console.log(`KR tickers: ${kr.tickers.length}`);
console.log(`US tickers: ${us.tickers.length}`);
console.log("Universe files updated.");
