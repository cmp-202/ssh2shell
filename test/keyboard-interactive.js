var dotenv = require('dotenv').config()

var host = {
  server:             {     
    host:         process.env.HOST,
    port:         process.env.PORT,
    userName:     process.env.USER_NAME,
    password:     process.env.PASSWORD,
    tryKeyboard:  true
  },
  commands:           [
    "ls -la"
  ],
  verbose: false,
  debug: false,
  onEnd: function( sessionText, sshObj ){
    this.emit("msg", sessionText);
  }
};
//until npm published use the cloned dir path.
var SSH2Shell = require ('../lib/ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell(host);

SSH.connect();