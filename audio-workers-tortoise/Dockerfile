from python:3.11.1-buster

# Define your working directory
WORKDIR /

RUN git clone https://github.com/jnordberg/tortoise-tts.git

WORKDIR /tortoise-tts/

COPY requirementsothers.txt .
COPY test_handler.py .
COPY ./wav-files/ /tortoise-tts/tortoise/voices/custom/

RUN pip install -r requirementsothers.txt

RUN pip install -r requirements.txt

RUN python setup.py install

CMD [ "python", "-u", "test_handler.py" ]