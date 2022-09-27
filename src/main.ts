import { readFileSync } from "fs";
import Patch from "./lib/Patch.js";
import { parsePlan } from "./lib/Plan.js";
import { env } from "./lib/utilities.js";

const config = {
  accessToken: env("MATRIX_ACCESS_TOKEN"),
  baseUrl: env("MATRIX_BASE_URL"),
  plan: parsePlan(readFileSync("./data/plan.yml", { encoding: "utf8" })),
};

await new Patch(config).start();
