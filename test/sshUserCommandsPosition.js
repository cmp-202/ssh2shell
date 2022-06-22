var dotenv = require('dotenv').config()

var sshObj = {
  server:             {     
    host:         process.env.HOST,
    port:         process.env.PORT,
    userName:     process.env.USER_NAME,
    password:     process.env.PASSWORD,
  },
  commands:           [
    "echo ssh",
    "ssh -V",
    "echo ssh middle"
  ],  
  verbose: false,
  debug: false
};
//until npm published use the cloned dir path.
var SSH2Shell = require ('../lib/ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell(sshObj);
SSH.on('end', function( sessionText, sshObj ){
      this.emit('msg', sessionText);
  })
SSH.connect();