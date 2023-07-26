import config from '../config.json'  assert { type: "json" };
import fetch from 'node-fetch';

export const splitMessageBySentence = (message, mode) => {
    const sentenceBoundaryRegex = /[^\.!\?]+[\.!\?]+/g;
    const sentences = message.match(sentenceBoundaryRegex);
    const chunks = [];
  
    let currentChunk = "";
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      if (mode === "char") {
        const maxCharacters = config.discordCharacterLimit;
        if ((currentChunk + sentence).length > maxCharacters) {
          chunks.push(currentChunk.trim());
          currentChunk = "";
        }
      }
      else if (mode === "word") {
        const maxWords = config.audioWordLimit
        var checkSentence = currentChunk + sentence
        var wordLen = checkSentence.split(/(\s)/).filter((x) => x.trim().length>0).length
        if(wordLen > maxWords) {
          chunks.push(currentChunk.trim());
          currentChunk = "";
        }
      }
      currentChunk += sentence;
    }
  
    // Add any remaining text to the last chunk
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
    }
  
    return chunks;
  }

export const postDataRunpod = (url, data, token) => {
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(data)
    })
    .then(response => response.json())
    .catch(error => {
      console.error('Error posting data:', error);
      throw error;
    });
  }
