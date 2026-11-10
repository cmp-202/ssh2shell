var dotenv = require('dotenv').config()
const { logFile, log } = require('./utils/logging.js');
logFile('simple.js');

var host = {
  server: {     
    host:         process.env.HOST,
    port:         process.env.PORT,
    userName:     process.env.USER_NAME,
    password:     process.env.PASSWORD
  },
  commands: 	  ["echo basic test success"],
  debug: (process.env.DEBUG === "true"),
  verbose: (process.env.VERBOSE === "true"),
}

var SSH2Shell = require ('../src/ssh2shell');


var SSH = new SSH2Shell(host),
    callback = function( sessionText ){
          log ( "-----Callback session text:\n" + sessionText);
          log ( "-----Callback end" );
      }
      
SSH.on('msg', log); 
SSH.connect(callback);
