FROM node:18

WORKDIR /usr/src/app

# Dependencies
COPY package.json yarn.lock ./
RUN yarn install --immutable && yarn cache clean

# Build
COPY tsconfig.json ./
COPY src ./src
RUN yarn build
COPY data ./data

# State
RUN mkdir state && chown node:node state
VOLUME /usr/src/app/state

# Execution
USER node
CMD yarn start
