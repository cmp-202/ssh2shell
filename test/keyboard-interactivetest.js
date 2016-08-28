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
  idleTimeOut: 3000,
  verbose: false,
  debug: true,
  onCommandProcessing: function( command, response, sshObj, stream ){
   //Use onCommandProcessing to handle non-standard prompts from keyboard-interactive if you keep on getting onCommandTimeout events
   //You might have to try the following where "Connected on port 22" is the known response from the server prior to requiring `enter` to proceed
   //Remember this event triggers for every char coming from the server not when it all finishes.
   /*if ( command === "" && response.indexOf("Connected on port 22") != -1 ){
      if (sshObj.debug){sshObj.msg.send(sshObj.server.host + ": Keyboard-interactive connected");}
       //In some cases \n doesn't seem to be responded to by the server try \r\n or \r
       //stream.write("\n");
   }*/
  },
  onCommandTimeout: function( command, response, stream, connection ){
    //Attaching an event handler to the instance will run in parrallel to the default handler
    //The host handler replaces the default handler so we set this to nothing making the 
    //instance definition the primary handler.
    //I did not define the handler here because access is required to the instance 'this' properties and functions 
  },
  onEnd: function( sessionText, sshObj ){
    sshObj.msg.send (sessionText);
  }

};
//until npm published use the cloned dir path.
var SSH2Shell = require ('../lib/ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell(host);
  
//Add the keyboard-interactive handler
SSH.on ('keyboard-interactive', function(name, instructions, instructionsLang, prompts, finish){
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
  
SSH.on ('commandTimeout', function( command, response, stream, connection ){
   //Use onCommandTimeout to handle keyboard-interactive not providing a standard prompt on connection
   //If onCommandProcessing stream.write("\n") failed and nothing else works there might be nothing you can do here
   //If there is a delay after the last char was sent from the server before it will accept input onCommandProcessing might not work
   //The following handles a second attemp at getting a standard prompt. If that fails (no data response from host)
   //then a second timeout timer is set to stop the script hanging. The final code handles command or keyboard-interactive error response.
   var errorMessage, errorSource;
   if(this.sshObj.debug){this.emit("msg","timeout");}
   //first keyboard-interactive attemp we know there is no command and we set a flag sshObj.sentN after the first attemp
   if ( command === "" && this.sshObj.sentN != true){
     if(this.sshObj.debug){this.emit("msg","Keyboard-interactive timeout first pass");}
     //first attemp so set the flag we will use to ignor another timeout
     this.sshObj.sentN = true
     if(this.sshObj.debug){this.emit("msg","new timmer");} 
     //reset the timeout timer
     clearTimeout(this.sshObj.idleTimer);
     this.sshObj.idleTimer = setTimeout(function(){
         this.emit('commandTimeout', command, response, stream, connection )
     }, this._idleTime);
     //send whatever is required to trigger a response
     stream.write("\n");
     //we want to skip the last part     
     return true;
   } else if (command === "" && this.sshObj.sentN === true){
     if(this.sshObj.debug){this.emit("msg","Keyboard-interactive timeout second pass");}
     //second failure so we set the error messages
     errorMessage = "keyboarb-interactive prompt"
     errorType = "keyboarb-interactive Timeout";
   } 
   //everything failed so update sessionText and raise an error event that closes the connection
   this.sshObj.sessionText += response;
   if(!errorMessage){errorMessage = "Command";}
   if(!errorSource){errorSource = "Command Timeout";}
   this.emit("error", this.sshObj.server.host + ": " + errorMessage + " timed out after " + (this._idleTime / 1000) + " seconds", errorSource, true);   
  });
  
SSH.connect();