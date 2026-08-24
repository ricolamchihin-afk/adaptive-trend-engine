import { readFileSync } from "node:fs";
import { startAutoLoop } from "./autoRunner";

function loadDotEnv(file: string) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq);
      let value = trimmed.slice(eq + 1);
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // file optional
  }
}

loadDotEnv(".env");
loadDotEnv(".env.local");
startAutoLoop();
console.log("Adaptive Trend Engine 4h daemon running. Ctrl-C to stop.");
