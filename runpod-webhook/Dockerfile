# 
FROM python:3.10.5

# 
WORKDIR .

# 
COPY requirements.txt requirements.txt

# 
RUN pip install -r requirements.txt

# 
COPY server.py server.py

COPY ../.env ../.env

COPY ../config.json ../config.json

# 
CMD ["python", "server.py"]
