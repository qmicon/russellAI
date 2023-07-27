import runpod
import time
import os
import numpy as np
import base64
from bark.api import generate_audio
from bark.generation import preload_models

## load your model(s) into vram here
preload_models(
    text_use_gpu=True,
    text_use_small=False,
    coarse_use_gpu=True,
    coarse_use_small=False,
    fine_use_gpu=True,
    fine_use_small=False,
    codec_use_gpu=True,
    force_reload=False,
    path="models"
)

def handler(event):
    start_time = time.time()
    print(event)
    raw_str = event['input']['history_prompt']
    history_prompt = base64.b64decode(raw_str.encode('utf8'))
    filename = event['id'] + '.npz'
    with open(filename, 'wb') as f:
        f.write(history_prompt)
    prompt = event['input']['prompt']
    audio_array = generate_audio(prompt, history_prompt=filename, text_temp=0.5, waveform_temp=0.5)
    end_time = time.time()
    output = {"timeTakenMs": (end_time-start_time)*1000, "audio": audio_array.tolist()}
    
    if event["input"].get("refresh", False):
        output["refresh_worker"] = True
    
    os.remove(filename)

    return output


runpod.serverless.start({
    "handler": handler
})
