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
  commands: 	  ["echo \$(pwd)",
    "ls -al",
    "sudo -i",
    "msg:Showing root home directory",
    "cd \~",
    "echo \$(pwd)",
    "ls -al"],
  debug: (process.env.DEBUG === 'true'),
  verbose: (process.env.VERBOSE === 'true'),
}

var SSH2Shell = require ('../src/ssh2shell');

var SSH = new SSH2Shell(host),
    callback = function( sessionText ){
        const text = `-----Callback session text:\n${sessionText}\n-----Callback end`;
        log ( text );
        console.log(text);
    }      
SSH.on('msg', log); 
SSH.connect(callback);
