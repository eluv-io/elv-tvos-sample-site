var Crypto = require("crypto");

module.exports = {
  JQ : obj => JSON.stringify(obj, null, 2),

  isEmpty : obj => {
    const result = obj === null || obj === undefined || obj === '';
    return result;
  },

  CreateID: num => {
    var id = crypto.randomBytes(num / 2).toString('hex');
    return id;
  }
  
}