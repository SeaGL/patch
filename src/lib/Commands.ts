import Bottleneck from "bottleneck";
import { readFileSync } from "fs";
import { load } from "js-yaml";
import { MentionPill } from "matrix-bot-sdk";
import MarkdownIt from "markdown-it";
import { setTimeout } from "timers/promises";
import { assertEquals } from "typescript-json";
import type Client from "./Client.js";
import { Event, isUserId, permalinkPattern } from "./matrix.js";
import type Patch from "./Patch.js";
import type { Plan } from "./Plan.js";
import { expect, logger, sample } from "./utilities.js";

const { debug, error, info } = logger("Commands");
const md = new MarkdownIt();

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

const help: Help = assertEquals<Help>(
  load(readFileSync("./data/help.yml", { encoding: "utf-8" }))
);
help.brief = md.render(help.brief);
help.controlBrief = md.render(help.controlBrief);
for (const command in help.commands)
  help.commands[command] = md.render(help.commands[command]!);

const toasts = assertEquals<string[]>(
  load(readFileSync("./data/toasts.yml", { encoding: "utf-8" }))
).map((markdown) => md.renderInline(markdown));

export default class Commands {
  #limiter: Bottleneck.Group;

  public constructor(
    private readonly patch: Patch,
    private readonly matrix: Client,
    private readonly plan: Plan
  ) {
    this.#limiter = new Bottleneck.Group({ maxConcurrent: 1, minTime: 1000 });
  }

  public async start() {
    this.matrix.on("room.message", this.handleRoomMessage.bind(this));
  }

  private async announce(room: string, event: Message, input: Input) {
    const [targetsInput, html] = input.html?.split(/\s*:\s+/, 2) ?? [];
    const queriesHtml = targetsInput?.split(/\s*,\s*/) ?? [];

    if (!(html && queriesHtml.length > 0)) {
      await this.matrix.replyHtmlNotice(room, event, help.commands["announce"]!);
      return;
    }

    const targets: string[] = [];
    for (const queryHtml of queriesHtml) {
      const query = queryHtml.match(permalinkPattern)?.[1];
      const id = query && (await this.matrix.resolveRoom(query));

      if (!id) {
        await this.matrix.replyNotice(
          room,
          event,
          `Unable to resolve room “${queryHtml}”`
        );
        return;
      }

      const space = await this.matrix.getSpace(id).catch(() => undefined);
      if (space) {
        for (const child of Object.keys(await space.getChildEntities())) {
          targets.push(child);
        }
      } else {
        targets.push(id);
      }
    }

    await this.matrix.replyNotice(room, event, `Announcing to ${targets.length} rooms`);
    await this.matrix.setTyping(room, true);
    for (const target of targets) {
      try {
        info("💬 Send message", { room: target, html });
        await this.matrix.sendHtmlNotice(target, html);
      } catch (result) {
        error("💬 Failed to send message", { room: target, result });
        await this.matrix.replyNotice(room, event, `Failed to send in ${target}`);
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
    debug("🛎️ Command", { room, sender: event.sender, input });

    if (this.patch.controlRoom && room === this.patch.controlRoom) {
      switch (input.command) {
        case "announce":
          return this.run(room, () => this.announce(room, event, input));
        case "help":
          return this.run(room, () => this.helpControl(room, event));
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
    const [command, text] = content.body.slice(1).split(" ", 2);
    if (!command) return;

    return {
      command,
      html:
        "format" in content && content.format === "org.matrix.custom.html"
          ? content.formatted_body.slice(1 + command.length + 1)
          : undefined,
      text,
    };
  }

  private run(room: string, task: () => Promise<void>) {
    this.#limiter.key(room).schedule(task);
  }

  // Adapted from https://github.com/treedavies/seagl-bot-2021/tree/58a07cb/plugins/tea
  private async tea(room: string, event: Message, input: Input) {
    await this.matrix.setTyping(room, true);
    const minDelay = setTimeout(1000);

    let html;
    if (input.text) {
      const recipient = isUserId(input.text)
        ? input.text
        : input.html?.match(permalinkPattern)?.[1];

      if (recipient) {
        const to = await MentionPill.forUser(recipient, room, this.matrix);
        const from = await MentionPill.forUser(event.sender, room, this.matrix);
        const toast = expect(sample(toasts), "toast");
        html = `${to.html}: ${from.html} is toasting you! ${toast}`;
      } else {
        html = "Sorry, I don’t know who that is.";
      }
    } else {
      html = expect(sample(toasts), "toast");
    }

    await minDelay;
    await this.matrix.replyHtmlNotice(room, event, html);
    await this.matrix.setTyping(room, false);
  }
}
