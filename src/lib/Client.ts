import Bottleneck from "bottleneck";
import { MatrixClient } from "matrix-bot-sdk";
import type { StateEvent, Sync } from "./matrix.js";
import { env, info, warn } from "./utilities.js";

const issue8895Cooldown = 1000 * Number(env("ISSUE_8895_COOLDOWN"));
const minTime = 1000 / Number(env("MATRIX_RATE_LIMIT"));

export default class Client extends MatrixClient {
  #cache?: Map<string, Map<string, StateEvent>>;
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

  public override getRoomState: MatrixClient["getRoomState"] = async (id) => [
    ...(this.#cache?.get(id)?.values() ?? []),
  ];

  public override getRoomStateEvent: MatrixClient["getRoomStateEvent"] = async (
    id,
    type,
    key = ""
  ) => this.#cache?.get(id)?.get(`${type}/${key}`)?.content;

  public override start: MatrixClient["start"] = async (...args) => {
    const result = await super.start(...args);

    return new Promise((r) => this.once("initial-sync", () => r(result)));
  };

  // Modified from https://github.com/turt2live/matrix-bot-sdk/blob/v0.6.2/src/MatrixClient.ts#L736
  protected override doSync(token: string): Promise<any> {
    const query = {
      full_state: !this.#cache,
      timeout: Math.max(0, this.syncingTimeout),
      ...(token ? { since: token } : undefined),
      ...(this["filterId"] ? { filter: this["filterId"] } : undefined),
      ...(this.syncingPresence ? { presence: this.syncingPresence } : undefined),
    };

    const timeout = token && this.#cache ? 40000 : 600000;
    return this.doRequest("GET", "/_matrix/client/v3/sync", query, null, timeout);
  }

  // Pending turt2live/matrix-bot-sdk#215
  protected override processSync: MatrixClient["processSync"] = (sync: Sync, emit) => {
    const isInitial = !this.#cache;
    this.#cache ??= new Map();

    if (sync.rooms?.join) {
      for (const [id, { state }] of Object.entries(sync.rooms.join)) {
        const room = this.#cache.get(id) ?? new Map();
        for (const e of state.events) room.set(`${e.type}/${e.state_key}`, e);
        this.#cache.set(id, room);
      }
    }

    if (isInitial) this.emit("initial-sync");

    return super.processSync(sync, emit);
  };
}
