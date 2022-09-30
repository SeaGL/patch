import { readFileSync } from "fs";
import { LogLevel, LogService } from "matrix-bot-sdk";
import Logger from "./lib/Logger.js";
import Patch from "./lib/Patch.js";
import { parsePlan } from "./lib/Plan.js";
import { env } from "./lib/utilities.js";

LogService.setLogger(new Logger());
LogService.setLevel(LogLevel.fromString(process.env["LOG_LEVEL"]!));
LogService.muteModule("MatrixHttpClient");
LogService.muteModule("Metrics");

const config = {
  accessToken: env("MATRIX_ACCESS_TOKEN"),
  baseUrl: env("MATRIX_BASE_URL"),
  plan: parsePlan(readFileSync("./data/plan.yml", { encoding: "utf8" })),
};

await new Patch(config).start();
