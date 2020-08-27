const winston = require('winston');
require('winston-daily-rotate-file');
var transport = new (winston.transports.DailyRotateFile)({
    filename: 'elv-tvos-%DATE%.log',
    dirname: './logs',
    datePattern: 'YYYY-MM-DD',
    maxSize: '100k',
    maxFiles: '100',
    handleExceptions: true,
    humanReadableUnhandledException: true
});

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp({format: 'YYYY-MM-DD HH:mm:ss'}),
    winston.format.prettyPrint()
  ),
  transports: [
    transport
  ],
});

logger.info('Logger Initialized!');

module.exports = logger;