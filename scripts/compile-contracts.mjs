// Compiles contracts/*.sol with solc-js (npm i -D solc@0.8.28 @openzeppelin/contracts@5) into contracts/artifacts.json.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const solc = require("solc");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sources = {};
for (const name of ["FaucetToken.sol", "VaultoVault.sol"]) sources[name] = { content: readFileSync(join(root, "contracts", name), "utf8") };
function findImports(path) {
  for (const c of [join(root, "node_modules", path), join(root, "contracts", path)]) if (existsSync(c)) return { contents: readFileSync(c, "utf8") };
  return { error: `File not found: ${path}` };
}
const input = { language: "Solidity", sources, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } };
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
for (const e of output.errors ?? []) console.error(e.formattedMessage);
if ((output.errors ?? []).some((e) => e.severity === "error")) process.exit(1);
const artifacts = {};
for (const [file, contracts] of Object.entries(output.contracts)) for (const [name, c] of Object.entries(contracts)) if (!file.startsWith("@openzeppelin")) artifacts[name] = { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` };
mkdirSync(join(root, "contracts"), { recursive: true });
writeFileSync(join(root, "contracts", "artifacts.json"), JSON.stringify(artifacts, null, 1));
console.log("compiled:", Object.keys(artifacts).join(", "));
