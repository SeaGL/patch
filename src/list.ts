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
  const roomIdById = new Map();
  for (const roomId of joinedRoomIds) {
    const id = (await getCustomData(roomId))?.id;
    if (id !== undefined) {
      roomIdById.set(id, roomId);
    }
  }
  
  // Specify lists of rooms
  const spacesSpec = [
//    {
//      id: "seagl2021-main",
//      isPublic: true,
//      localAlias: "SeaGL2021-Main",
//    },
    {
      id: "seagl2021-sessions-current",
      isPublic: true,
      localAlias: "SeaGL2021-Sessions-Current",
      sortKey: "020",
    },
    {
      id: "seagl2021-information",
      isPublic: true,
      localAlias: "SeaGL2021-Information",
      sortKey: "030",
    },
    {
      id: "seagl2021-hallway",
      isPublic: true,
      localAlias: "SeaGL2021-Hallway",
      sortKey: "040",
    },
    {
      id: "seagl2021-restricted",
      isPublic: false,
      localAlias: "SeaGL2021-Restricted",
      sortKey: "100",
    },
    {
      id: "seagl2021-sessions-upcoming",
      isPublic: true,
      localAlias: "SeaGL2021-Sessions-Upcoming",
      sortKey: "200",
    },
    {
      id: "seagl2021-sessions-completed",
      isPublic: false,
      localAlias: "SeaGL2021-Sessions-Completed",
      sortKey: "300",
    },
  ];

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
        id: `seagl2021-osem-${type}-${id}`,
        sortKey: "100",
        subspace: "sessions",
        roomType: "session",
      };
    });
  };
  
  const roomsSpec = [
    {
      id: "seagl2021-welcome",
      localAlias: "SeaGL2021-Welcome",
      sortKey: "010",
    },
    {
      id: "seagl2021-announcements",
      localAlias: "SeaGL2021-Announcements",
      sortKey: "011",
    },
    {
      id: "seagl2021-info-booth",
      localAlias: "SeaGL2021-Info-Booth",
      sortKey: "031",
      subspace: "information",
    },
    {
      id: "seagl2021-bot-help",
      localAlias: "SeaGL2021-Bot-Help",
      sortKey: "032",
      subspace: "information",
    },
    {
      id: "seagl2021-speaker-help",
      localAlias: "SeaGL2021-Speaker-Help",
      sortKey: "033",
      subspace: "information",
    },
    {
      id: "seagl2021-sponsor-help",
      localAlias: "SeaGL2021-Sponsor-Help",
      sortKey: "034",
      subspace: "information",
    },
    {
      id: "seagl2021-volunteering",
      localAlias: "SeaGL2021-Volunteering",
      sortKey: "035",
      subspace: "information",
    },
    {
      id: "seagl2021-social",
      localAlias: "SeaGL2021-Social",
      sortKey: "041",
      subspace: "hallway",
    },
    {
      id: "seagl2021-career-expo",
      localAlias: "SeaGL2021-Career-Expo",
      sortKey: "050",
      subspace: "hallway",
    },
    {
      id: "seagl2021-sponsors",
      localAlias: "SeaGL2021-Sponsors",
      sortKey: "051",
      subspace: "hallway",
    },
    {
      id: "seagl2021-sponsor-aws",
      localAlias: "SeaGL2021-Sponsor-AWS",
      sortKey: "052",
      subspace: "hallway",
    },
    {
      id: "seagl2021-sponsor-jmp",
      localAlias: "SeaGL2021-Sponsor-JMP",
      sortKey: "053",
      subspace: "hallway",
    },
    {
      id: "seagl2021-sponsor-google",
      localAlias: "SeaGL2021-Sponsor-Google",
      sortKey: "054",
      subspace: "hallway",
    },
    {
      id: "seagl2021-sponsor-ubuntu",
      localAlias: "SeaGL2021-Sponsor-Ubuntu",
      sortKey: "055",
      subspace: "hallway",
    },
    {
      id: "seagl2021-sponsor-red-hat",
      localAlias: "SeaGL2021-Sponsor-Red-Hat",
      sortKey: "056",
      subspace: "hallway",
    },
    {
      id: "seagl2021-sponsor-tidelift",
      localAlias: "SeaGL2021-Sponsor-Tidelift",
      sortKey: "057",
      subspace: "hallway",
    },
    {
      id: "seagl2021-sponsor-extrahop",
      localAlias: "SeaGL2021-Sponsor-ExtraHop",
      sortKey: "058",
      subspace: "hallway",
    },
    {
      id: "seagl2021-orchestration",
      localAlias: "SeaGL2021-Orchestration",
      sortKey: "110",
      subspace: "restricted",
    },
    {
      id: "seagl2021-volunteers",
      localAlias: "SeaGL2021-Volunteers",
      sortKey: "120",
      subspace: "restricted",
    },
    {
      id: "seagl2021-career-expo-internal",
      localAlias: "SeaGL2021-Career-Expo-Internal",
      sortKey: "130",
      subspace: "restricted",
    },
//    {
////      id: "seagl-triage",
//      localAlias: "SeaGL-Triage",
//      sortKey: "140",
//      subspace: "restricted",
//    },
//    {
////      id: "seagl-tech",
//      localAlias: "SeaGL-Tech",
//      sortKey: "150",
//      subspace: "restricted",
//    },
//    {
////      id: "seagl-test",
//      localAlias: "SeaGL-Test",
//      sortKey: "160",
//      subspace: "restricted",
//    },
//    {
////      id: "seagl-staff",
//      localAlias: "SeaGL-Staff",
//      sortKey: "170",
//      subspace: "restricted",
//    },
    {
      id: "seagl-bot-log",
      localAlias: "SeaGL-Bot-Log",
      sortKey: "180",
      subspace: "restricted",
    },
    ...(await getOsemRoomSpecs("seagl2021")),
  ];

  const testSpec = [
    {
      localAlias: "SeaGL2021-Sessions-Current",
    },
  ];

  // Print list of rooms
  for (const roomId of joinedRoomIds) {
    try {
      const roomState = await limiter.schedule(() =>
        client.getRoomState(roomId)
      );

      try {
        console.info("roomId: %j", roomState.find(e => e.type === 'm.room.create').room_id,);
      } catch (error: any) {
        if (error instanceof TypeError) {
          console.info("roomCreate not found")
        } else {
          throw error;
        }
      }

      try {
        console.info("roomName: %j", roomState.find(e => e.type === 'm.room.name').content.name);
      } catch (error: any) {
        if (error instanceof TypeError) {
          console.info("roomName not found")
        } else {
          throw error;
        }
      }

      try {
        console.info("roomJoinRules: %j", roomState.find(e => e.type === 'm.room.join_rules').content.join_rule);
      } catch (error: any) {
        if (error instanceof TypeError) {
          console.info("roomJoinRules not found")
        } else {
          throw error;
        }
      }

      try {
        console.info("roomAliases: %j", roomState.find(e => e.type === 'm.room.canonical_alias').content);
      } catch (error: any) {
        if (error instanceof TypeError) {
          console.info("roomAliases not found")
        } else {
          throw error;
        }
      }
      
      console.info("---")
    } catch (error: any) {
      throw error;
    }
  }

  // Start
  await client.start();
  console.info("🟢 Ready: %j", { userId, joinedRoomIds });

})();

