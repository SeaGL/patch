import { readFileSync } from "fs";
import { Settings } from "luxon";
import { LogLevel, LogService } from "matrix-bot-sdk";
import Logger from "./lib/Logger.js";
import Patch from "./Patch.js";
import { parsePlan } from "./lib/Plan.js";
import { env } from "./lib/utilities.js";

const plan = parsePlan(readFileSync("./data/plan.yml", { encoding: "utf8" }));

Settings.defaultZone = plan.timeZone;

LogService.setLogger(new Logger({ MatrixClientLite: LogLevel.INFO }));
LogService.setLevel(LogLevel.fromString(process.env["LOG_LEVEL"]!));
LogService.muteModule("MatrixHttpClient");
LogService.muteModule("Metrics");

const config = {
  accessToken: env("MATRIX_ACCESS_TOKEN"),
  baseUrl: env("MATRIX_BASE_URL"),
  plan,
};

await new Patch(config).start();
