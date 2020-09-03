module.exports = {
  JQ : obj => JSON.stringify(obj, null, 2),

  isEmpty : obj => {
    const result = obj === null || obj === undefined || obj === '' 
      || (Object.keys(obj).length === 0 && obj.constructor === Object);
    return result;
  },

  CreateID: num => {
    var id = crypto.randomBytes(num / 2).toString('hex');
    return id;
  },

  RandomInt: max => {
    return Math.floor(Math.random() * Math.floor(max));
  }
}