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

COPY ./runpod-webhook/local_config.json /run/local_config.json

COPY ./.env /run/.env

COPY ./config.json /run/config.json

# 
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "9000"]

EXPOSE 9000 6379
