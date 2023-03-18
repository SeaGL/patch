import Command from "../lib/Command.js";
import { permalinkPattern } from "../lib/matrix.js";
import { optional } from "../lib/utilities.js";
import { Group, Handler } from "../modules/Commands.js";

export default class Announce extends Command {
  static syntax = /^\s*(?<queries>.+?)\s*:\s+(?<announcement>.*?)\s*$/;

  public async start() {
    this.on("announce", this.announce, { group: Group.Control });
  }

  private announce: Handler = async ({ docs, event, input, room }): Promise<void> => {
    const reply = (html: string) => this.matrix.replyHtmlNotice(room, event, html);

    const asHtml = input.html && this.#parse(input.html);
    if (!asHtml) return void (await reply(docs.commands["announce"]!));

    // Resolve targets
    const targets = new Set<string>();
    const add = async (id: string) => {
      const s = await this.matrix.getSpace(id).catch(() => undefined);
      if (s) for (const c of Object.keys(await s.getChildEntities())) await add(c);
      else targets.add(id);
    };
    for (const query of asHtml.queries) {
      const id = await this.matrix.resolveRoom(query).catch(() => undefined);
      if (!id) return void (await reply(`Unknown room “${query}”`));

      await add(id);
    }

    // Send messages
    await reply(`Announcing to ${targets.size} rooms`);
    await this.matrix.setTyping(room, true);
    for (const target of targets) {
      try {
        this.info("💬 Send message", { room: target, html: asHtml.announcement });
        await this.matrix.sendHtmlNotice(target, asHtml.announcement);
      } catch (error) {
        this.error("💬 Failed to send message", { room: target, error });
        await reply(`Failed to announce in ${target}`);
      }
    }
    await this.matrix.setTyping(room, false);
  };

  #parse = (body: string) => {
    const parts = body.match(Announce.syntax)?.groups;
    return (
      parts && {
        announcement: parts["announcement"]!,
        queries: (parts["queries"]!.split(/\s*,\s*/) ?? []).flatMap((html) =>
          optional(html.match(permalinkPattern)?.[1])
        ),
      }
    );
  };
}
