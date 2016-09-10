var dotenv = require('dotenv');
dotenv.load();

var host = {
  server:             {     
    host:         process.env.HOST,
    port:         process.env.PORT,
    userName:     process.env.USER_NAME,
    password:     process.env.PASSWORD,
    tryKeyboard:  true
  },
  commands:           [
    "`Test session text message: passed`",
    "msg:console test notification: passed",
    "ls -la"
  ],
  msg: {
    send: function( message ) {
      console.log(message);
    }
  },
  verbose: true,
  debug: true,
  onEnd: function( sessionText, sshObj ){
    this.emit("msg", sessionText);
  }

};
//until npm published use the cloned dir path.
var SSH2Shell = require ('../lib/ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell(host);
  
//Add the keyboard-interactive handler
SSH.on ('keyboard-interactive', function(name, instructions, instructionsLang, prompts, finish){
     if (this.sshObj.debug) {
       this.emit('msg', this.sshObj.server.host + ": instance.keyboard-interactive");
     }
     //if only the password is required then it will be the only thing returned in the array
     finish([this.sshObj.server.password] );
  });
  
SSH.connect();