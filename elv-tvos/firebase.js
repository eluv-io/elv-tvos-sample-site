const functions = require('firebase-functions');
const app = require('./start.js');

exports.app = functions.https.onRequest(app);
