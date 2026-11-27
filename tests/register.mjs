import { register } from "node:module";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";

// Load .env.local first (local development overrides), falling back to .env
dotenv.config({ path: ".env.local" });
dotenv.config();

register("./loader.mjs", pathToFileURL("./tests/"));

