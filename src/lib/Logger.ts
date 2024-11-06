import chalk from "chalk";
import { DateTime } from "luxon";
import { ILogger, LogLevel } from "matrix-bot-sdk";
import { inspect } from "util";
import { optional } from "./utilities.js";

const oneLine = { breakLength: Infinity, compact: true, depth: Infinity };

export default class Logger implements ILogger {
  readonly #plain: boolean;

  constructor(readonly overrides: Record<string, LogLevel> = {}) {
    this.#plain = !process.stdout.isTTY;
  }

  public trace = this.#handler(LogLevel.TRACE, console.trace, chalk.dim);
  public debug = this.#handler(LogLevel.DEBUG, console.debug, chalk.dim);
  public error = this.#handler(LogLevel.ERROR, console.error, chalk.red);
  public info = this.#handler(LogLevel.INFO, console.info, chalk.reset);
  public warn = this.#handler(LogLevel.WARN, console.warn, chalk.yellow);

  #handler(level: LogLevel, log: typeof console.log, color: chalk.ChalkFunction) {
    return <D>(module: string, message: string, data?: D) => {
      const override = this.overrides[module];
      if (override && !override.includes(level)) return;

      const time = DateTime.now().toISO();
      const detail = data && inspect(data, oneLine);

      if (this.#plain) log(level.toString(), message, ...optional(detail));
      else log(color(time), color(message), ...optional(detail && chalk.dim(detail)));
    };
  }
}
