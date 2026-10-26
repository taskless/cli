import process from "node:process";
import { join } from "node:path";
process.exitCode = 1;
console.log(join(process.cwd(), "dist"));
