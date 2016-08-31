//Every data response from the server resets the command timeout timer
//So if you use stream.write() to send something to the server from within the timeout function
//and the server responds then the timer is reset and the normal process starts again
//If you are using the host.onCommandTimeout to send something to the host and it doesn't
//respond then the script will hang. there is no way to reset the timeout timer.
//If you set the host onCommandTimeout to do nothing an attach commandTimeout to the instance
//you will be able to tigger a new timeout timer by using 
/*
this.sshObj.idleTimer = setTimeout(function(){
         this.emit('commandTimeout', command, response, stream, connection )
     }, this._idleTime);
*/
//commandTimeout is actually a `didn't detect a defined prompt` timeout

var dotenv = require('dotenv');
dotenv.load();

var sshObj = {
  server:             {     
    host:         process.env.HOST,
    port:         process.env.PORT,
    userName:     process.env.USER_NAME,
    password:     process.env.PASSWORD,
    passPhrase:   process.env.PASS_PHRASE,
    privateKey:   require('fs').readFileSync(process.env.PRIV_KEY_PATH)
  },
  commands:           [
    "msg:Testing idle time out",
    "read -n 1 -p \"Creating a prompt to trigger time out (y,n): \" test;"
  ],
  msg: {
    send: function( message ) {
      console.log(message);
    }
  },
  verbose:            false,
  debug:              false,
  idleTimeOut:        10000,
  connectedMessage:   "Connected",
  readyMessage:       "Running commands Now",
  closedMessage:      "Completed",
  onCommandTimeout: function( command, response, stream, connection ){
    //The host handler replaces the default handler so we set this to nothing making the 
    //instance definition the primary handler.
    //Attaching an event handler to the instance will run in parrallel to the default handler that is why we set this one to do nothing
    //I did not define the handler here because access is required to the instance 'this', sshObj and emitters
    //which are not available here.    
  },
  onEnd:              function( sessionText, sshObj ) {
    //show the full session output. This could be emailed or saved to a log file.
    sshObj.msg.send("\nThis is the full session responses:\n" + sessionText);
  }
};
//until npm published use the cloned dir path.
var SSH2Shell = require ('../lib/ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell(sshObj);

SSH.on ('commandTimeout', function( command, response, stream, connection ){
   //Here we are trying to handle a timeout from not getting a standard prompt from the host.
   //The first check makes sure there is no command and the first try flag has not been set.   
   //a second timeout timer is set to stop the script hanging.
   //If that fails (no data response from host) then error messages are set. 
   //The final code adds the text received so far to the session text and closes the connection with an error.
   var errorMessage, errorSource;
   if(this.sshObj.debug){this.emit("msg","timeout");}
   //first we are checking for the timeout coming after connection before a prompt is detected and before a command is loaded
   //on the first try this.sshObj.sentN is not true as it hasn't been set yet
   if ( command === "" && this.sshObj.sentN != true){
     if(this.sshObj.debug){this.emit("msg","Keyboard-interactive timeout first pass");}
     //first attemp so set the flag we will use to ignor another timeout attempt
     this.sshObj.sentN = true
     if(this.sshObj.debug){this.emit("msg","new timmer");} 
     //reset the timeout timer to catch a timeout from sending \n
     clearTimeout(this.sshObj.idleTimer);
     this.sshObj.idleTimer = setTimeout(function(){
         this.emit('commandTimeout', command, response, stream, connection )
     }, this._idleTime);
     //send whatever is required to trigger a response
     stream.write("\n");
     //we want to skip the last part so return     
     return true;
   } else if (command === "" && this.sshObj.sentN === true){
     if(this.sshObj.debug){this.emit("msg","timeout second pass");}
     //second failure so we set the error messages because we probably can't do anything more
     //or add code to try something else 
     errorMessage = "keyboarb-interactive prompt"
     errorType = "keyboarb-interactive Timeout";
   } //else if ( command === "some-command" and response.indexOf("who am I?") != -1){
       //This would be better to handle in onCommandProcessing but can be handled here
       //Do something to respond to the timeout or bail to the error.
   //}
   //everything failed so update sessionText and raise an error event that closes the connection
   this.sshObj.sessionText += response;
   if(!errorMessage){errorMessage = "Command";}
   if(!errorSource){errorSource = "Command Timeout";}
   this.emit("error", this.sshObj.server.host + ": " + errorMessage + " timed out after " + (this._idleTime / 1000) + " seconds", errorSource, true);   
  });
  
SSH.connect();
