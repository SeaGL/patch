import { match } from "fp-ts/lib/Either.js";
import { constVoid, pipe } from "fp-ts/lib/function.js";
import { PathReporter } from "io-ts/lib/PathReporter.js";
import { readFile } from "fs/promises";
import Patch from "./lib/Patch.js";
import { Plan } from "./lib/Plan.js";
import { env, error } from "./lib/utilities.js";

const start = async (plan: Plan) => {
  const config = {
    accessToken: env("MATRIX_ACCESS_TOKEN"),
    baseUrl: env("MATRIX_BASE_URL"),

    plan,
  };

  await new Patch(config).start();
};

const json = await readFile("./data/plan.json", { encoding: "utf-8" }); // Mock
const result = Plan.decode(JSON.parse(json) as unknown);
error(PathReporter.report(result));
pipe(result, match(constVoid, start));
