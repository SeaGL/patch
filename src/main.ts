import Bottleneck from "bottleneck";
import { DateTime, Settings } from "luxon";
import {
  MatrixClient,
  MentionPill,
  RichReply,
  SimpleFsStorageProvider,
} from "matrix-bot-sdk";
import { AutoDiscovery } from "matrix-js-sdk";
import fetch from "node-fetch";
import { env } from "./utilities.js";

Settings.defaultZone = "America/Los_Angeles";

const config = {
  homeserver: env("MATRIX_HOMESERVER"),
  accessToken: env("MATRIX_ACCESS_TOKEN"),

//  avatars: {
//    home: "mxc://kvalhe.im/cXGNnZfJTYtnTbGIUptUmCsm",
//    presentation: "mxc://kvalhe.im/JQhaLcmOzIYdRsQfWiqMCkFA",
//    seagl: "mxc://kvalhe.im/bmasxrBuggGXtMmcaudPmYAN",
//    videoStream: "mxc://kvalhe.im/sfRfgfLzEAVbnprJQYjbQRJm",
//  },
  staffRoom: "!pQraPupVjTcEUwBmSt:seattlematrix.org", // #SeaGL-test:seattlematrix.org
};

(async () => {
  // Rate limiter
  const limiter = new Bottleneck({ maxConcurrent: 1, minTime: 1 });
  limiter.on("failed", async (error, jobInfo) => {
    if (jobInfo.retryCount < 3 && error?.body?.errcode === "M_LIMIT_EXCEEDED") {
      const ms = error?.body?.retry_after_ms ?? 5000;

      console.warn(`Rate limited for ${ms} ms`);
      return ms;
    }
  });

  // Client
  const wellKnown = await AutoDiscovery.findClientConfig(config.homeserver);
  const baseUrl = wellKnown["m.homeserver"].base_url;
  const storage = new SimpleFsStorageProvider("data/state.json");
  const client = new MatrixClient(baseUrl, config.accessToken, storage);
  const getCustomData = async (roomId) => {
    try {
      return await limiter.schedule(() =>
        client.getRoomStateEvent(roomId, "org.seagl.2021roomgenerator", "")
      );
    } catch (error: any) {
      if (error.body?.errcode !== "M_NOT_FOUND") {
        throw error;
      }
    }
  };
  const userId = await limiter.schedule(() => client.getUserId());
  const joinedRoomIds = new Set(
    await limiter.schedule(() => client.getJoinedRooms())
  );
  const roomIdById = new Map();
  for (const roomId of joinedRoomIds) {
    const id = (await getCustomData(roomId))?.id;
    if (id !== undefined) {
      roomIdById.set(id, roomId);
    }
  }

  // State
  let createdSpace = false;
  let space;
  const variables: Record<string, string> = {};

  // Find or create space
  const spaceSpec = {
//    avatar: config.avatars.seagl,
    localAlias: "SeaGL2021",
    name: "SeaGL 2021",
    topic: "Welcome to the #SeaGL2021 Space! Here you'll find a variety of conference rooms. Please look around, introduce yourself in #SeaGL2021-welcome , and ask any questions! | Please note, the SeaGL Code of Conduct is in effect and can be found here: https://seagl.org/coc",
  };
  const spaceAlias = `#${spaceSpec.localAlias}:${config.homeserver}`;
  try {
    space = await limiter.schedule(() => client.getSpace(spaceAlias));
    console.info("🏘️ Space exists: %j", {
      alias: spaceAlias,
      roomId: space.roomId,
    });
  } catch (error: any) {
    if (error.body?.errcode !== "M_NOT_FOUND") {
      throw error;
    }

//    space = await limiter.schedule(() =>
//      client.createSpace({
//        avatarUrl: spaceSpec.avatar,
//        isPublic: true,
//        localpart: spaceSpec.localAlias,
//        name: spaceSpec.name,
//        topic: spaceSpec.topic,
//      })
//    );
//    joinedRoomIds.add(space.roomId);
//    createdSpace = true;
    console.info("🏘️ Created space: %j", {
//      roomId: space.roomId,
      spec: spaceSpec,
    });
  }
  variables.space = (await MentionPill.forRoom(space.roomId, client)).html;

  // Add staff room to space
  if (createdSpace && joinedRoomIds.has(config.staffRoom)) {
    await limiter.schedule(() =>
      space.addChildRoom(config.staffRoom, { order: "800" })
    );
  }

  // Find or create rooms
  const getOsemRoomSpecs = async (slug) => {
    const url = `https://osem.seagl.org/api/v2/conferences/${slug}`;
    const response = (await (await fetch(url)).json()) as any;

    const records = new Map<string, any>();
    for (const record of response.included) {
      records.set(`${record.type}-${record.id}`, record);
    }

    return response.data.relationships.events.data.map(({ id, type }) => {
      const record = records.get(`${type}-${id}`);
      const beginning = DateTime.fromISO(record.attributes.beginning);

      return {
//        avatar: config.avatars.presentation,
        id: `seagl2021-osem-${type}-${id}`,
        name: `${beginning.toFormat("EEE HH:mm")} ${record.attributes.title}`,
        sortKey: "100",
        topic: "Conference Session · Code of Conduct: seagl.org/coc",
        welcome:
          "Squawk! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This room is dedicated to a single conference session. See {space} for a listing of all rooms.",
//        widget: {
//          avatar: config.avatars.videoStream,
//          name: "Video Stream",
//          stateKey: "2021roomgenerator",
//          url: "https://attend.seagl.org/widgets/video-stream.html",
//        },
      };
    });
  };
  const roomsSpec = [
    {
//      avatar: config.avatars.home,
      id: "seagl2021-general",
      localAlias: "SeaGL2021-General",
      name: "General | #SeaGL2021",
      sortKey: "010",
      suggested: true,
      topic: "General Discussion · Code of Conduct: seagl.org/coc",
      welcome:
        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is a central room for general discussion. See {space} for a listing of all rooms.",
//      widget: {
//        avatar: config.avatars.seagl,
//        name: "Welcome",
//        stateKey: "2021roomgenerator",
//        url: "https://attend.seagl.org/widgets/welcome.html",
//      },
    },
    {
//      avatar: config.avatars.home,
      id: "seagl2021-welcome",
      localAlias: "SeaGL2021-Welcome",
      name: "Welcome | #SeaGL2021",
      sortKey: "010",
      suggested: true,
      topic: "",
    },
    {
//      avatar: config.avatars.home,
      id: "seagl2021-announcements",
      localAlias: "SeaGL2021-Announcements",
      name: "Announcements | #SeaGL2021",
      sortKey: "011",
      suggested: true,
      topic: "",
    },
    {
//      avatar: config.avatars.home,
      id: "seagl2021-talks-current",
      localAlias: "SeaGL2021-Talks-Current",
      name: "Current Talks | #SeaGL2021",
      sortKey: "020",
      suggested: true,
      topic: "",
    },
    {
//      avatar: config.avatars.home,
      id: "seagl2021-hallway",
      localAlias: "SeaGL2021-hallway",
      name: "Hallway | #SeaGL2021",
      sortKey: "030",
      suggested: true,
      topic: "",
    },
    {
//      avatar: config.avatars.home,
      id: "seagl2021-social",
      localAlias: "SeaGL2021-Social",
      name: "Social | #SeaGL2021",
      sortKey: "031",
      suggested: true,
      topic: "",
    },
    {
//      avatar: config.avatars.home,
      id: "seagl2021-sponsors",
      localAlias: "SeaGL2021-Sponsors",
      name: "Sponsors | #SeaGL2021",
      sortKey: "032",
      suggested: true,
      topic: "",
    },
    {
//      avatar: config.avatars.home,
      id: "seagl2021-information",
      localAlias: "SeaGL2021-Information",
      name: "Information | #SeaGL2021",
      sortKey: "040",
      suggested: true,
      topic: "",
    },
    {
//      avatar: config.avatars.home,
      id: "seagl2021-info-booth",
      localAlias: "SeaGL2021-Info-Booth",
      name: "Info Booth | #SeaGL2021",
      sortKey: "041",
      suggested: true,
      topic: "",
    },
    {
//      avatar: config.avatars.home,
      id: "seagl2021-bot-help",
      localAlias: "SeaGL2021-Bot-Help",
      name: "Bot Help | #SeaGL2021",
      sortKey: "042",
      suggested: true,
      topic: "",
    },
    {
//      avatar: config.avatars.home,
      id: "seagl2021-speaker-help",
      localAlias: "SeaGL2021-Speaker-Help",
      name: "Speaker Help | #SeaGL2021",
      sortKey: "043",
      suggested: false,
      topic: "",
    },
    {
//      avatar: config.avatars.home,
      id: "seagl2021-sponsor-help",
      localAlias: "SeaGL2021-sponsor-help",
      name: "Sponsor Help | #SeaGL2021",
      sortKey: "044",
      suggested: false,
      topic: "",
    },
    {
//      avatar: config.avatars.home,
      id: "seagl2021-volunteering",
      localAlias: "SeaGL2021-Volunteering",
      name: "Volunteering | #SeaGL2021",
      sortKey: "045",
      suggested: false,
      topic: "",
    },
    {
//      avatar: config.avatars.home,
      id: "seagl2021-talks-upcoming",
      localAlias: "SeaGL2021-Talks-Upcoming",
      name: "Upcoming Talks | #SeaGL2021",
      sortKey: "100",
      suggested: false,
      topic: "",
    },
    {
//      avatar: config.avatars.home,
      id: "seagl2021-talks-completed",
      localAlias: "SeaGL2021-Talks-Completed",
      name: "Completed Talks | #SeaGL2021",
      sortKey: "200",
      suggested: false,
      topic: "",
    },
    {
//      avatar: config.avatars.home,
      id: "seagl2021-restricted",
      localAlias: "SeaGL2021-Restricted",
      name: "Restricted | #SeaGL2021",
      sortKey: "300",
      suggested: false,
      topic: "",
    },
    {
//      avatar: config.avatars.home,
      id: "seagl2021-orchestration",
      localAlias: "SeaGL2021-Orchestration",
      name: "Orchestration | #SeaGL2021",
      sortKey: "310",
      suggested: false,
      topic: "",
    },
    {
//      avatar: config.avatars.home,
      id: "seagl2021-volunteers",
      localAlias: "SeaGL2021-Volunteers",
      name: "Volunteers | #SeaGL2021",
      sortKey: "320",
      suggested: false,
      topic: "",
    },
//    add #SeaGL-Triage
//    add #SeaGL-Tech
//    add #SeaGL-Test
//    add #SeaGL-Staff
//    add #SeaGL-Bot-Log
//    ...(await getOsemRoomSpecs("seagl2021")),
  ];
  for (const spec of roomsSpec) {
    let roomId = roomIdById.get(spec.id);
    if (roomId === undefined) {
      roomId = await limiter.schedule(() =>
        client.createRoom({
          initial_state: [
//            {
//              type: "m.room.avatar",
//              state_key: "",
//              content: { url: spec.avatar },
//            },
            {
              type: "m.room.guest_access",
              state_key: "",
              content: { guest_access: "can_join" },
            },
            {
              type: "m.room.history_visibility",
              state_key: "",
              content: { history_visibility: "world_readable" },
            },
            {
              type: "org.seagl.2021roomgenerator",
              state_key: "",
              content: { id: spec.id },
            },
//            ...(spec.widget
//              ? [
//                  {
//                    type: "im.vector.modular.widgets",
//                    state_key: spec.widget.stateKey,
//                    content: {
//                      type: "customwidget",
//                      creatorUserId: userId,
//                      name: spec.widget.name,
//                      avatar_url: spec.widget.avatar,
//                      url: spec.widget.url,
//                    },
//                  },
//                  {
//                    type: "io.element.widgets.layout",
//                    state_key: "",
//                    content: {
//                      widgets: {
//                        [spec.widget.stateKey]: {
//                          container: "top",
//                          height: 25,
//                          width: 100,
//                          index: 0,
//                        },
//                      },
//                    },
//                  },
//                ]
//              : []),
          ],
          name: spec.name,
          preset: "public_chat",
          room_alias_name: spec.localAlias,
          room_version: "9",
          topic: spec.topic,
          visibility: "public",
        })
      );
      roomIdById.set(spec.id, roomId);
      joinedRoomIds.add(roomId);
      console.info("🏠 Created room: %j", { roomId, spec });
      await limiter.schedule(() =>
        space.addChildRoom(roomId, {
          order: spec.sortKey,
          suggested: spec.suggested,
        })
      );
      await limiter.schedule(() =>
        client.sendHtmlNotice(
          roomId,
          spec.welcome.replaceAll(/{(\w+)}/g, (_, name) => variables[name])
        )
      );
    } else {
      console.info("🏠 Room exists: %j", { id: spec.id, roomId });
    }
  }

//  // Handle invitations
//  client.on("room.invite", async (roomId, event) => {
//    if (roomId === config.staffRoom) {
//      console.info("💌 Accepting invitation: %j", { roomId, event });
//      await limiter.schedule(() => client.joinRoom(roomId));
//      await limiter.schedule(() =>
//        client.sendHtmlNotice(
//          roomId,
//          "Squawk! I’m <strong>Patch</strong> (they/them), the SeaGL mascot."
//        )
//      );

//      if (space !== undefined) {
//        await limiter.schedule(() =>
//          space.addChildRoom(roomId, { order: "800" })
//        );
//        await limiter.schedule(() =>
//          client.sendHtmlNotice(roomId, `Come join me in ${variables.space}!`)
//        );
//      }
//    } else {
//      console.warn("🗑️ Rejecting invitation: %j", { roomId, event });
//      await limiter.schedule(() => client.leaveRoom(roomId));
//    }
//  });

//  // Handle kicks
//  client.on("room.leave", async (roomId, event) => {
//    if (event.sender !== userId) {
//      console.warn("👮 Got kicked: %j", { roomId, event });
//    }
//  });

//  // Handle staff commands
//  client.on("room.message", async (roomId, event) => {
//    if (
//      !(
//        event?.content?.msgtype === "m.text" &&
//        event.sender !== userId &&
//        event?.content?.body?.startsWith("!")
//      )
//    ) {
//      return;
//    }

//    if (!(roomId === config.staffRoom && event?.content?.body === "!hello")) {
//      console.warn("⚠️ Ignoring command: %j", { roomId, event });
//      return;
//    }

//    const text = "Hello World!";
//    const content = RichReply.createFor(roomId, event, text, text);
//    content.msgtype = "m.notice";

//    await limiter.schedule(() => client.sendMessage(roomId, content));
//  });

  // Start
  await client.start();
  console.info("🟢 Ready: %j", { userId, joinedRoomIds });
  if (createdSpace && joinedRoomIds.has(config.staffRoom)) {
    await limiter.schedule(() =>
      client.sendHtmlNotice(
        config.staffRoom,
        `Come join me in ${variables.space}!`
      )
    );
  }
})();
