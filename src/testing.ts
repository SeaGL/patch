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

//joinedRoomId: "!FFDqTbOmPmhfEacIXy:seattlematrix.org"
//joinedRoomName not found
//joinedRoomJoinRules: "invite"
//joinedRoomAliases not found
    let testRoom;

    try {
      testRoom = await limiter.schedule(() =>
        client.resolveRoom("!FFDqTbOmPmhfEacIXy:seattlematrix.org")
      );
    } catch (error: any) {
      throw error;
    }

    try {
      await limiter.schedule(() =>
        client.inviteUser("@salt:seattlematrix.org", testRoom)
      );
    } catch (error: any) {
      throw error;
    }

  throw Error;

  const testSpec = [
    {
      localAlias: "SeaGL-Staff",
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
    console.info("🏘️ Room ID: %j", testRoom);
    const testRoomState = await limiter.schedule(() =>
      client.getRoomState(testRoom)
    );
    console.info("🏘️ Room State: %j", testRoomState);

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
    
//    await limiter.schedule(() =>
//      client.sendStateEvent(testRoom, "m.room.power_levels", "", config.default_power_levels)
//    );
    await limiter.schedule(() =>
      client.sendStateEvent(testRoom, "m.room.join_rules", "", {"join_rule": "public"})
    );
    await limiter.schedule(() =>
      client.sendStateEvent(testRoom, "m.room.history_visibility", "", {"history_visibility": "world_readable"})
    );
    await limiter.schedule(() =>
      client.sendStateEvent(testRoom, "m.room.name", "", {"name": "BAD BOT"})
    );
    
    try {
      await limiter.schedule(() =>
        client.inviteUser("@salt:sal.td", testRoom)
      );
    } catch (error: any) {
      if (error.body?.errcode !== "M_NOT_FOUND" && error.body?.errcode !== "M_FORBIDDEN") {
        throw error;
      }
    }
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

//  // State
//  let createdSpaces = false;
//  let space;
//  let mainSpace;
//  let currentSessionsSpace;
//  let hallwaySpace;
//  let informationSpace;
//  let upcomingSessionsSpace;
//  let completedSessionsSpace;
//  let restrictedSpace;
//  const variables: Record<string, string> = {};

//  // Find or create space
//  const spacesSpec = [
//    {
//      id: "seagl2021-main",
//      localAlias: "SeaGL2021-Main",
//    },
//    {
//      id: "seagl2021-sessions-current",
//      localAlias: "SeaGL2021-Sessions-Current",
//      sortKey: "020",
//    },
//    {
//      id: "seagl2021-hallway",
//      localAlias: "SeaGL2021-Hallway",
//      sortKey: "030",
//    },
//    {
//      id: "seagl2021-information",
//      localAlias: "SeaGL2021-Information",
//      sortKey: "040",
//    },
//    {
//      id: "seagl2021-sessions-upcoming",
//      localAlias: "SeaGL2021-Sessions-Upcoming",
//      sortKey: "100",
//    },
//    {
//      id: "seagl2021-sessions-completed",
//      localAlias: "SeaGL2021-Sessions-Completed",
//      sortKey: "200",
//    },
//    {
//      id: "seagl2021-restricted",
//      localAlias: "SeaGL2021-Restricted",
//      sortKey: "300",
//    },
//  ];
//  for (const spec of spacesSpec) {
//    const spaceAlias = `#${spec.localAlias}:${config.homeserver}`;
//    try {
//      space = await limiter.schedule(() => client.getSpace(spaceAlias));
//      console.info("🏘️ Space exists: %j", {
//        alias: spaceAlias,
//        roomId: space.roomId,
//      });
//    } catch (error: any) {
//      if (error.body?.errcode !== "M_NOT_FOUND") {
//        throw error;
//      }
//    }
//  }

//  // Find or create rooms
//  const getOsemRoomSpecs = async (slug) => {
//    const url = `https://osem.seagl.org/api/v2/conferences/${slug}`;
//    const response = (await (await fetch(url)).json()) as any;

//    const records = new Map<string, any>();
//    for (const record of response.included) {
//      records.set(`${record.type}-${record.id}`, record);
//    }

//    return response.data.relationships.events.data.map(({ id, type }) => {
//      const record = records.get(`${type}-${id}`);
//      const beginning = DateTime.fromISO(record.attributes.beginning);

//      return {
//        id: `seagl2021-osem-${type}-${id}`,
//        sortKey: "100",
//        subspace: "sessions",
////        widget: {
////          stateKey: "2021roomgenerator",
////          url: "https://attend.seagl.org/widgets/video-stream.html",
////        },
//      };
//    });
//  };
//  const roomsSpec = [
//    {
//      id: "seagl2021-welcome",
//      localAlias: "SeaGL2021-Welcome",
//      sortKey: "010",
//    },
//    {
//      id: "seagl2021-announcements",
//      localAlias: "SeaGL2021-Announcements",
//      sortKey: "011",
//    },
//    {
//      id: "seagl2021-social",
//      localAlias: "SeaGL2021-Social",
//      sortKey: "031",
//      subspace: "hallway",
//    },
//    {
//      id: "seagl2021-sponsors",
//      localAlias: "SeaGL2021-Sponsors",
//      sortKey: "032",
//      subspace: "hallway",
//    },
//    {
//      id: "seagl2021-career-expo",
//      localAlias: "SeaGL2021-Career-Expo",
//      sortKey: "033",
//      subspace: "hallway",
//    },
//    {
//      id: "seagl2021-info-booth",
//      localAlias: "SeaGL2021-Info-Booth",
//      sortKey: "041",
//      subspace: "information",
//    },
//    {
//      id: "seagl2021-bot-help",
//      localAlias: "SeaGL2021-Bot-Help",
//      sortKey: "042",
//      subspace: "information",
//    },
//    {
//      id: "seagl2021-speaker-help",
//      localAlias: "SeaGL2021-Speaker-Help",
//      sortKey: "043",
//      subspace: "information",
//    },
//    {
//      id: "seagl2021-sponsor-help",
//      localAlias: "SeaGL2021-Sponsor-Help",
//      sortKey: "044",
//      subspace: "information",
//    },
//    {
//      id: "seagl2021-volunteering",
//      localAlias: "SeaGL2021-Volunteering",
//      sortKey: "045",
//      subspace: "information",
//    },
//    {
//      id: "seagl2021-orchestration",
//      localAlias: "SeaGL2021-Orchestration",
//      sortKey: "310",
//      subspace: "restricted",
//    },
//    {
//      id: "seagl2021-volunteers",
//      localAlias: "SeaGL2021-Volunteers",
//      sortKey: "320",
//      subspace: "restricted",
//    },
//    {
//      id: "seagl-triage",
//      localAlias: "SeaGL-Triage",
//      sortKey: "330",
//      subspace: "restricted",
//    },
//    {
//      id: "seagl-tech",
//      localAlias: "SeaGL-Tech",
//      sortKey: "340",
//      subspace: "restricted",
//    },
//    {
//      id: "seagl-test",
//      localAlias: "SeaGL-Test",
//      sortKey: "350",
//      subspace: "restricted",
//    },
//    {
//      id: "seagl-staff",
//      localAlias: "SeaGL-Staff",
//      sortKey: "360",
//      subspace: "restricted",
//    },
//    {
//      id: "seagl-bot-log",
//      localAlias: "SeaGL-Bot-Log",
//      sortKey: "370",
//      subspace: "restricted",
//    },
////    ...(await getOsemRoomSpecs("seagl2021")),
//  ];
//  for (const spec of roomsSpec) {
//    let roomId = roomIdById.get(spec.id);
//    if (roomId === undefined) {
//      console.info("Room not in roomIdById list: %j'", { id: spec.id, roomId});
//    } else {
//      console.info("🏠 Room exists: %j", { id: spec.id, roomId });
//    }

//    const roomAlias = `#${spec.localAlias}:${config.homeserver}`;
//    try {
//      const room = await limiter.schedule(() => client.lookupRoomAlias(roomAlias));
//      console.info("🏘️ Room exists: %j", {
//        alias: roomAlias,
//        roomId: room.roomId,
//      });
//    } catch (error: any) {
//      if (error.body?.errcode !== "M_NOT_FOUND") {
//        throw error;
//      }
//    }
//  }

  // Start
  await client.start();
  console.info("🟢 Ready: %j", { userId, joinedRoomIds });

})();

