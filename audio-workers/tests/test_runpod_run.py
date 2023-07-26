import numpy as np
import os
import json
import base64
import requests
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv
load_dotenv(dotenv_path="../../.env")

with open("../../config.json", "r") as config_file:
    config_data = json.load(config_file)

npz_file = open('../../files/speaker.npz', 'rb')
string_data = base64.b64encode(npz_file.read()).decode('utf8')
sentences = ["Ah, the wonderful world of pizza! I'm thrilled that you're eager to increase footfalls using funnels in your pizza shop. Let's dive right in, my friend! Picture this: you can create a mouthwatering offer that'll have customers flocking to your shop like bees to honey.", "First things first, leverage the power of social media ads, like Facebook and Instagram, to generate awareness. Craft enticing visuals and irresistible offers that make people's taste buds tingle.", "Next, capture their attention with a lead magnet, such as a downloadable coupon, that they simply can't resist. Use a simple landing page to collect their information.", "But we're not done yet! Maximize the potential of your funnel by setting up an automated email sequence, delivering value straight to their inbox. Think pizza recipes, exclusive discounts, and anything that'll make them crave your delicious pies.", "Oh, and don't forget the power of partnerships with local businesses or influencers to expand your reach. Finally, prioritize exceptional customer experiences, encourage reviews, and spread the love through word-of-mouth.", "With these mouthwatering funnel strategies, get ready to see those footfalls skyrocket, my pizza-loving entrepreneur!"]

sentence_inputs = []
for sentence in sentences:
    sentence_inputs.append({"prompt": sentence, "history_prompt": string_data})

def run_worker(input):
    token = os.getenv("RUNPOD_API_KEY")
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"  # Set the Content-Type as per your requirement
    }
    json = {"input": input}
    deploymentID = config_data["runpodDeploymentID"]
    response = requests.post("https://api.runpod.ai/v2/" + deploymentID + "/run", json=json, headers=headers)
    return response.json()

with ThreadPoolExecutor(max_workers=len(sentences)) as pool:
    statuses = list(pool.map(run_worker, sentence_inputs))

with open("statuses.json", "w") as f:
    json.dump(statuses, f)