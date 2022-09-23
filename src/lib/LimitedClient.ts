import Bottleneck from "bottleneck";
import { MatrixClient } from "matrix-bot-sdk";
import { warn } from "./utilities.js";

export default class LimitedClient extends MatrixClient {
  public constructor(...args: ConstructorParameters<typeof MatrixClient>) {
    super(...args);

    const limiter = new Bottleneck({ maxConcurrent: 1, minTime: 1000 });

    limiter.on("failed", async (error, info) => {
      if (info.retryCount < 3 && error.errcode === "M_LIMIT_EXCEEDED") {
        const ms: number = error.retryAfterMs ?? 5000;

        warn(`Rate limited for ${ms} ms`);
        return ms;
      }

      return undefined;
    });

    this.doRequest = limiter.wrap(super.doRequest);
  }
}
