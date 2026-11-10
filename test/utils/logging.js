'use strict';

const fs = require('node:fs');
const path = require('node:path');
const logDir = path.join(__dirname, '..', 'logs');

// Module-level state to hold the current file path
let currentLogFile = null;
  
function logFile(name) {
  // Store the path in the module-level variable so log() can see it
  currentLogFile = path.join(logDir, `${name}.log`);
  
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(currentLogFile, '', 'utf8');
} 

function log(content) {
  // Guard clause in case someone calls log() before choosing a file
  if (!currentLogFile) {
    throw new Error('You must call logFile(name) to initialize a log file before calling log().');
  }

  if (typeof content === 'object' && content !== null) {
    content = JSON.stringify(content, null, '\t');
  }
  
  fs.appendFileSync(currentLogFile, `${content}\n`, 'utf8');
}

module.exports = {
  logFile,
  log
};
