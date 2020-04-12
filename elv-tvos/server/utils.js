
module.exports = {
  JQ : obj => JSON.stringify(obj, null, 2),

  isEmpty : obj => {
    const result = obj === null || obj === undefined || obj === '';
    return result;
  }
  
}