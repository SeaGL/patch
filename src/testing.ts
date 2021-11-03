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
  conferenceServer: "seattlematrix.org",

  avatars: {
    seagl_logo_w_mic: "mxc://seattlematrix.org/OvtPvQJgPcFWLxDfBxHnFSiv",
    seagl_sticker_03: "mxc://seattlematrix.org/HdtuUcOVpqBKkjYnNWqLWYRx",
  },

  staffRoom: "!VkmwSHxGfbMNXUSseK:seattlematrix.org", // #SeaGL-staff:seattlematrix.org

  default_power_levels: {
    "users": {
      "@seagl-bot:seattlematrix.org": 99,
      "@salt:seattlematrix.org": 100,
    },
    "users_default": 0,
    "events": {
      "m.room.name": 50,
      "m.room.power_levels": 99,
      "m.room.history_visibility": 99,
      "m.room.canonical_alias": 50,
      "m.room.avatar": 50,
      "m.room.tombstone": 100,
      "m.room.server_acl": 100,
      "m.room.encryption": 100,
      "m.room.topic": 50,
      "im.vector.modular.widgets": 99,
    },
    "events_default": 0,
    "state_default": 99,
    "ban": 50,
    "kick": 50,
    "redact": 50,
    "invite": 0,
    "historical": 99,
    "notifications": {
      "room": 50,
    },
  },
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
//  const roomIdById = new Map();
//  for (const roomId of joinedRoomIds) {
//    const id = (await getCustomData(roomId))?.id;
//    if (id !== undefined) {
//      roomIdById.set(id, roomId);
//    }
//  }
  
  // TESTING


//  await limiter.schedule(() =>
//    client.setDisplayName("Patch")
//  );
//  await limiter.schedule(() =>
//    client.setAvatarUrl(config.avatars.seagl_sticker_03)
//  );

    try {
      await limiter.schedule(() =>
        client.setUserPowerLevel("@seagl-bot:seattlematrix.org", "!XBpXsfEUdGiqTwGlVS:seattlematrix.org", 99)
//        client.leaveRoom(testRoom)
      );
    } catch (error: any) {
      throw error;
    }


  throw Error;

//joinedRoomId: "!FFDqTbOmPmhfEacIXy:seattlematrix.org"
//joinedRoomName not found
//joinedRoomJoinRules: "invite"
//joinedRoomAliases not found
    let testRoom;
    testRoom = "!VkmwSHxGfbMNXUSseK:seattlematrix.org";

//    try {
//      testRoom = await limiter.schedule(() =>
//        client.resolveRoom("#SeaGL2021-Speaker-Help:seattlematrix.org")
//      );
//    } catch (error: any) {
//      throw error;
//    }

//    try {
//      await limiter.schedule(() =>
//        client.inviteUser("@salt:seattlematrix.org", testRoom)
//      );
//    } catch (error: any) {
//      throw error;
//    }

  await limiter.schedule(() =>
    client.sendStateEvent(testRoom, "org.seagl.2021roomgenerator", "", {"id": "seagl-staff"})
  );

  await limiter.schedule(() =>
    client.sendStateEvent(testRoom, "m.room.avatar", "", {"url": config.avatars.seagl_logo_w_mic})
  );

  await limiter.schedule(() =>
    client.sendStateEvent(testRoom, "m.room.topic", "", {"topic": "Birdhouse dedicated to the SeaGL staff."})
  );


//  const widgetStateKey = `🪶seagl-triage`;
//  await limiter.schedule(() =>
//    client.sendStateEvent(testRoom, "im.vector.modular.widgets", widgetStateKey, {
//      type: "customwidget",
//      creatorUserId: userId,
//      name: "SeaGL 2021",
//      avatar_url: config.avatars.seagl_logo_w_mic,
//      url: "https://attend.seagl.org/widgets/index.html",
//    })
//  );

//  await limiter.schedule(() =>
//    client.sendStateEvent(testRoom, "io.element.widgets.layout", "", {
//      widgets: {
//        [widgetStateKey]: {
//          container: "top",
//          height: 25,
//          width: 100,
//          index: 0,
//        },
//      },
//    })
//  );

  const restrictedSpace = await limiter.schedule(() => client.getSpace(`#SeaGL2021-Restricted:${config.homeserver}`));

  await limiter.schedule(() =>
    restrictedSpace.addChildRoom(testRoom, {"order": "170"})
  );



  throw Error;

  const testSpec = [
    {
      localAlias: "SeaGL2021-Orchestration",
    },
  ];
  for (const spec of testSpec) {
    let testRoom;
    try {
      testRoom = await limiter.schedule(() =>
        client.resolveRoom(`#${spec.localAlias}:${config.homeserver}`)
      );
    } catch (error: any) {
      if (error.body?.errcode === "M_NOT_FOUND") {
        continue;
      }
    }
//    console.info("🏘️ Room ID: %j", testRoom);
//    const testRoomState = await limiter.schedule(() =>
//      client.getRoomState(testRoom)
//    );
//    console.info("🏘️ Room State: %j", testRoomState);

    try {
      await limiter.schedule(() =>
        client.joinRoom(testRoom)
//        client.leaveRoom(testRoom)
      );
    } catch (error: any) {
      if (error.body?.errcode !== "M_NOT_FOUND" && error.body?.errcode !== "M_UNKNOWN") {
        throw error;
      }
    }
    
    await limiter.schedule(() =>
      client.sendStateEvent(testRoom, "m.room.power_levels", "", config.default_power_levels)
    );
    await limiter.schedule(() =>
      client.sendStateEvent(testRoom, "m.room.join_rules", "", {"join_rule": "public"})
    );
    await limiter.schedule(() =>
      client.sendStateEvent(testRoom, "m.room.history_visibility", "", {"history_visibility": "world_readable"})
    );
    await limiter.schedule(() =>
      client.sendStateEvent(testRoom, "m.room.name", "", {"name": "BAD BOT"})
    );
    
//    try {
//      await limiter.schedule(() =>
//        client.inviteUser("@salt:sal.td", testRoom)
//      );
//    } catch (error: any) {
//      if (error.body?.errcode !== "M_NOT_FOUND" && error.body?.errcode !== "M_FORBIDDEN") {
//        throw error;
//      }
//    }
    try {
      await limiter.schedule(() =>
        client.inviteUser("@salt:seattlematrix.org", testRoom)
      );
    } catch (error: any) {
      if (error.body?.errcode !== "M_NOT_FOUND" && error.body?.errcode !== "M_FORBIDDEN") {
        throw error;
      }
    }
  }

  
//  await limiter.schedule(() =>
//    client.joinRoom("!ZXbELYqqvVlWLAwPaM:sal.td")
//  );
  
  // DONE TESTING

  // Start
  await client.start();
  console.info("🟢 Ready: %j", { userId, joinedRoomIds });

})();

