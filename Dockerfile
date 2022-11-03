FROM node:18

WORKDIR /usr/src/app

# Dependencies
COPY package.json yarn.lock ./
RUN yarn install --immutable

# Build
COPY src tsconfig.json ./
RUN yarn build

# Runtime data
COPY data ./data

VOLUME state
USER node
CMD yarn start
