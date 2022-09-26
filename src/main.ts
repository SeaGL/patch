import { readFile } from "fs/promises";
import Patch from "./lib/Patch.js";
import { env } from "./lib/utilities.js";

const config = {
  accessToken: env("MATRIX_ACCESS_TOKEN"),
  baseUrl: env("MATRIX_BASE_URL"),
  userId: env("MATRIX_USER_ID"),

  plan: JSON.parse(await readFile("./data/plan.json", { encoding: "utf-8" })), // Mock
};

await new Patch(config).start();
