# `plan.yml`

`data/plan.yml` contains the data definitions for how the conference Matrix space will be laid out.

## `homeserver`

The Matrix homeserver to create the conference space on.

## `jitsiDomain`

The Jitsi domain that will be used for social Jitsi rooms.

## `defaultRoomVersion`

The default [Matrix room version](https://spec.matrix.org/latest/rooms/) to use when creating rooms.

## `timeZone`

TODO

## `avatars`

TODO

## `inheritUserPowerLevels`

TODO

## `powerLevels`

Contains two sublists, `events` and `users`.

### `events`

TODO

### `users`

A mapping of Matrix username (`@user:domain.tld`) to the power level that user will be set to in every conference room.

The special name `steward` refers to the bot itself and is required to be set to `100`. Do not set any other user to power level 100; you will have a Very Bad Time™.

## `steward`

Information about the bot Matrix user. Contains three keys:

* `id`: the Matrix username (`@user:domain.tld`) for the bot to use
* `name`: the profile name the bot will set
* `avatar`: TODO

## `rooms`

TODO

## `sessions`

Contains data on how to retrieve and process events from OSEM.

### `conference`

The OSEM conference ID to retrieve sessions from.

### `redirects`

TODO

### `prefix`

The prefix for all Matrix OSEM-event-room addresses.

### `suffixes`

Mapping from a numerical OSEM event ID (you will need to quote the number, e.g., `"1337"`) to the suffix that will be appended to `prefix` to create the complete event room Matrix address.

### `topic`

Matrix room topic.

### `intro`

Introduction message that will be posted in every Matrix event room.

Supports Markdown and the following special tokens:

* `$URL`: the OSEM event URL
* TODO
