import numpy as np
import os
import json
import base64
import requests
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv
from scipy.io.wavfile import write as write_wav

load_dotenv(dotenv_path="../../.env")

with open("../../config.json", "r") as config_file:
    config_data = json.load(config_file)

with open("statuses.json", "r") as f:
    statuses = json.load(f)

ids = list(map(lambda x: x['id'], statuses))
print(ids)

def read_status(id):
    token = os.getenv("RUNPOD_API_KEY")
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"  # Set the Content-Type as per your requirement
    }
    deploymentID = config_data["runpodDeploymentID"]
    response = requests.get("https://api.runpod.ai/v2/" + deploymentID + "/status/" + id, headers=headers)
    return response.json()

with ThreadPoolExecutor(max_workers=len(statuses)) as pool:
    results = list(pool.map(read_status, ids))

silence = np.zeros(int(0.25 * 24000))

all_parts = []
for result in results:
    audio_arr = np.array(result['output']['audio'])
    all_parts.append(audio_arr)

audio_array = np.concatenate(all_parts, axis=-1)

write_wav('audio.wav', 24000, audio_array)
