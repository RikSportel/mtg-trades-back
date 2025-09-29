class Card {
  constructor(setCode, cardNumber, foil = false, amount = 1) {
    this.setCode = setCode;
    this.cardNumber = cardNumber;
    this.foil = foil;
    this.amount = amount;
  }
}

module.exports = Card;
