from fastapi import FastAPI, HTTPException, Body
import aioredis
import logging
import asyncio
import os
import json
from pydantic import BaseModel
import uvicorn
from scipy.io.wavfile import write as write_wav, read as read_wav
from uuid import UUID
import numpy as np
from dotenv import load_dotenv
load_dotenv(dotenv_path="../.env")

with open("../config.json", "r") as config_file:
    config_data = json.load(config_file)

class Output(BaseModel):
    audio: list[float]

class Status(BaseModel):
    delayTime: int
    executionTime: int
    id: UUID
    status: str = "COMPLETED"
    output: Output

# logging.config.fileConfig('logging.conf', disable_existing_loggers=False)
logging.basicConfig(level=logging.INFO)
# get root logger
logger = logging.getLogger(__name__)

app = FastAPI()

# Redis connection pool initialization and cleanup
@app.on_event("startup")
async def init_redis():
    server_ip = os.getenv("SERVER_IP")
    redis_port = os.getenv("REDIS_PORT")
    app.redis = await aioredis.from_url(
        f"redis://{server_ip}:{redis_port}",
        password=os.getenv("REDIS_PASSWORD"),
        decode_responses=True
    )

@app.on_event("shutdown")
async def close_redis():
    await app.redis.close()
# add cost tracking
# change the post endpoint to include a token that it valid for one POST call, use redis set and hash table to manage it
@app.post("/write_audio", status_code=200)
async def write_audio(status: Status):
    try:
        logger.info(f"job id: {str(status.id)}\ndelay time: {status.delayTime}\n execution time: {status.executionTime}")
        audio_arr = np.array(status.output.audio)
        write_job_coroutine = asyncio.to_thread(write_wav, f"../files/wav-files/{status.id}.wav", 24000, audio_arr)
        write_job_task = asyncio.create_task(write_job_coroutine)
        await write_job_task
        getVal = await app.redis.hget(config_data["redisAudioJobTrackerKey"], str(status.id))
        user_id, message_id, total_count, index = getVal.split(":")
        statusTrackerKey = f"{user_id}:{message_id}:{total_count}:{index}"
        await app.redis.hset(config_data["redisAudioStatusTrackerKey"], statusTrackerKey, str(status.id))

        tracker_list = []
        for i in range(int(total_count)):
            job_id = await app.redis.hget(config_data["redisAudioStatusTrackerKey"], f"{user_id}:{message_id}:{total_count}:{i}")
            if job_id:
                tracker_list.append(job_id)
        
        if len(tracker_list) == int(total_count):
            is_not_done = await app.redis.sadd(config_data["redisAudioConcatJobStartKey"], f"{user_id}:{message_id}")
            if not is_not_done:
                return {"status": "success"}
            audio_arr = []
            for jobId in tracker_list:
                read_job_coroutine = asyncio.to_thread(read_wav, f"../files/wav-files/{jobId}.wav")
                read_job_task = asyncio.create_task(read_job_coroutine)
                rate, a = await read_job_task
                audio_arr.append(a)
                remove_file_coroutine = asyncio.to_thread(os.remove, f"../files/wav-files/{jobId}.wav")
                remove_file_task = asyncio.create_task(remove_file_coroutine)
                await remove_file_task

            audio_array = np.concatenate(audio_arr, axis=-1)
            audio_array = np.int16(audio_array * 32767)
            write_audio_coroutine = asyncio.to_thread(write_wav, f"../files/wav-files/{user_id}_{message_id}.wav", 24000, audio_array)
            write_audio_task = asyncio.create_task(write_audio_coroutine)
            await write_audio_task
            await app.redis.xadd(config_data["redisAudioStreamKey"], {"message": f"{user_id}:{message_id}"}, "*", 2000)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=e)

if  __name__ == '__main__':
    uvicorn.run("server:app", port=9000, reload=True)