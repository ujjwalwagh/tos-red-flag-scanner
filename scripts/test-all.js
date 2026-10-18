import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(__dirname, "../backend");

console.log("Running all tests in backend/tests/*.test.js...");
const runner = spawn(process.execPath, ["--test", "tests/*.test.js"], {
  cwd: backendDir,
  stdio: "inherit"
});

runner.on("exit", (code) => {
  if (code === 0) {
    console.log("All tests passed successfully!");
  }
  process.exit(code || 0);
});
