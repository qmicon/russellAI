from python:3.10.5

# Define your working directory
WORKDIR /

RUN git clone https://github.com/jnordberg/tortoise-tts.git

WORKDIR /tortoise-tts/

COPY requirementsothers.txt .
COPY test_handler.py .
COPY ./wav-files/ /tortoise-tts/tortoise/voices/custom/

RUN pip install -U scipy

RUN pip install -r requirements.txt; exit 0

RUN pip install -r requirementsothers.txt

RUN python setup.py install

CMD [ "python", "-u", "test_handler.py" ]