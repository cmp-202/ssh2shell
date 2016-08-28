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
  onCommandProcessing: function( command, response, sshObj, stream ){
   //Use onCommandProcessing to handle non-standard prompts from keyboard-interactive if you keep on getting onCommandTimeout events
   //You might have to try the following where "Connected" is the known response from the server prior to requiring `enter` to proceed
   //if ( response.indexOf("Connected")  != -1 ){
       //if (debug){console.log("Detected keyboard-interactive finished");}
       //In some cases \n doesn't seem to be responded to by the server try \r\n or \r
       //stream.write("\n");
   //}
   },
  onEnd: function( sessionText, sshObj ){
    this.emit('msg', sessionText);
  }

};
//until npm published use the cloned dir path.
var SSH2Shell = require ('../lib/ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell(host);
  
//Add the keyboard-interactive handler
SSH.on ('keyboardInteractive', function(name, instructions, instructionsLang, prompts, finish){
     if (this.sshObj.debug) {
       this.emit('msg', this.sshObj.server.host + ": Keyboard-interactive");
     }
     if (this.sshObj.verbose){
       this.emit('msg', "name: " + name);
       this.emit('msg', "instructions: " + instructions);
       var str = JSON.stringify(prompts, null, 4);
       this.emit('msg', "Prompts object: " + str);
     }
     finish([this.sshObj.server.password] );
  });
  
SSH.connect();