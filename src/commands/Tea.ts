import { MentionPill } from "matrix-bot-sdk";
import { setTimeout } from "timers/promises";
import { assertEquals } from "typia";
import Command from "../lib/Command.js";
import { isUserId, permalinkPattern } from "../lib/matrix.js";
import { expect, importYaml, sample } from "../lib/utilities.js";
import type { Handler } from "../modules/Commands.js";

const toasts = assertEquals<string[]>(importYaml("data/toasts.yml"));

export default class extends Command {
  public async start() {
    this.on("tea", this.tea);
  }

  // Adapted from https://github.com/treedavies/seagl-bot-2021/tree/58a07cb/plugins/tea
  private tea: Handler = async ({ event, input, room }) => {
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
  };
}
