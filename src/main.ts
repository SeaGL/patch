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

  avatars: {
    seagl_logo_w_mic: "mxc://sal.td/abNlvOvvkVvujQYlAHGCJQJu",
//    home: "mxc:kvalhe.im/cXGNnZfJTYtnTbGIUptUmCsm",
//    presentation: "mxc:kvalhe.im/JQhaLcmOzIYdRsQfWiqMCkFA",
//    seagl: "mxc:kvalhe.im/bmasxrBuggGXtMmcaudPmYAN",
//    videoStream: "mxc:kvalhe.im/sfRfgfLzEAVbnprJQYjbQRJm",
  },
//  staffRoom: "!pQraPupVjTcEUwBmSt:seattlematrix.org", // #SeaGL-test:seattlematrix.org

    staff: [
//      "@Salt:matrix.org",
      "@salt:seattlematrix.org",
      "@salt:sal.td",
      "@tree:seattlematrix.org",
    ],
//    staff_power_levels: {
//      "@seagl-bot:seattlematrix.org": 99,
//      "@salt:sal.td": 100,
//      "@Salt:matrix.org": 50,
//      "@salt:seattlematrix.org": 99,
//    },
    
    default_power_levels: {
      "users": {
        "@seagl-bot:seattlematrix.org": 99,
        "@Salt:matrix.org": 50,
        "@salt:seattlematrix.org": 50,
        "@salt:sal.td": 100,
        "@tree:seattlematrix.org": 99,
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
      "invite": 50,
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

  // State
  let createdSpaces = false;
  let space;
  let mainSpace;
  let currentSessionsSpace;
  let hallwaySpace;
  let informationSpace;
  let upcomingSessionsSpace;
  let completedSessionsSpace;
  let restrictedSpace;
  const variables: Record<string, string> = {};

  // Find or create space
  const spacesSpec = [
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-test-main",
      isPublic: true,
      localAlias: "SeaGL2021-test-Main",
      name: "SeaGL 2021",
      suggested: true,
      topic: "Welcome to the #SeaGL2021 Space! Here you'll find a variety of conference rooms. Please look around, introduce yourself in #SeaGL2021-welcome , and ask any questions! | Please note, the SeaGL Code of Conduct is in effect and can be found here: https://seagl.org/coc",
    },
//    {
//      avatar: config.avatars.seagl_logo_w_mic,
//      id: "seagl2021-test-sessions-current",
//      isPublic: true,
//      localAlias: "SeaGL2021-test-Sessions-Current",
//      name: "Current Sessions | #SeaGL2021",
//      sortKey: "020",
//      suggested: true,
//      topic: "",
//    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-test-hallway",
      isPublic: true,
      localAlias: "SeaGL2021-test-Hallway",
      name: "Hallway | #SeaGL2021",
      sortKey: "030",
      suggested: true,
      topic: "",
    },
//    {
//      avatar: config.avatars.seagl_logo_w_mic,
//      id: "seagl2021-test-information",
//      isPublic: true,
//      localAlias: "SeaGL2021-test-Information",
//      name: "Information | #SeaGL2021",
//      sortKey: "040",
//      suggested: true,
//      topic: "",
//    },
//    {
//      avatar: config.avatars.seagl_logo_w_mic,
//      id: "seagl2021-test-sessions-upcoming",
//      isPublic: true,
//      localAlias: "SeaGL2021-test-Sessions-Upcoming",
//      name: "Upcoming Sessions | #SeaGL2021",
//      sortKey: "100",
//      suggested: false,
//      topic: "",
//    },
//    {
//      avatar: config.avatars.seagl_logo_w_mic,
//      id: "seagl2021-test-sessions-completed",
//      isPublic: false,
//      localAlias: "SeaGL2021-test-Sessions-Completed",
//      name: "Completed Sessions | #SeaGL2021",
//      sortKey: "200",
//      suggested: false,
//      topic: "",
//    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-test-restricted",
      isPublic: false,
      localAlias: "SeaGL2021-test-Restricted",
      name: "Restricted | #SeaGL2021",
      sortKey: "300",
      suggested: false,
      topic: "",
    },
  ];
  for (const spec of spacesSpec) {
    const spaceAlias = `#${spec.localAlias}:${config.homeserver}`;
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

      if (spec.id === "seagl2021-test-main") {
        space = await limiter.schedule(() =>
          client.createSpace({
            avatarUrl: spec.avatar,
            invites: config.staff,
            isPublic: spec.isPublic,
            localpart: spec.localAlias,
            name: spec.name,
  //          room_version: "9",
            topic: spec.topic,
          })
        );
        mainSpace = space;
        variables.mainSpace = (await MentionPill.forRoom(mainSpace.roomId, client)).html;
      } else {
        space = await limiter.schedule(() =>
          mainSpace.createChildSpace({
            avatarUrl: spec.avatar,
            isPublic: spec.isPublic,
            localpart: spec.localAlias,
            name: spec.name,
  //          room_version: "9",
            topic: spec.topic,
          })
        );
      }
      // set default space power_levels
//      const currentLevels = await limiter.schedule(() =>
//        client.getRoomStateEvent(space.roomId, "m.room.power_levels", "")
//      );
//      currentLevels['users'] = config.staff_power;
//      await limiter.schedule(() =>
//        client.sendStateEvent(space.roomId, "m.room.power_levels", "", currentLevels)
//      );
      await limiter.schedule(() =>
        client.sendStateEvent(space.roomId, "m.room.power_levels", "", config.default_power_levels)
      );
      joinedRoomIds.add(space.roomId);
      console.info("🏘️ Created space: %j", {
        roomId: space.roomId,
        spec: spec,
      });
    }
  }
  mainSpace = await limiter.schedule(() => client.getSpace(`#SeaGL2021-test-Main:sal.td`));
//  currentSessionsSpace = await limiter.schedule(() => client.getSpace("#SeaGL2021-test-Sessions-Current:sal.td"));
  hallwaySpace = await limiter.schedule(() => client.getSpace(`#SeaGL2021-test-Hallway:sal.td`));
//  informationSpace = await limiter.schedule(() => client.getSpace(`#SeaGL2021-test-Information:sal.td`));
//  upcomingSessionsSpace = await limiter.schedule(() => client.getSpace(`#SeaGL2021-test-Sessions-Upcoming:sal.td`));
//  completedSessionsSpace = await limiter.schedule(() => client.getSpace(`#SeaGL2021-test-Sessions-Completed:sal.td`));
  restrictedSpace = await limiter.schedule(() => client.getSpace(`#SeaGL2021-test-Restricted:sal.td`));
//  variables.currentSessionsSpace = (await MentionPill.forRoom(currentSessionsSpace.roomId, client)).html;
//  variables.hallwaySpace = (await MentionPill.forRoom(hallwaySpace.roomId, client)).html;
//  variables.informationSpace = (await MentionPill.forRoom(informationSpace.roomId, client)).html;
//  variables.upcomingSessionsSpace = (await MentionPill.forRoom(upcomingSessionsSpace.roomId, client)).html;
//  variables.completedSessionsSpace = (await MentionPill.forRoom(completedSessionsSpace.roomId, client)).html;
//  variables.restrictedSpace = (await MentionPill.forRoom(restrictedSpace.roomId, client)).html;
  createdSpaces = true;

//  // Add staff room to space
//  if (createdSpace && joinedRoomIds.has(config.staffRoom)) {
//    await limiter.schedule(() =>
//      space.addChildRoom(config.staffRoom, { order: "800" })
//    );
//  }

  // Find or create rooms
  const getOsemRoomSpecs = async (slug) => {
    const url = `https://osem.seagl.org/api/v2/conferences/${slug}`;
    const response = (await (await fetch(url)).json()) as any;

    const records = new Map<string, any>();
    for (const record of response.included) {
      records.set(`${record.type}-${record.id}`, record);
    }

//    return response.data.relationships.events.data.map(({ id, type }) => {
    const response_map_test = response.data.relationships.events.data.map(({ id, type }) => {
      const record = records.get(`${type}-${id}`);
      const beginning = DateTime.fromISO(record.attributes.beginning);

      return {
        avatar: config.avatars.seagl_logo_w_mic,
        id: `seagl2021-osem-${type}-${id}`,
        name: `${beginning.toFormat("EEE HH:mm")} - ${record.attributes.title}`,
        sortKey: "100",
        subspace: "sessions",
        topic: "#SeaGL2021 Conference Session · Code of Conduct: https://seagl.org/coc",
        welcome:
          "Squawk! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This room is dedicated to a single conference session. See {mainSpace} for a listing of all rooms.",
//        widget: {
//          avatar: config.avatars.seagl_logo_w_mic,
//          name: "Video Stream",
//          stateKey: "2021roomgenerator",
//          url: "https://attend.seagl.org/widgets/video-stream.html",
//        },
      };
    });
    
    console.error(response_map_test);
    process.exitCode = 1;
    return response_map_test;
  };
  const roomsSpec = [
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-test-welcome",
      localAlias: "SeaGL2021-test-Welcome",
      name: "Welcome | #SeaGL2021",
      sortKey: "010",
      suggested: true,
      topic: "",
      welcome:
        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is a central room for introductions and general discussion. See {mainSpace} for a listing of all rooms.",
//      widget: {
//        avatar: config.avatars.seagl_logo_w_mic,
//        name: "Welcome",
//        stateKey: "2021roomgenerator",
//        url: "https://attend.seagl.org/widgets/welcome.html",
//      },
    },
//    {
//      avatar: config.avatars.seagl_logo_w_mic,
//      id: "seagl2021-test-announcements",
//      localAlias: "SeaGL2021-test-Announcements",
//      name: "Announcements | #SeaGL2021",
//      sortKey: "011",
//      suggested: true,
//      topic: "",
//      welcome: "",
//    },
//    {
//      avatar: config.avatars.seagl_logo_w_mic,
//      id: "seagl2021-test-social",
//      localAlias: "SeaGL2021-test-Social",
//      name: "Social | #SeaGL2021",
//      sortKey: "031",
//      subspace: "hallway",
//      suggested: true,
//      topic: "",
//      welcome:
//        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is a central room for \"hallway track\" socializing. See {mainSpace} for a listing of all rooms.",
//    },
//    {
//      avatar: config.avatars.seagl_logo_w_mic,
//      id: "seagl2021-test-sponsors",
//      localAlias: "SeaGL2021-test-Sponsors",
//      name: "Sponsors | #SeaGL2021",
//      sortKey: "032",
//      subspace: "hallway",
//      suggested: true,
//      topic: "",
//      welcome:
//        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is a central room for meeting our generous sponsors. See {mainSpace} for a listing of all rooms.",
//    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-test-career-expo",
      localAlias: "SeaGL2021-test-Career-Expo",
      name: "Career Expo | #SeaGL2021",
      sortKey: "033",
      subspace: "hallway",
      suggested: false,
      topic: "",
      welcome:
        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is a central room for participating in the career expo. See {mainSpace} for a listing of all rooms.",
    },
//    {
//      avatar: config.avatars.seagl_logo_w_mic,
//      id: "seagl2021-test-info-booth",
//      localAlias: "SeaGL2021-test-Info-Booth",
//      name: "Info Booth | #SeaGL2021",
//      sortKey: "041",
//      subspace: "information",
//      suggested: true,
//      topic: "",
//      welcome: "",
//    },
//    {
//      avatar: config.avatars.seagl_logo_w_mic,
//      id: "seagl2021-test-bot-help",
//      localAlias: "SeaGL2021-test-Bot-Help",
//      name: "Bot Help | #SeaGL2021",
//      sortKey: "042",
//      subspace: "information",
//      suggested: true,
//      topic: "",
//      welcome: "",
//    },
//    {
//      avatar: config.avatars.seagl_logo_w_mic,
//      id: "seagl2021-test-speaker-help",
//      localAlias: "SeaGL2021-test-Speaker-Help",
//      name: "Speaker Help | #SeaGL2021",
//      sortKey: "043",
//      subspace: "information",
//      suggested: false,
//      topic: "",
//      welcome: "",
//    },
//    {
//      avatar: config.avatars.seagl_logo_w_mic,
//      id: "seagl2021-test-sponsor-help",
//      localAlias: "SeaGL2021-test-Sponsor-Help",
//      name: "Sponsor Help | #SeaGL2021",
//      sortKey: "044",
//      subspace: "information",
//      suggested: false,
//      topic: "",
//      welcome: "",
//    },
//    {
//      avatar: config.avatars.seagl_logo_w_mic,
//      id: "seagl2021-test-volunteering",
//      localAlias: "SeaGL2021-test-Volunteering",
//      name: "Volunteering | #SeaGL2021",
//      sortKey: "045",
//      subspace: "information",
//      suggested: false,
//      topic: "",
//      welcome: "",
//    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-test-orchestration",
      localAlias: "SeaGL2021-test-Orchestration",
      name: "Orchestration | #SeaGL2021",
      sortKey: "310",
      subspace: "restricted",
      suggested: false,
      topic: "",
      welcome:
        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is a central room for orchestrating the conference. See {mainSpace} for a listing of all rooms.",
    },
//    {
//      avatar: config.avatars.seagl_logo_w_mic,
//      id: "seagl2021-test-volunteers",
//      localAlias: "SeaGL2021-test-Volunteers",
//      name: "Volunteers | #SeaGL2021",
//      sortKey: "320",
//      subspace: "restricted",
//      suggested: false,
//      topic: "",
//      welcome: "",
//    },
//    {
//      avatar: config.avatars.seagl_logo_w_mic,
//      id: "seagl-triage",
//      localAlias: "SeaGL-Triage",
//      name: "SeaGL Triage",
//      sortKey: "330",
//      subspace: "restricted",
//      suggested: false,
//      topic: "",
//      welcome: "",
//    },
//    {
//      avatar: config.avatars.seagl_logo_w_mic,
//      id: "seagl-tech",
//      localAlias: "SeaGL-Tech",
//      name: "SeaGL Tech",
//      sortKey: "340",
//      subspace: "restricted",
//      suggested: false,
//      topic: "",
//      welcome: "",
//    },
//    {
//      avatar: config.avatars.seagl_logo_w_mic,
//      id: "seagl-test",
//      localAlias: "SeaGL-Test",
//      name: "SeaGL Test",
//      sortKey: "350",
//      subspace: "restricted",
//      suggested: false,
//      topic: "",
//      welcome: "",
//    },
//    {
//      avatar: config.avatars.seagl_logo_w_mic,
//      id: "seagl-staff",
//      localAlias: "SeaGL-Staff",
//      name: "SeaGL Staff",
//      sortKey: "360",
//      subspace: "restricted",
//      suggested: false,
//      topic: "",
//      welcome: "",
//    },
//    {
//      avatar: config.avatars.seagl_logo_w_mic,
//      id: "seagl-bot-log",
//      localAlias: "SeaGL-Bot-Log",
//      name: "SeaGL Bot Log",
//      sortKey: "370",
//      subspace: "restricted",
//      suggested: false,
//      topic: "",
//      welcome: "",
//    },
//    ...(await getOsemRoomSpecs("seagl2021")),
  ];
  for (const spec of roomsSpec) {
    let roomId = roomIdById.get(spec.id);
    if (roomId === undefined) {
      if (spec.subspace === "restricted") {
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
                type: "m.room.join_rules",
                state_key: "",
                content: {
                  "join_rule": "restricted",
                  "allow": [{
                    "type": "m.room_membership",
                    "room_id": restrictedSpace.roomId,
                  }],
                },
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
            power_level_content_override: config.default_power_levels,
  //            preset: "private_chat",
            room_alias_name: spec.localAlias,
            room_version: "9",
            topic: spec.topic,
            visibility: "private",
          })
        );
      } else {
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
            power_level_content_override: config.default_power_levels,
            preset: "public_chat",
            room_alias_name: spec.localAlias,
            room_version: "9",
            topic: spec.topic,
            visibility: "public",
          })
        );
      }
      roomIdById.set(spec.id, roomId);
      joinedRoomIds.add(roomId);
      console.info("🏠 Created room: %j", { roomId, spec });
      if (spec.subspace === undefined) {
        await limiter.schedule(() =>
          mainSpace.addChildRoom(roomId, {
            order: spec.sortKey,
            suggested: spec.suggested,
          })
        );
      }
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

  // Add rooms to correct subspaces
  for (const spec of roomsSpec) {
    let roomId = roomIdById.get(spec.id);
    if (roomId !== undefined) {
      if (spec.subspace === "hallway") {
        await limiter.schedule(() =>
          hallwaySpace.addChildRoom(roomId, {
            order: spec.sortKey,
            suggested: spec.suggested,
          })
        );
      }
      if (spec.subspace === "information") {
        await limiter.schedule(() =>
          informationSpace.addChildRoom(roomId, {
            order: spec.sortKey,
            suggested: spec.suggested,
          })
        );
      }
      if (spec.subspace === "sessions") {
        await limiter.schedule(() =>
          upcomingSessionsSpace.addChildRoom(roomId, {
            order: spec.sortKey,
            suggested: spec.suggested,
          })
        );
      }
      if (spec.subspace === "restricted") {
        await limiter.schedule(() =>
          restrictedSpace.addChildRoom(roomId, {
            order: spec.sortKey,
            suggested: spec.suggested,
          })
        );
      }
    } else {
      console.info("🏠 Room has not yet been created: %j", { id: spec.id });
    }
  }
  
  // Set restricted space to private
//  restrictedSpace.power??


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
//          client.sendHtmlNotice(roomId, `Come join me in ${variables.mainSpace}!`)
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
//  if (createdSpace && joinedRoomIds.has(config.staffRoom)) {
//    await limiter.schedule(() =>
//      client.sendHtmlNotice(
//        config.staffRoom,
//        `Come join me in ${variables.mainSpace}!`
//      )
//    );
//  }
})();
