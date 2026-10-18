import { fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(__dirname, "../backend/server.js");

console.log("Starting TOS Red Flag Scanner from backend/server.js...");
const server = fork(serverPath, {
  stdio: "inherit"
});

server.on("exit", (code) => {
  process.exit(code || 0);
});
