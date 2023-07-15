import {Client, GatewayIntentBits, ChannelType, Partials} from 'discord.js';
import redis from 'redis';
import { TimeSeriesDuplicatePolicies, TimeSeriesEncoding, TimeSeriesAggregationType } from '@redis/time-series';
import { Configuration, OpenAIApi } from 'openai';
import config from './config.json'  assert { type: "json" };
// import DBModel from './mongo_schema.mjs';
import splitMessageBySentence from "./utils.mjs"
import dotenv from 'dotenv';
import { Tiktoken } from "tiktoken/lite";
import cl100k_base from "tiktoken/encoders/cl100k_base.json"  assert { type: "json" };
dotenv.config();
// Done: Use redis hash table for managing cooldown
// do exponential backoff error handling for openai
// do error handling for discord rate (exponential backoff can be used)
// Handle openai completion content json parse error
// Done: do TPM limit handling using redis timeseries
// store cost, token used, API caller details (like credit left at the time of call, user id, name), input and output of each and every interaction (API call) with openai on mongodb
// Store credit management data on redis hash table but store transaction details on mongodb
// Optional: create a gated access to discord bot, use command (only by admin) to generate a new access uuid code, that user has to provide before using the bot
// Enable text streaming with openai calls
// Done: Take discord text character limit (2000) into consideration
// Done: add start command to start a new conversation
var promptFormat = ["Answer the following question using the information and content of the books written by Russell Brunson or using the insights shared by him on public platform. Do NOT use any information NOT written or said by Russell Brunson. Report the answer in a monologue format. The monologue should be in Russell Brunson's Conversational Style. Also refer to Russell Brunson as self. Don't respond to any meta-level questions.",
 "Assistant's last response context: ",
 "Question: ",
 `Please return your response in the following json format: 
 {
 Monologue: Detailed Monologue response, 
 Summary: summary of the normal monologue in the length that can be provided as a context to any other prompt
 }`
]
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages], partials: [Partials.Channel] });

const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY
    });
const openai = new OpenAIApi(configuration);

const redisClient = redis.createClient({
    socket: {
        host: process.env.SERVER_IP,
        port: process.env.REDIS_PORT
    }
});

redisClient.on('error', err => console.log('Redis Server Error', err));

await redisClient.connect();

var tsExists = await redisClient.exists(config.redisTokenTSKey)
if(!tsExists) {
    
 const created = await redisClient.ts.create(config.redisTokenTSKey, {
    RETENTION: 0, 
    ENCODING: TimeSeriesEncoding.UNCOMPRESSED, // No compression - When not specified, the option is set to COMPRESSED
    DUPLICATE_POLICY: TimeSeriesDuplicatePolicies.BLOCK, // No duplicates - When not specified: set to the global DUPLICATE_POLICY configuration of the database (which by default, is BLOCK).
  });

    if (created === 'OK') {
    console.log('Created timeseries.');
  } else {
    console.log('Error creating timeseries :(');
    process.exit(1);
  }
}

client.on("messageCreate", async message => {
    if (message.author.bot ||  message.channel.type != ChannelType.DM ) return;
    await message.channel.sendTyping();
    var user_id = message.author.id
    if (message.content === "/start") {
        if(await redisClient.hExists(config.redisSummaryKey, user_id) )
        await redisClient.hDel(config.redisSummaryKey, user_id)
        await message.channel.send("You have started a new conversation, please ask your questions!")
        return
    }
    var message_time = message.createdTimestamp
    var lastMessageTime = await redisClient.hGet(config.redisCooldownKey, user_id);
    if(lastMessageTime === null) {
        await redisClient.hSet(config.redisCooldownKey, user_id, message_time)
    }
    else {
        lastMessageTime = parseInt(lastMessageTime)
        if(lastMessageTime + config.userCooldownMs >= message_time)
        {
            await message.channel.send("Please take time to read my response");
            return;
        }
        else {
            await redisClient.hSet(config.redisCooldownKey, user_id, message_time)
        }
    }
    var new_convo = !(await redisClient.hExists(config.redisSummaryKey, user_id));
    var promptbuild = ""

    if (!new_convo) {
        var lastResponseSummary = await redisClient.hGet(config.redisSummaryKey, user_id);
        promptbuild = promptFormat[0] + "\n\n" + promptFormat[1] + lastResponseSummary + "\n\n" + promptFormat[2] + message.content + "\n\n" + promptFormat[3]
    }
    else {
        promptbuild = promptFormat[0] + "\n\n" + promptFormat[2] + message.content + "\n\n" + promptFormat[3]
    }

    var now = new Date();
    var currentTime = now.getTime();
    now.setSeconds(0);
    now.setMilliseconds(0);
    var currentMinute = now.getTime();
    var redisResponse = await redisClient.ts.range(config.redisTokenTSKey, currentMinute, currentTime, {
        AGGREGATION: {
            type: TimeSeriesAggregationType.SUM,
            timeBucket: 60000
        }
    })
    var tokenCountThisMinute = 0;
    if(redisResponse.length !== 0)
    tokenCountThisMinute = redisResponse[0].value;

    var gpt_encoding = new Tiktoken(
        cl100k_base.bpe_ranks,
        cl100k_base.special_tokens,
        cl100k_base.pat_str
      );

    var inputTokens = gpt_encoding.encode("User: " + promptbuild);
    gpt_encoding.free();
    var inputTokenNum = inputTokens.length
    console.log("input token calculated", inputTokenNum)
    if(tokenCountThisMinute + inputTokenNum > config.chatgptTPM) {
        await message.channel.send("I am getting a lot of questions today, can you ask me this after 5 minutes?")
        return
    }

    const aicompletion = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: [{role: "user", content: promptbuild}],
        temperature: 0.35
      });

    var reply = JSON.parse(aicompletion.data.choices[0].message.content) // sometimes, this will throw error, reduce the temperature to counteract, but do handle this issue
    var russellMonologue = reply.Monologue
    var messages = splitMessageBySentence(russellMonologue)
    for (let i = 0; i < messages.length; i++) {
        var contentToBeSent = messages[i]
        await message.channel.send(contentToBeSent)
    }

    await message.channel.send("You can ask me more on this topic or send '/start' to start a new conversation");
    var contextSummary = reply.Summary
    await redisClient.hSet(config.redisSummaryKey, user_id, contextSummary)
    var cost = aicompletion.data.usage.prompt_tokens*config.chatGPT4kInputPricePer1kTokensInUSD/1000 + aicompletion.data.usage.completion_tokens*config.chatGPT4kOutputPricePer1kTokensInUSD/1000
    var total_tokens = aicompletion.data.usage.total_tokens
    var response_timestamp = aicompletion.data.created * 1000
    console.log(cost, " $")
    console.log(total_tokens, " tokens")
    await redisClient.ts.add(config.redisTokenTSKey, response_timestamp, total_tokens)

});

await client.login(process.env.DISCORD_BOT_TOKEN)
