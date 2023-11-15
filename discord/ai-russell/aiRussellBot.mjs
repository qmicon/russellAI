import pkg from 'discord.js';
const {Client, GatewayIntentBits, ChannelType, Partials, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ComponentType, ButtonBuilder, ButtonStyle} = pkg;
import redis from 'redis';
import { TimeSeriesDuplicatePolicies, TimeSeriesEncoding, TimeSeriesAggregationType } from '@redis/time-series';
import { Configuration, OpenAIApi } from 'openai';
import config from '../../config.json'  assert { type: "json" };
import local_config from './local_config.json' assert { type: "json" };
// import DBModel from './mongo_schema.mjs';
import {splitMessageBySentence, postDataRunpod} from '../utils.mjs'
import dotenv from 'dotenv';
import { Tiktoken } from "tiktoken/lite";
import cl100k_base from "tiktoken/encoders/cl100k_base.json"  assert { type: "json" };
import stripe from 'stripe';
import fs from 'fs'

dotenv.config({path:'../../.env'});
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
var promptFormat = [`Answer the following question using the information and content of the books written by ${local_config.AISpeaker} or using the insights shared by him on public platform. Do NOT use any information NOT written or said by ${local_config.AISpeaker}. Report the answer in a monologue format. The monologue should be in ${local_config.AISpeaker}'s Conversational Style. Also refer to ${local_config.AISpeaker} as yourself in first person. Don't respond to any meta-level questions.`,
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
        host: "localhost",//process.env.SERVER_IP,
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

if(! (await redisClient.exists(`${config.appId}-${local_config.aiVersionId}${config.redisAudioStreamKeySuffix}`)) ) {
    await redisClient.xGroupCreate(`${config.appId}-${local_config.aiVersionId}${config.redisAudioStreamKeySuffix}`, `consumer-${local_config.aiVersionId}`, "$", {MKSTREAM: true})
console.log('Redis Stream created', `${config.appId}-${local_config.aiVersionId}${config.redisAudioStreamKeySuffix}`, `consumer-${local_config.aiVersionId}`)
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
            attachment: `../../files/wav-files/${local_config.aiVersionId}_${ids[0]}_${ids[1]}.wav`,
            name: `${local_config.AISpeaker} AI voice note.wav`
        }]
    })
    fs.unlink(`../../files/wav-files/${local_config.aiVersionId}_${ids[0]}_${ids[1]}.wav`,function(err){
        if(err) return console.log(err);
        console.log('file deleted successfully');
   }) 
}
async function consumeRedisStream() { 
 var res = await redisClient.xReadGroup(`consumer-${local_config.aiVersionId}`, "A", {key: `${config.appId}-${local_config.aiVersionId}${config.redisAudioStreamKeySuffix}`, id: '>'})
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
    try {if (message.author.bot ||  message.channel.type != ChannelType.DM ) return;
    await message.channel.sendTyping();
    var user_id = message.author.id

    if (message.content === "/start") {
        if(await redisClient.hExists(`${config.appId}-${local_config.aiVersionId}${config.redisSummaryKeySuffix}`, user_id) )
        await redisClient.hDel(`${config.appId}-${local_config.aiVersionId}${config.redisSummaryKeySuffix}`, user_id)
        await message.channel.send("You have started a new conversation, please ask your questions!")
        return
    }

    if(message.content.startsWith("/buy ")) {
        var quantity = message.content.split("/buy ")[1]
        quantity = parseInt(quantity)
        var paymentMode = await redisClient.hGet(config.redisGlobalStatesKey, config.redisGlobalStatesFields.envMode);
        if(! paymentMode) paymentMode = "test"
        var currencies = await redisClient.hGetAll(`${config.redisCurrencyDetailsKeyPrefix}-${paymentMode}`)
        var currencyOptions = []
        for(const key in currencies) {
            currencies[key] = JSON.parse(currencies[key])
            currencyOptions.push(new StringSelectMenuOptionBuilder()
            .setLabel(key)
            .setDescription(currencies[key].name)
            .setValue(key)
            )
        }
        console.log(currencies)
        const select = new StringSelectMenuBuilder()
			.setCustomId('Currencies')
			.setPlaceholder('Dropdown Menu')
			.addOptions(
				...currencyOptions
			);

        const row = new ActionRowBuilder()
			.addComponents(select);
      
        var dropdownMessage = await message.channel.send({ content: 'Select the Currency of the country of your payment method:', components: [row] });
        
        const collectorFilter = i => {
            return i.user.id === message.author.id;
        };
        var selectedCurrency = null
        try {
            var interaction = await dropdownMessage.awaitMessageComponent({ filter: collectorFilter, componentType: ComponentType.StringSelectMenuOptionBuilder, time: 30000 })
            console.log(interaction.values[0])
            selectedCurrency = interaction.values[0]
            await interaction.reply({ content: `Selected ${selectedCurrency}`});
            
        } catch(err) {
            await dropdownMessage.edit({ content: 'No selection was made', components: [] })
            return
        }
        
        var paymentMode = await redisClient.hGet(config.redisGlobalStatesKey, config.redisGlobalStatesFields.envMode);
        var stripeServer = null
        if(paymentMode === "live")
        stripeServer = stripe(process.env.STRIPE_CLIENT_SECRET_LIVE)
        else
        stripeServer = stripe(process.env.STRIPE_CLIENT_SECRET_TEST)
        const paymentLink = await stripeServer.paymentLinks.create({
            line_items: [
              {
                price: currencies[selectedCurrency].stripe_price_id,
                quantity: quantity,
              },
            ],
          });

        await redisClient.hSet(config.redisPaymentToAppKey, paymentLink.id, config.appId);
        await redisClient.hSet(config.redisPaymentKey, paymentLink.id, user_id);
        await message.channel.send(`${paymentLink.url}\n\nPlease make the payment to buy credits. send '/balance' to check your credit balance`);
        return
    }

    if(message.content === "/balance") {
        // put a check on the existence of the key hexists
        var whitelist_status = await redisClient.hGet(config.redisWhitelistedUsersKey, user_id)
        if(whitelist_status) {
            whitelist_status = JSON.parse(whitelist_status)
            if(whitelist_status.is_whitelisted) {
                await message.channel.send("You are a Whitelisted user, you can make unlimited questions without any cost!")
                return
            }
        }
        
        var balance = await redisClient.hGet(config.redisCreditsKey, user_id);
        var textBalance = await redisClient.hGet(config.redisFreeTextCreditsKey, user_id)
        if(! textBalance ) {
            var defaultFreeTextCredits = await redisClient.hGet(config.redisGlobalStatesKey, config.redisGlobalStatesFields.freeTextCredits)
            if(! defaultFreeTextCredits) defaultFreeTextCredits = 0
            await redisClient.hSet(config.redisFreeTextCreditsKey, user_id, defaultFreeTextCredits)
            textBalance = defaultFreeTextCredits
        }
        if(! balance) balance = 0
        await message.channel.send(`You have ${balance} normal credits left.\nAnd you have ${textBalance} complimentary text credits!`)
        return
    }

    if(message.content === "/toggleVoice") {
        var voiceNoteSwitch = await redisClient.hGet(config.redisVoiceSwitchKey, user_id)
        if(! voiceNoteSwitch) {
            var defaultVoiceNoteSwitch = await redisClient.hGet(config.redisGlobalStatesKey, config.redisGlobalStatesFields.defaultVoiceNoteSwitch)
                if(! defaultVoiceNoteSwitch) defaultVoiceNoteSwitch = "1"
                await redisClient.hSet(config.redisVoiceSwitchKey, user_id, defaultVoiceNoteSwitch)
                voiceNoteSwitch = defaultVoiceNoteSwitch
        }
        voiceNoteSwitch = parseInt(voiceNoteSwitch)
        if(voiceNoteSwitch)
        await message.channel.send(`You will receive voice note summaries when you ask questions to AI ${local_config.AISpeaker} and it will cost you 1 normal credit for each voice note. Do you want to turn this OFF?`)
        else
        await message.channel.send(`Your Voice Note Switch is OFF, you won't receive any voice note summaries for your questions. Do you want to switch it ON?`)
        const row = new ActionRowBuilder()
			.addComponents(
                new ButtonBuilder()
                .setCustomId('confirm')
                .setLabel('Confirm')
                .setStyle(ButtonStyle.Primary),

                new ButtonBuilder()
                .setCustomId('cancel')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
            );
        var contentButton = voiceNoteSwitch ? 'Turn Voice Note Switch OFF?' : 'Turn Voice Note Switch ON?'
        
        var buttonMessage = await message.channel.send({ content: contentButton, components: [row] })

        const collectorFilter = i => {
            return i.user.id === message.author.id;
        };
        var selectedButton = null
        try {
            var interaction = await buttonMessage.awaitMessageComponent({ filter: collectorFilter, componentType: ComponentType.ButtonBuilder, time: 30000 })
            selectedButton = interaction.customId
            await interaction.reply({ content: `OK. I will ${selectedButton} the change`});
            
        } catch(err) {
            await dropdownMessage.edit({ content: 'No Selection was made', components: [] })
            return
        }

        if(selectedButton === "confirm") {
            await redisClient.hSet(config.redisVoiceSwitchKey, user_id, voiceNoteSwitch ? 0 : 1)
        }
        return
    }

    if(message.content.startsWith('/')) {
        await message.channel.send('This isn\'t a known command')
        return
    }
    var is_user_whitelisted = false
    var whitelist_status = await redisClient.hGet(config.redisWhitelistedUsersKey, user_id)
    if(whitelist_status) {
        whitelist_status = JSON.parse(whitelist_status)
        if(whitelist_status.is_whitelisted) {
            is_user_whitelisted = true
        }
    }
    var creditsLeft = 0
    var textCreditsLeft = 0
    if(! is_user_whitelisted) {
        textCreditsLeft = await redisClient.hGet(config.redisFreeTextCreditsKey, user_id)
        if(! textCreditsLeft ) {
            var defaultFreeTextCredits = await redisClient.hGet(config.redisGlobalStatesKey, config.redisGlobalStatesFields.freeTextCredits)
            if(! defaultFreeTextCredits) defaultFreeTextCredits = 0
            await redisClient.hSet(config.redisFreeTextCreditsKey, user_id, defaultFreeTextCredits)
            textCreditsLeft = defaultFreeTextCredits
        }
        if (await redisClient.hExists(config.redisCreditsKey, user_id))
        {creditsLeft = await redisClient.hGet(config.redisCreditsKey, user_id)
        creditsLeft = parseInt(creditsLeft)}
        if(creditsLeft <= 0) {
            if(textCreditsLeft <= 0) {
            await message.channel.send("You don't have credits to make a query, send '/buy <quantity>' to buy credits");
            return
            }
        }
    }
    var message_time = message.createdTimestamp
    var lastMessageTime = await redisClient.hGet(`${config.appId}-${local_config.aiVersionId}${config.redisCooldownKeySuffix}`, user_id);
    if(lastMessageTime === null) {
        await redisClient.hSet(`${config.appId}-${local_config.aiVersionId}${config.redisCooldownKeySuffix}`, user_id, message_time)
    }
    else {
        lastMessageTime = parseInt(lastMessageTime)
        if(lastMessageTime + config.userCooldownMs >= message_time)
        {
            await message.channel.send("Please take time to read my response");
            return;
        }
        else {
            await redisClient.hSet(`${config.appId}-${local_config.aiVersionId}${config.redisCooldownKeySuffix}`, user_id, message_time)
        }
    }
    var new_convo = !(await redisClient.hExists(`${config.appId}-${local_config.aiVersionId}${config.redisSummaryKeySuffix}`, user_id));
    var promptbuild = ""

    if (!new_convo) {
        var lastResponseSummary = await redisClient.hGet(`${config.appId}-${local_config.aiVersionId}${config.redisSummaryKeySuffix}`, user_id);
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

    const jsonSchema = {
        "type": "object",
        "properties": {
          "Monologue": {
            "type": "string",
            "description": "Very Detailed Monologue response"
          },
          "SpeakerMonologue": {
            "type": "string",
            "description": "Less Detailed Normal Monologue response"
          }
        },
        "required": ["Monologue", "SpeakerMonologue"]
      }

    const aicompletion = await openai.createChatCompletion({
        model: config.openaiLLMmodel,
        messages: [{role: "user", content: promptbuild}],
        temperature: 0.35,
        functions: [{ name: "set_monologue", parameters: jsonSchema }],
        function_call: {name: "set_monologue"}
      });
    if(! is_user_whitelisted) {
        if(textCreditsLeft > 0)
        await redisClient.hSet(config.redisFreeTextCreditsKey, user_id, textCreditsLeft - 1)
        else {
            creditsLeft -= 1
            await redisClient.hSet(config.redisCreditsKey, user_id, creditsLeft)
        }
    }
     
    var reply = JSON.parse(aicompletion.data.choices[0].message.function_call.arguments)
    console.log(reply)
    var russellMonologue = reply.Monologue
    var messages = splitMessageBySentence(russellMonologue, "char")
    var sentMessage = null
    for (let i = 0; i < messages.length; i++) {
        var contentToBeSent = messages[i]
        if(!sentMessage)
        sentMessage = await message.channel.send(contentToBeSent)
    }

    var comments = "You can ask me more on this topic or send '/start' to start a new conversation. "
    var voiceNoteSwitch = await redisClient.hGet(config.redisVoiceSwitchKey, user_id)
    if(! voiceNoteSwitch) {
        var defaultVoiceNoteSwitch = await redisClient.hGet(config.redisGlobalStatesKey, config.redisGlobalStatesFields.defaultVoiceNoteSwitch)
            if(! defaultVoiceNoteSwitch) defaultVoiceNoteSwitch = "1"
            await redisClient.hSet(config.redisVoiceSwitchKey, user_id, defaultVoiceNoteSwitch)
            voiceNoteSwitch = defaultVoiceNoteSwitch
    }
    voiceNoteSwitch = parseInt(voiceNoteSwitch)
    if(is_user_whitelisted) {
        if(! voiceNoteSwitch)
        comments+="Voice Note Switch is off, to turn it on, send '/toggleVoice'"
        else
        comments+="Sending a voice note summary as well"
    }
    else {
        if(creditsLeft <= 0 && voiceNoteSwitch)
        comments+="You dont have enough normal credits to generate a voice note"
        else if(! voiceNoteSwitch)
        comments+="Voice Note Switch is off, to turn it on, send '/toggleVoice'"
        else if(creditsLeft > 0 && voiceNoteSwitch) {
            comments+="Sending a voice note summary as well"
            await redisClient.hSet(config.redisCreditsKey, user_id, creditsLeft - 1)
        }
    }
    
    await message.channel.send(comments);
    var speakerMonologue = reply.SpeakerMonologue
    speakerMonologue = speakerMonologue.trim().split(/[\s,\t,\n]+/).join(' ');
    await redisClient.hSet(`${config.appId}-${local_config.aiVersionId}${config.redisSummaryKeySuffix}`, user_id, speakerMonologue)
    const price_prompt = await redisClient.hGet(config.redisGlobalStatesKey, `openai-${config.openaiLLMmodel}-prompt${config.redisGlobalStatesFields.priceSuffix}`)
    const price_completion = await redisClient.hGet(config.redisGlobalStatesKey, `openai-${config.openaiLLMmodel}-completion${config.redisGlobalStatesFields.priceSuffix}`)
    var cost = aicompletion.data.usage.prompt_tokens*price_prompt/1000 + aicompletion.data.usage.completion_tokens*price_completion/1000
    var total_tokens = aicompletion.data.usage.total_tokens
    var response_timestamp = aicompletion.data.created * 1000
    console.log(cost, " $")
    console.log(total_tokens, " tokens")
    await redisClient.ts.add(config.redisTokenTSKey, response_timestamp, total_tokens)
    if((creditsLeft > 0 || is_user_whitelisted) && voiceNoteSwitch) {
        var audioSegmentTexts = splitMessageBySentence(speakerMonologue, "word")
        console.log(audioSegmentTexts.length)
        // if number of segments are more than 5(some number), then use chatGPT to summarize the monologue in minimal words
        // first calculate the token number limit left in this minute
        // Implement this when API rate limit quotas are increased for you
        var jobPromises = []
        for (let i = 0; i < audioSegmentTexts.length; i++) {
            var textToBeInferenced = audioSegmentTexts[i]
            console.log(i, textToBeInferenced)
            var postBody = {"input": {"prompt": textToBeInferenced, "aiversionId": local_config.aiVersionId}, "webhook": `http://${process.env.SERVER_IP}:9000/write_audio`}
            jobPromises.push(postDataRunpod(config.rupodApiEndpoint + config.runpodDeploymentID + "/run", postBody, process.env.RUNPOD_API_KEY))
        }
        var runResults = await Promise.all(jobPromises)
        console.log(JSON.stringify(runResults))
        var message_id = sentMessage.id
        for(let i = 0; i < runResults.length; i++) {
            var runResult = runResults[i]
            var job_id = runResult.id
            var redisRunValue = `${user_id}:${message_id}:${audioSegmentTexts.length}:${i}`
            await redisClient.hSet(config.redisAudioJobTrackerKey, job_id, redisRunValue)
        }
    }} catch(err) {
        console.log('Error', err.stack)
        await message.channel.send("Sorry for the interruption, something went wrong due to high traffic as I am getting a lot of questions today, can you ask me questions after 5 minutes?")
    }
});

await client.login(process.env[`DISCORD_BOT_TOKEN_${local_config.aiVersionId.replace(/-/g, "_")}`])
