var dotenv = require('dotenv');
dotenv.load();

var sshObj = {
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
  onKeyboardInteractive: function(name, instructions, instructionsLang, prompts, finish){
     console.log("host Event");
     console.log(name);
     console.log(instructions);
     console.log(prompts);
     var str = JSON.stringify(prompts, null, 4);
     console.log(str);
     finish([process.env.PASSWORD] );
  },
  standardPrompt:     "abc",//">$%#"
  /*onCommandProcessing: function( command, response, sshObj, stream ){
   if ( response.indexOf(“Connected”) != -1 ){
      stream.write(“\n”);
   }
  }*/

};
//until npm published use the cloned dir path.
var SSH2Shell = require ('../lib/ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell(sshObj);
SSH.on('end', function( sessionText, sshObj ){
      this.emit('msg', sessionText);
  })
SSH.connect();