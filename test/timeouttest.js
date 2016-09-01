//Every data response from the server resets the command timeout timer
//So if you use stream.write() to send something to the server from within the timeout function
//and the server responds then the timer is reset and the normal process starts again
//If you are using the host.onCommandTimeout to send something to the host and it doesn't
//respond then the script will hang. there is no way to reset the timeout timer.
//If you set the host onCommandTimeout to do nothing an attach commandTimeout to the instance
//you will be able to tigger a new timeout timer by using 
/*
self.sshObj.idleTimer = setTimeout(function(){
         self.emit('commandTimeout', command, response, stream, connection )
     }, self._idleTime);
*/
//commandTimeout is actually a `didn't detect a defined prompt` timeout

var dotenv = require('dotenv');
dotenv.load();

var host = {
  server:             {     
    host:         process.env.HOST,
    port:         process.env.PORT,
    userName:     process.env.USER_NAME,
    password:     process.env.PASSWORD
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
  debug:              true,
  idleTimeOut:        5000,
  onCommandTimeout: function( command, response, stream, connection, self ){
   if(self.sshObj.debug){self.emit("msg","new timmer")};
   //Here we are trying to handle a timeout from not getting a standard prompt from the host.
   //The first check makes sure there is no command and the first try flag has not been set.   
   //a second timeout timer is set to stop the script hanging.
   //If that fails (no data response from host) then error messages are set. 
   //The final code adds the text received so far to the session text and closes the connection with an error.
   var errorMessage, errorSource;
   if(self.sshObj.debug){self.emit("msg","timeout");}
   
   //first we are checking for the timeout coming after connection before a prompt is detected and before a command is loaded
   //on the first try self.sshObj.sentN is not true as it hasn't been set yet
   if ( command === "" && response.indexOf("Connected on port 22") != -1 && self.sshObj.sentNL != true){
     if(self.sshObj.debug){self.emit("msg","Unusual connection prompt timeout first pass");}
     //first attemp so set the flag we will use to ignor another timeout attempt
     self.sshObj.sentN = true
     if(self.sshObj.debug){self.emit("msg","new timmer");} 
     //reset the timeout timer to catch a timeout from sending \n
     clearTimeout(self.sshObj.idleTimer);
     self.sshObj.idleTimer = setTimeout(function(){
         self.emit('commandTimeout', command, response, stream, connection )
     }, self._idleTime);
     //send whatever is required to trigger a response
     stream.write("\n");
     //we want to skip the last part so return     
     return true;
   } else if (command === "" && response.indexOf("Connected on port 22") != -1 && self.sshObj.sentNL === true){
     if(self.sshObj.debug){self.emit("msg","Unusual connection prompt timeout second pass");}
     //second failure so we set the error messages because we probably can't do anything more
     //or add code to try something else 
     errorMessage = "No prompt error"
     errorSource = "No prompt timeout";
   } else if ( response.indexOf("(y,n):") != -1 && self.sshObj.sentY != true){
       self.sshObj.sentY === true
       //This would be better to handle in onCommandProcessing but can be handled here
       //response from server will trigger a reset of the timeer
       stream.write("y\n");
   }
   //everything failed so update sessionText and raise an error event that closes the connection
   self.sshObj.sessionText += response;
   if(!errorMessage){errorMessage = "Command";}
   if(!errorSource){errorSource = "Command Timeout";}
   self.emit("error", self.sshObj.server.host + ": " + errorMessage + " timed out after " + (self._idleTime / 1000) + " seconds", errorSource, true);   
  },
  onEnd: function( sessionText, sshObj, self ) {
    //show the full session output. self could be emailed or saved to a log file.
    self.emit("msg", "\nThis is the full session response:\n\n" + sessionText + "\n");
  }
};
//until npm published use the cloned dir path.
var SSH2Shell = require ('../lib/ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell(host);
  
SSH.connect();
