import {Client, GatewayIntentBits, ChannelType, Partials} from 'discord.js';
import redis from 'redis';
import { TimeSeriesDuplicatePolicies, TimeSeriesEncoding, TimeSeriesAggregationType } from '@redis/time-series';
import { Configuration, OpenAIApi } from 'openai';
import config from '../config.json'  assert { type: "json" };
// import DBModel from './mongo_schema.mjs';
import {splitMessageBySentence, postDataRunpod} from './utils.mjs'
import dotenv from 'dotenv';
import { Tiktoken } from "tiktoken/lite";
import cl100k_base from "tiktoken/encoders/cl100k_base.json"  assert { type: "json" };
import stripe from 'stripe';
import fs from 'fs'

dotenv.config({path:'../.env'});
const stripeServer = stripe(process.env.STRIPE_CLIENT_SECRET)
// Done: Use redis hash table for managing cooldown
// do exponential backoff error handling for openai
// do error handling for discord rate (exponential backoff can be used)
// Handle openai completion content json parse error
// Done: do TPM limit handling using redis timeseries
// store cost, token used, API caller details (like credit left at the time of call, user id, name), input and output of each and every interaction (API call) with openai on mongodb
// Done: Store credit management data on redis hash table
// store transaction details on mongodb
// Optional: create a gated access to discord bot, use command (only by admin) to generate a new access uuid code, that user has to provide before using the bot
// Optional: Enable text streaming with openai calls
// Done: Take discord text character limit (2000) into consideration
// Done: add start command to start a new conversation
var promptFormat = [`Answer the following question using the information and content of the books written by ${config.AISpeaker} or using the insights shared by him on public platform. Do NOT use any information NOT written or said by ${config.AISpeaker}. Report the answer in a monologue format. The monologue should be in ${config.AISpeaker}'s Conversational Style. Also refer to ${config.AISpeaker} as self. Don't respond to any meta-level questions.`,
 "Assistant's last response context: ",
 "Question: ",
 `Please return your response in the following json format: 
 {
    Monologue: Very Detailed Monologue response, 
    SpeakerMonologue: Less Detailed Normal Monologue response
 }`
]
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages], partials: [Partials.Channel] });

// client.users.fetch(user-id).createDM().messages.fetch(message-id).reply()

const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY
    });
const openai = new OpenAIApi(configuration);

const redisClient = redis.createClient({
    socket: {
        host: process.env.SERVER_IP,
        port: process.env.REDIS_PORT
    },
    password: process.env.REDIS_PASSWORD
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

const sendFile = async (ids) => {
    var user = await client.users.fetch(ids[0])
    var DMchannel = await user.createDM()
    var message = await DMchannel.messages.fetch(ids[1])
    await message.reply({
        embeds: [{
            title: 'Voice Note'
        }],
        files: [{
            attachment: `../files/wav-files/${ids[0]}_${ids[1]}.wav`,
            name: "russell AI voice note.wav"
        }]
    })
    fs.unlink(`../files/wav-files/${ids[0]}_${ids[1]}.wav`,function(err){
        if(err) return console.log(err);
        console.log('file deleted successfully');
   }) 
}
async function consumeRedisStream() {
 var res = await redisClient.xReadGroup(config.redisAudioStreamConsumerGroup, "A", {key: config.redisAudioStreamKey, id: '>'})
 if(!res) return;
 var messages = res[0].messages
 for(let i=0; i<messages.length; i++) {
    var msg = messages[i].message.message
    var discord_ids = msg.split(":")
    await sendFile(discord_ids)
 }

}

async function repeatedCall() {
    await consumeRedisStream()
    setTimeout(repeatedCall, 1000)
}

client.on("ready", async () => {
    console.log("ready");
    await repeatedCall();
    
})

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

    if(message.content.startsWith("/buy ")) {
        var quantity = message.content.split("/buy ")[1]
        quantity = parseInt(quantity)
        const paymentLink = await stripeServer.paymentLinks.create({
            line_items: [
              {
                price: config.botCreditsPriceID,
                quantity: quantity,
              },
            ],
          });
        await redisClient.hSet(config.redisPaymentKey, paymentLink.id, user_id);
        await message.channel.send(`${paymentLink.url}\n\nPlease make the payment to buy credits. send '/balance' to check your credit balance`);
        return
    }

    if(message.content === "/balance") {
        var balance = await redisClient.hGet(config.redisCreditsKey, user_id);
        await message.channel.send(`You have ${balance} queries left.`)
        return
    }
    var creditsLeft = 0
    if (await redisClient.hExists(config.redisCreditsKey, user_id))
    {creditsLeft = await redisClient.hGet(config.redisCreditsKey, user_id)
    creditsLeft = parseInt(creditsLeft)}
    if(creditsLeft <= 0) {
        await message.channel.send("You don't have credits to make a query, send '/buy <quantity>' to buy credits");
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

    await redisClient.hSet(config.redisCreditsKey, user_id, creditsLeft - 1)

    var reply = JSON.parse(aicompletion.data.choices[0].message.content) // sometimes, this will throw error, reduce the temperature to counteract, but do handle this issue
    var russellMonologue = reply.Monologue
    var messages = splitMessageBySentence(russellMonologue, "char")
    var sentMessage = null
    for (let i = 0; i < messages.length; i++) {
        var contentToBeSent = messages[i]
        if(!sentMessage)
        sentMessage = await message.channel.send(contentToBeSent)
    }

    await message.channel.send("You can ask me more on this topic or send '/start' to start a new conversation. Sending a voice note summary as well");
    var speakerMonologue = reply.SpeakerMonologue
    speakerMonologue = speakerMonologue.trim().split(/[\s,\t,\n]+/).join(' ');
    await redisClient.hSet(config.redisSummaryKey, user_id, speakerMonologue)
    var cost = aicompletion.data.usage.prompt_tokens*config.chatGPT4kInputPricePer1kTokensInUSD/1000 + aicompletion.data.usage.completion_tokens*config.chatGPT4kOutputPricePer1kTokensInUSD/1000
    var total_tokens = aicompletion.data.usage.total_tokens
    var response_timestamp = aicompletion.data.created * 1000
    console.log(cost, " $")
    console.log(total_tokens, " tokens")
    await redisClient.ts.add(config.redisTokenTSKey, response_timestamp, total_tokens)
    if(config.includeVoiceNote) {
        var audioSegmentTexts = splitMessageBySentence(speakerMonologue, "word")
        console.log(audioSegmentTexts.length)
        // if number of segments are more than 5(some number), then use chatGPT to summarize the monologue in minimal words
        // first calculate the token number limit left in this minute
        // Implement this when API rate limit quotas are increased for you
        var jobPromises = []
        for (let i = 0; i < audioSegmentTexts.length; i++) {
            var textToBeInferenced = audioSegmentTexts[i]
            console.log(i, textToBeInferenced)
            var postBody = {"input": {"prompt": textToBeInferenced}, "webhook": `http://${process.env.SERVER_IP}:9000/write_audio`}
            jobPromises.push(postDataRunpod(config.rupodApiEndpoint + config.runpodDeploymentID + "/run", postBody, process.env.RUNPOD_API_KEY))
        }
        var runResults = await Promise.all(jobPromises)
        console.log(runResults)
        var message_id = sentMessage.id
        for(let i = 0; i < runResults.length; i++) {
            var runResult = runResults[i]
            var job_id = runResult.id
            var redisRunValue = `${user_id}:${message_id}:${audioSegmentTexts.length}:${i}`
            await redisClient.hSet(config.redisAudioJobTrackerKey, job_id, redisRunValue)
        }
    }
});

await client.login(process.env.DISCORD_BOT_TOKEN)
