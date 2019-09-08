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
     }, self._idleTime)
*/
//commandTimeout is actually a `didn't detect a defined prompt` timeout

var dotenv = require('dotenv')
dotenv.load()

var host = {
  server:             {     
    host:         process.env.HOST,
    port:         process.env.PORT,
    userName:     process.env.USER_NAME,
    password:     process.env.PASSWORD
  },
  commands:           [
    "msg:Testing idle time out",
    "mkdir ~/scripts",
    "if [ ! -f ~/scripts/myscript.sh ] then printf '#!/bin/bash\n#\n" +
    "read -n 1 -p \"First prompt to trigger time out (y,n): \" test > ~/scripts/myscript.sh\nfi",
    "sudo chmod 700 ~/scripts/myscript.sh",
    "./scripts/myscript.sh",
    "rm -r ~/scripts/",
    "cd /home",
    "cd ~",
    "read -n 1 -p \"Second prompt to trigger time out (n,y): \" test",
  ],
  msg: {
    send: function( message ) {
      console.log(message)
    }
  },
  //can't use # and > because prompt detection triggers in the wrong place
  standardPrompt:     "$",
  verbose:            false,
  debug:              false,
  idleTimeOut:        1000,
  onCommandTimeout: function( command, response, stream, connection ){
   if(this.sshObj.debug){this.emit("msg", this.sshObj.server.host + ": host.onCommandTimeout")}
   //Here we are trying to handle a timeout from not getting a standard prompt from the host.
   //The first check makes sure there is no command and the first try flag has not been set.   
   //a second timeout timer is set to stop the script hanging.
   //If that fails (no data response from host) then error messages are set. 
   //The final code adds the text received so far to the session text and closes the connection with an error.
   var errorMessage, errorSource
   if(this.sshObj.debug){this.emit("msg", this.sshObj.server.host + ": timeout")}
   
   //use flags this.sshObj.connectedPass, this.sshObj.SecondPass and FirstPass to stop loops
   if (command === "" && response.indexOf("Connected on port 22") != -1 && this.sshObj.connectedPass === true){
     if(this.sshObj.debug){this.emit("msg", sshObj.server.host + ": Unusual connection prompt timeout second pass")}
     //second failure so we set the error messages because we probably can't do anything more
     //or add code to try something else 
     errorMessage = "No prompt error"
     errorSource = "No prompt timeout"
     
   } else if (command === "" && this.sshObj.connectedPass != true ||  
        response.indexOf("n,y") != -1 && this.sshObj.SecondPass != true || 
        response.indexOf("y,n") != -1 && this.sshObj.FirstPass != true){
       //first we are checking for the timeout coming after connection before a prompt is detected and before a command is loaded
       //on the first try this.sshObj.sentN is not true as it hasn't been set yet
       if ( command === "" && response.indexOf("Connected on port 22") != -1 && this.sshObj.connectedPass != true){
         if(this.sshObj.debug){this.emit("msg", this.sshObj.server.host + ": Unusual connection prompt timeout first pass")}
         //first attemp so set the flag we will use to ignor another timeout attempt
         this.sshObj.sentN = true
         
         //send whatever is required to trigger a response
         stream.write("\n")
         //we want to skip the last part so return     
         return true
           
      } else if (response.indexOf("y,n") != -1 && this.sshObj.FirstPass != true){
         if(this.sshObj.debug){this.emit("msg", this.sshObj.server.host + ": First prompt to trigger timeout: Sending 'y' to the `(y,n):` prompt")}
         this.sshObj.sessionText += response
         this._buffer = ""
         this.sshObj.FirstPass = true
         stream.write("y\n")
         
      } else if ( response.indexOf("n,y") != -1 && this.sshObj.SecondPass != true){
        if(this.sshObj.debug){this.emit("msg", this.sshObj.server.host + ": Second to trigger timeout: Sending 'n' to the `(n,y):` prompt")}
        this.sshObj.sessionText += response
        this._buffer = ""
        this.sshObj.SecondPass = true
        stream.write("n\n")
      }
        if(this.sshObj.debug){this.emit("msg", this.sshObj.server.host + ": Stream.write sent so reset timmer to stop the script hanging")} 
        //reset the timeout timer to catch a timeout from sending \n
        if (this.sshObj.idleTimer) {
            clearTimeout(this.sshObj.idleTimer)
        }
        var self = this
        this.sshObj.idleTimer = setTimeout(function() {
           self.emit('commandTimeout', self.command, self._buffer, self._stream, self._connection)
        }, this.sshObj.idleTimeOut)
        return
   }
   if(this.sshObj.debug){this.emit("msg", this.sshObj.server.host + "Final timeout: All attempts completed")}
   if(this.sshObj.debug){this.emit("msg", this.sshObj.server.host + ": Timeout details:" + this.sshObj.enter + "Command: " + command + " " + this.sshObj.enter + "Response: " + response)}
   
   //everything failed so update sessionText and raise an error event that closes the connection
   this.sshObj.sessionText += response
   if(!errorMessage){errorMessage = "Command"}
   if(!errorSource){errorSource = "Command Timeout"}   
   this.emit("error", this.sshObj.server.host + ": " + errorMessage + " timed out after " + (this.idleTime / 1000) + " seconds", errorSource, true)   
  },
  
  onEnd: function( sessionText, sshObj ) {
    if(this.sshObj.debug){this.emit("msg", sshObj.server.host + ": host.onEnd")}
    //show the full session output. self could be emailed or saved to a log file.
    this.emit("msg", "\nThis is the full session response:\n\n" + sessionText + "\n")
  }
}
//until npm published use the cloned dir path.
var SSH2Shell = require ('../lib/ssh2shell')

//run the commands in the shell session
var SSH = new SSH2Shell(host)
  
SSH.connect()
