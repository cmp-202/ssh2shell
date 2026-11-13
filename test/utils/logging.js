'use strict';

const fs = require('node:fs');
const path = require('node:path');
const logDir = path.join(__dirname, '..', 'logs');

// Module-level state to hold the current file path
let currentLogFile = null;
  
function logFile(name) {
  // Store the path in the module-level variable so log() can see it
  currentLogFile = path.join(logDir, `${name}.log`);
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(currentLogFile, '', 'utf8');
  } catch (err) {
    throw new Error(`Failed to write file: ${currentLogFile}`, err);
  }
} 

function log(content) {
  // Guard clause in case someone calls log() before choosing a file
  if (!currentLogFile) {
    throw new Error('You must call logFile(name) to initialize a log file before calling log().');
  }

  if (typeof content === 'object' && content !== null) {
    content = JSON.stringify(content, null, '\t');
  }
  try {
    fs.writeFileSync(currentLogFile, `${content}\n`, { encoding: 'utf8', flag: 'a' });
  } catch (err) {
    throw new Error(`Failed to append to log: ${currentLogFile}`, err);
  }  
}

module.exports = {
  logFile,
  log
};
