# Fetching the minified node image on apline linux
FROM node:lts-slim

# Declaring env
ENV NODE_ENV development

# Setting up the work directory
WORKDIR /webapi-express-docker

# Copying all the files in our project
COPY ./web-api /webapi-express-docker/web-api

#TODO: Copy env and config from root dir

COPY ./.env /webapi-express-docker/web-api/.env
COPY ./config.json /webapi-express-docker/web-api/config.json

WORKDIR /webapi-express-docker/web-api

# Installing dependencies
RUN npm install

# Starting our applications
CMD [ "node", "webApi.js" ]

# Exposing server port
EXPOSE 3292 6379