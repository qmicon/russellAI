# Fetching the minified node image on apline linux
FROM node:slim

# Declaring env
ENV NODE_ENV development

# Setting up the work directory
WORKDIR /express-docker

# Copying all the files in our project
COPY . .

#TODO: Copy env and config from root dir

# Installing dependencies
RUN npm install

# Starting our application
CMD [ "node", "stripeWebhook.js" ]

# Exposing server port
EXPOSE 4242 6379