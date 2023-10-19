import runpod
import os
import torch
import torchaudio
import torch.nn as nn
import torch.nn.functional as F
from tortoise.api import TextToSpeech
from tortoise.utils.audio import load_voice
from scipy.io.wavfile import read as read_wav



## load your model(s) into vram here
tts = TextToSpeech()
preset = "ultra_fast"

def handler(event):
    # Add a cryptographic based verification on the token generated for webhook endpoint in order to verify if the webhook POST was called by runpod server
    print(event)
    prompt = event['input']['prompt']
    voice_samples, conditioning_latents = load_voice(event['input']['aiversionId'])
    gen = tts.tts_with_preset(prompt, voice_samples=voice_samples, conditioning_latents=conditioning_latents,
                            preset=preset, k=1)
    filename = event['id'] + '.wav'
    torchaudio.save(filename, gen.squeeze(0).cpu(), 24000)
    rate, audio_array = read_wav(filename)
    output = {"audio": audio_array.tolist(), "aiversionId": event['input']['aiversionId'] }
    
    if event["input"].get("refresh", False):
        output["refresh_worker"] = True
    
    os.remove(filename)

    return output


runpod.serverless.start({
    "handler": handler
})
