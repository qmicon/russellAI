# Include Python
from python:3.11.1-buster

# Define your working directory
WORKDIR /
COPY . .
# Install req
RUN pip install -r requirements.txt

# Call your file when your container starts
CMD [ "python", "-u", "/test_handler.py" ]