import config from './config.json'  assert { type: "json" };

export default function splitMessageBySentence(message) {
    const maxCharacters = config.discordCharacterLimit;
    const sentenceBoundaryRegex = /[^\.!\?]+[\.!\?]+/g;
    const sentences = message.match(sentenceBoundaryRegex);
    const chunks = [];
  
    let currentChunk = "";
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      if ((currentChunk + sentence).length > maxCharacters) {
        chunks.push(currentChunk.trim());
        currentChunk = "";
      }
      currentChunk += sentence;
    }
  
    // Add any remaining text to the last chunk
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
    }
  
    return chunks;
  }
