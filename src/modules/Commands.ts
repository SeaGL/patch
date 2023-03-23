import Bottleneck from "bottleneck";
import { assertEquals } from "typia";
import Announce from "../commands/Announce.js";
import Help from "../commands/Help.js";
import Sync from "../commands/Sync.js";
import Tea from "../commands/Tea.js";
import type Client from "../lib/Client.js";
import type { MessageEvent, Received } from "../lib/matrix.js";
import Module from "../lib/Module.js";
import { importYaml } from "../lib/utilities.js";

// Load markdown docs
const docs = assertEquals<Docs>(importYaml("data/help.yml"));

interface Context {
  docs: Docs;
  event: Received<MessageEvent<"m.room.message">>;
  input: Input;
  matrix: Client;
  room: string;
}

interface Docs {
  brief: string;
  commands: Record<string, string>;
  controlBrief: string;
}

export enum Group {
  Control = "control",
  Public = "public",
}

export type Handler = (context: Context) => Promise<void>;

export type Define = (
  name: string,
  handler: Handler,
  options?: { group?: Group }
) => void;

interface Input {
  command: string;
  html: string | undefined;
  text: string | undefined;
}

export default class Commands extends Module {
  static commands = [Announce, Help, Sync, Tea];
  static syntax = /^!(?<command>[a-z]+)(?:\s+(?<input>.*?))?\s*$/;

  #commands: { [group in Group]: Record<string, Handler> } = {
    [Group.Control]: {},
    [Group.Public]: {},
  };
  #limiter = new Bottleneck.Group({ maxConcurrent: 1, minTime: 1000 });

  public async start() {
    await Promise.all(
      Commands.commands.map((C) => new C(this.patch, this.matrix, this.define).start())
    );

    this.patch.on("message", this.#detect);
  }

  private define: Define = (name, handler, { group = Group.Public } = {}) => {
    this.debug("🛎️ Define command", { name, group });
    this.#commands[group][name] = handler;
  };

  #detect = async (room: string, event: Received<MessageEvent<"m.room.message">>) => {
    if (event.content.msgtype !== "m.text") return;
    if (event.content["m.relates_to"]?.rel_type === "m.replace") return;
    if (!event.content.body.startsWith("!")) return;

    const input = this.#parse(event.content);
    if (!input) return;
    this.debug("🛎️ Command", { room, sender: event.sender, input });

    const context: Context = { docs, event, input, matrix: this.matrix, room };
    const group = this.patch.isControlRoom(room) ? Group.Control : Group.Public;

    const handler = this.#commands[group][input.command];
    if (handler) this.#limiter.key(room).schedule(() => handler(context));
  };

  #parse(content: MessageEvent<"m.room.message">["content"]): Input | undefined {
    const parse = (body: string) => {
      const groups = body.match(Commands.syntax)?.groups;
      return { command: groups?.["command"], input: groups?.["input"] };
    };

    const asText = parse(content.body);
    const asHtml =
      "format" in content && content.format === "org.matrix.custom.html"
        ? parse(content.formatted_body)
        : undefined;

    const command = asText.command ?? asHtml?.command;
    if (!command) return;

    if (asText.command && asHtml?.command && asText.command !== asHtml.command) {
      this.error("🛎️ Conflicting text and HTML commands", { content });
      return;
    }

    return { command, html: asHtml?.input, text: asText.input };
  }
}
