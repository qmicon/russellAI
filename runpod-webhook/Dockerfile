# 
FROM python:3.10.5

# 
WORKDIR /run/code

# 
COPY ./runpod-webhook/requirements.txt /run/code/requirements.txt

# 
RUN pip install -r requirements.txt

# 
COPY ./runpod-webhook/server.py /run/code/server.py

COPY ./.env /run/.env

COPY ./config.json /run/config.json

# 
CMD ["python", "server.py"]
