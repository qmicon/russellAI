#!/bin/bash
# run this script from the main directory of the repo, dont come inside the parent directory of this script to run it
# command to run: bash discord/ai-hormozi/aiHormoziBot.sh
# make sure you have added the discord bot token in the .env file with the env variable name
source .env
ENV_VARIABLE="DISCORD_BOT_TOKEN_ai_hormozi"

# Check if the environment variable is defined
if [[ -n "${!ENV_VARIABLE}" ]]; then
  echo "${ENV_VARIABLE} is defined"
  cp discord/ai-russell/aiRussellBot.mjs discord/ai-hormozi/aiHormoziBot.mjs
  cd discord/ai-hormozi
  if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    pm2 start --name "ai-hormozi" aiHormoziBot.mjs
  elif [[ "$OSTYPE" == "msys"* || "$OSTYPE" == "win32"* ]]; then
    node aiHormoziBot.mjs
  else
    echo "Unsupported operating system"
  fi
else
  echo "${ENV_VARIABLE} is not defined"
fi
