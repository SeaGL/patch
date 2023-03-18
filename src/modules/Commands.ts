import Bottleneck from "bottleneck";
import { MentionPill } from "matrix-bot-sdk";
import { setTimeout } from "timers/promises";
import { assertEquals } from "typia";
import type Client from "../lib/Client.js";
import { Event, isUserId, permalinkPattern } from "../lib/matrix.js";
import type Patch from "../Patch.js";
import type { Log } from "../Patch.js";
import type { Plan } from "../lib/Plan.js";
import type Reconciler from "./Reconciler.js";
import { expect, importYaml, sample } from "../lib/utilities.js";


interface Help {
  brief: string;
  commands: Record<string, string>;
  controlBrief: string;
}

interface Input {
  command: string;
  html: string | undefined;
  text: string | undefined;
}

type Message = Event<"m.room.message">;

const help = assertEquals<Help>(importYaml("data/help.yml"));
const toasts = assertEquals<string[]>(importYaml("data/toasts.yml"));

const announcePattern = /^\s*(?<queries>.+?)\s*:\s+(?<announcement>.*?)\s*$/;
const commandPattern = /^!(?<command>[a-z]+)(?:\s+(?<input>.*?))?\s*$/;

export default class Commands {
  #limiter: Bottleneck.Group;

  public trace: Log;
  public debug: Log;
  public error: Log;
  public info: Log;
  public warn: Log;

  public constructor(
    private readonly patch: Patch,
    private readonly matrix: Client,
    private readonly reconciler: Reconciler,
    private readonly plan: Plan
  ) {
    this.#limiter = new Bottleneck.Group({ maxConcurrent: 1, minTime: 1000 });

    this.trace = patch.trace.bind(patch);
    this.debug = patch.debug.bind(patch);
    this.error = patch.error.bind(patch);
    this.info = patch.info.bind(patch);
    this.warn = patch.warn.bind(patch);
  }

  public async start() {
    this.matrix.on("room.message", this.handleRoomMessage.bind(this));
  }

  private async announce(room: string, event: Message, input: Input): Promise<void> {
    const reply = this.matrix.replyHtmlNotice.bind(this.matrix);
    const parse = (body: string) => {
      const gs = body.match(announcePattern)?.groups;
      return gs && { announcement: gs["announcement"]!, queries: gs["queries"]! };
    };

    const targets = new Set<string>();
    const add = async (id: string) => {
      const s = await this.matrix.getSpace(id).catch(() => undefined);
      if (s) for (const c of Object.keys(await s.getChildEntities())) await add(c);
      else targets.add(id);
    };

    const asHtml = input.html && parse(input.html);
    if (!asHtml) return void (await reply(room, event, help.commands["announce"]!));

    for (const queryHtml of asHtml.queries.split(/\s*,\s*/) ?? []) {
      const query = queryHtml.match(permalinkPattern)?.[1];
      const id = query && (await this.matrix.resolveRoom(query).catch(() => undefined));
      if (!id) return void (await reply(room, event, `Unknown room “${query}”`));

      await add(id);
    }

    await reply(room, event, `Announcing to ${targets.size} rooms`);
    await this.matrix.setTyping(room, true);
    for (const target of targets) {
      try {
        this.info("💬 Send message", { room: target, html: asHtml.announcement });
        await this.matrix.sendHtmlNotice(target, asHtml.announcement);
      } catch (error) {
        this.error("💬 Failed to send message", { room: target, error });
        await reply(room, event, `Failed to announce in ${target}`);
      }
    }
    await this.matrix.setTyping(room, false);
  }

  private async handleRoomMessage(room: string, event: Message) {
    if (event.sender === this.plan.steward.id) return;
    if (event.content.msgtype !== "m.text") return;
    if (event.content["m.relates_to"]?.rel_type === "m.replace") return;
    if (!event.content.body.startsWith("!")) return;

    const input = this.parseCommand(event.content);
    if (!input) return;
    this.debug("🛎️ Command", { room, sender: event.sender, input });

    if (this.patch.controlRoom && room === this.patch.controlRoom) {
      switch (input.command) {
        case "announce":
          return this.run(room, () => this.announce(room, event, input));
        case "help":
          return this.run(room, () => this.helpControl(room, event));
        case "sync":
          return this.run(room, () => this.sync(room, event));
      }
    } else {
      switch (input.command) {
        case "help":
          return this.run(room, () => this.help(room, event));
        case "tea":
          return this.run(room, () => this.tea(room, event, input));
      }
    }
  }

  private async help(room: string, event: Message) {
    await this.matrix.replyHtmlNotice(room, event, help.brief);
  }

  private async helpControl(room: string, event: Message) {
    await this.matrix.replyHtmlNotice(room, event, help.controlBrief);
  }

  private parseCommand(content: Message["content"]): Input | undefined {
    const parse = (body: string) => {
      const groups = body.match(commandPattern)?.groups;
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

  private run(room: string, task: () => Promise<void>) {
    this.#limiter.key(room).schedule(task);
  }

  private async sync(room: string, event: Message) {
    const started = "Synchronizing space with data sources…";
    const completed = "Synchronized space with data sources";

    const output = await this.matrix.replyNotice(room, event, started);
    this.reconciler
      .reconcile()
      .then(() =>
        this.matrix.replaceMessage(room, output, { msgtype: "m.notice", body: completed })
      );
  }

  // Adapted from https://github.com/treedavies/seagl-bot-2021/tree/58a07cb/plugins/tea
  private async tea(room: string, event: Message, input: Input) {
    await this.matrix.setTyping(room, true);
    const minDelay = setTimeout(1000);

    let recipient;
    if (input.html) {
      recipient = input.html?.match(permalinkPattern)?.[1];
    } else if (input.text) {
      const first = input.text.split(/\s+/, 1)[0];
      if (first && isUserId(first)) recipient = first;
    }

    let html;
    if (recipient) {
      const to = await MentionPill.forUser(recipient, room, this.matrix);
      const from = await MentionPill.forUser(event.sender, room, this.matrix);
      const toast = expect(sample(toasts), "toast");
      html = `${to.html}: ${from.html} is toasting you! ${toast}`;
    } else {
      html = expect(sample(toasts), "toast");
    }

    await minDelay;
    await this.matrix.replyHtmlNotice(room, event, html);
    await this.matrix.setTyping(room, false);
  }
}
