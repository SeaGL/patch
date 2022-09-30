import Bottleneck from "bottleneck";
import { MatrixClient } from "matrix-bot-sdk";
import { env, info, warn } from "./utilities.js";

const issue8895Cooldown = 1000 * Number(env("ISSUE_8895_COOLDOWN"));
const minTime = 1000 / Number(env("MATRIX_RATE_LIMIT"));

export default class Client extends MatrixClient {
  readonly #scheduleDefault: MatrixClient["doRequest"];
  readonly #scheduleIssue8895: MatrixClient["doRequest"];
  readonly #scheduleUnlimited: MatrixClient["doRequest"];

  public constructor(...args: ConstructorParameters<typeof MatrixClient>) {
    super(...args);

    const limiter = new Bottleneck({ maxConcurrent: 1, minTime });

    limiter.on("failed", async (error, info) => {
      if (info.retryCount < 3 && error.errcode === "M_LIMIT_EXCEEDED") {
        const ms: number = error.retryAfterMs ?? 5000;

        warn(`Rate limited for ${ms} ms`);
        return ms;
      }

      return undefined;
    });

    const unlimited = super.doRequest.bind(this);

    this.#scheduleDefault = limiter.wrap(unlimited);
    this.#scheduleUnlimited = unlimited;

    // Workaround for matrix-org/synapse#8895
    this.#scheduleIssue8895 = limiter.wrap((async (...args) => {
      info("⏳ Wait before non-retryable API call: %j", { ms: issue8895Cooldown });
      await new Promise((r) => setTimeout(r, issue8895Cooldown));
      return unlimited(...args);
    }) as MatrixClient["doRequest"]);
  }

  // Pending turt2live/matrix-bot-sdk#18
  public override doRequest: MatrixClient["doRequest"] = (...args) => {
    const [method, path] = args;

    const handler =
      method === "GET" && path === "/_matrix/client/v3/sync"
        ? this.#scheduleUnlimited
        : method === "POST" && path === "/_matrix/client/v3/createRoom"
        ? this.#scheduleIssue8895
        : this.#scheduleDefault;

    return handler(...args);
  };

  // Pending turt2live/matrix-bot-sdk#262
  public forgetRoom(roomId: string) {
    const path = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/forget`;
    return this.doRequest("POST", path);
  }
}
