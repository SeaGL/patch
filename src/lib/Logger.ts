import chalk from "chalk";
import { DateTime } from "luxon";
import type { ILogger } from "matrix-bot-sdk";
import { inspect } from "util";
import { optional } from "./utilities.js";

const oneLine = { breakLength: Infinity, compact: true };

export default class Logger implements ILogger {
  static #from =
    (log: typeof console.log, color: chalk.ChalkFunction) =>
    <D>(_module: string, message: string, data?: D) => {
      const timestamp = DateTime.now().toISO();
      const inspection = data && chalk.dim(inspect(data, oneLine));

      log(color(timestamp), color(message), ...optional(inspection));
    };

  public trace = Logger.#from(console.trace, chalk.dim);
  public debug = Logger.#from(console.debug, chalk.dim);
  public error = Logger.#from(console.error, chalk.red);
  public info = Logger.#from(console.info, chalk.reset);
  public warn = Logger.#from(console.warn, chalk.yellow);
}
