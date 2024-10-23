<p align="center" width="100%"><img alt="Patch" src="./avatar.png" width="96" /></p>

# Patch

*Patch*, named after the [SeaGL] mascot, is a Matrix bot that assists with running the [SeaGL Matrix space].

## Usage

Install dependencies:

  - [Node.js], [Yarn Classic], and the packages installed via `yarn install`

Populate environment variables:

  - [Matrix Client-Server API]:
    - `MATRIX_ACCESS_TOKEN`: Secret authentication token (see [this Stack Exchange question] for how to get one)
    - `MATRIX_BASE_URL`: Homeserver base URL
    - `MATRIX_RATE_LIMIT`: Rate limit in hertz
    - `ISSUE_8895_COOLDOWN`: Seconds to wait before room creation ([matrix-org/synapse#8895])
  - [Pretalx]:
    - `PRETALX_RATE_LIMIT`: Rate limit in hertz
  - [Sentry]:
    - `SENTRY_DSN` (Optional): Data Source Name of Sentry project. If unset, error reporting is not enabled.

Build the bot:

```bash
yarn build
```

Start the bot:

```bash
yarn start
```

[Matrix Client-Server API]: https://spec.matrix.org/v1.4/client-server-api/
[this Stack Exchange question]: https://webapps.stackexchange.com/q/131056/19769
[matrix-org/synapse#8895]: https://github.com/matrix-org/synapse/issues/8895
[Node.js]: https://nodejs.org/
[Pretalx]: https://pretalx.seagl.org/
[SeaGL]: https://seagl.org/
[SeaGL Matrix space]: https://seagl.org/meet
[Sentry]: https://sentry.io/
[Yarn Classic]: https://classic.yarnpkg.com/
