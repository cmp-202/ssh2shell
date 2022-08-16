var dotenv = require('dotenv').config()

var host = {
  server:             {     
    host:         process.env.HOST,
    port:         process.env.PORT,
    userName:     process.env.USER_NAME,
    password:     process.env.PASSWORD
  },
  commands: ["ls -la"],
  msg: {
    send: function( message ) {
      console.log(message);
    }
  },  
  verbose: true,
  debug: true,
  onEnd: function (sessionText, sshObj) {
    setTimeout(() => {
        console.log(sessionText)
    }, 2000)
  },
  onError: function (error) {
   console.log('there was an error')
  },
  onCommandTimeout: function (command) {
    console.log('there was an timeout')
    reject('Timed Out!')
  }
};
//until npm published use the cloned dir path.
var SSH2Shell = require ('../lib/ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell(host);
  
SSH.connect();