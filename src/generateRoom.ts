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

import { config } from "./config.js";

//config.defaultPowerLevels.users = {
//  "@seagl-bot:seattlematrix.org": 99,
//  "@salt:seattlematrix.org": 100,
//};

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
//  const roomIdById = new Map();
//  for (const roomId of joinedRoomIds) {
//    const id = (await getCustomData(roomId))?.id;
//    if (id !== undefined) {
//      roomIdById.set(id, roomId);
//    }
//  }
  
  let roomId;

  // Grab Subspaces
  const mainSpace = await limiter.schedule(() => client.getSpace(`#SeaGL2021:${config.homeserver}`));
  const currentSessionsSpace = await limiter.schedule(() => client.getSpace(`#SeaGL2021-Sessions-Current:${config.homeserver}`));
  const hallwaySpace = await limiter.schedule(() => client.getSpace(`#SeaGL2021-Hallway:${config.homeserver}`));
  const informationSpace = await limiter.schedule(() => client.getSpace(`#SeaGL2021-Information:${config.homeserver}`));
  const restrictedSpace = await limiter.schedule(() => client.getSpace(`#SeaGL2021-Restricted:${config.homeserver}`));
  const upcomingSessionsSpace = await limiter.schedule(() => client.getSpace(`#SeaGL2021-Sessions-Upcoming:${config.homeserver}`));
  const completedSessionsSpace = await limiter.schedule(() => client.getSpace(`#SeaGL2021-Sessions-Completed:${config.homeserver}`));

  // Spec Room
  const spec = {
    avatar: config.avatars.seagl_logo_w_mic,
    id: "seagl2021-lobby",
    localAlias: "SeaGL2021-Lobby",
    name: "Lobby | #SeaGL2021",
    sortKey: "040",
    subspace: "hallway",
    suggested: true,
    topic: "A place to mingle and chat with other attendees between session. | Please note, the SeaGL Code of Conduct is in effect and can be found here: https://seagl.org/coc",
    welcome:
      "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is a central room for \"hallway track\" socializing. See {mainSpace} for a listing of all rooms.",
    widget: true,
  };

  // Spec Widget
  const widgetStateKey = `🪶${spec.id}`;
  const widgetEvents = spec.widget
    ? [
        {
          type: "im.vector.modular.widgets",
          state_key: widgetStateKey,
          content: {
            type: "customwidget",
            creatorUserId: userId,
            name: "SeaGL 2021",
            avatar_url: config.avatars.seagl_logo_w_mic,
            url: "https://attend.seagl.org/widgets/index.html",
          },
        },
        {
          type: "io.element.widgets.layout",
          state_key: "",
          content: {
            widgets: {
              [widgetStateKey]: {
                container: "top",
                height: 25,
                width: 100,
                index: 0,
              },
            },
          },
        },
      ]
    : [];

  // Create Room
  try {
    roomId = await limiter.schedule(() =>
      client.createRoom({
        initial_state: [
          {
            type: "m.room.avatar",
            state_key: "",
            content: { url: spec.avatar },
          },
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
          ...widgetEvents,
        ],
        name: spec.name,
        power_level_content_override: config.defaultPowerLevels,
        preset: "public_chat",
        room_alias_name: spec.localAlias,
        room_version: "9",
        topic: spec.topic,
        visibility: "public",
      })
    );
  } catch (error: any) {
    throw error;
  }

  // Add Room to correct Subspace
  try {
    if (spec.subspace === "hallway") {
      await limiter.schedule(() =>
        hallwaySpace.addChildRoom(roomId, {
          order: spec.sortKey,
          suggested: spec.suggested,
        })
      );
    } else if (spec.subspace === "information") {
      await limiter.schedule(() =>
        informationSpace.addChildRoom(roomId, {
          order: spec.sortKey,
          suggested: spec.suggested,
        })
      );
    } else if (spec.subspace === "sessions") {
      await limiter.schedule(() =>
        upcomingSessionsSpace.addChildRoom(roomId, {
          order: spec.sortKey,
          suggested: spec.suggested,
        })
      );
    } else if (spec.subspace === "restricted") {
      await limiter.schedule(() =>
        restrictedSpace.addChildRoom(roomId, {
          order: spec.sortKey,
          suggested: spec.suggested,
        })
      );
    }
  } catch (error: any) {
    throw error;
  }
  
  console.log("Room generated: %j", {id: spec.id, name: spec.name})

  // Start
  await client.start();
  console.info("🟢 Ready: %j", { userId, joinedRoomIds });

})();

