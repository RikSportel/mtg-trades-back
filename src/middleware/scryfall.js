const axios = require('axios');

async function fetchScryfallCard(setCode, cardNumber) {
  try {
    const url = `https://api.scryfall.com/cards/${setCode}/${cardNumber}`;
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    console.error('Error fetching Scryfall card:', error.message);
    return null;
  }
}

module.exports = { fetchScryfallCard };
