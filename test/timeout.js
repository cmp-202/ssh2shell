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

var dotenv = require('dotenv').config(),
debug=true,
verbose=false

//Host objects:
var host = {
  server:             {     
    host:         process.env.HOST,
    port:         process.env.PORT,
    userName:     process.env.USER_NAME,
    password:     process.env.PASSWORD
  },
  commands:           [
    "msg:Testing idle time out",
	"read -n 1 -p \"First prompt to put valid input (Y,n): \" test",
    "read -n 1 -p \"Final unhandled time out: \" test",
  ],
  //can't use # and > because prompt detection triggers in the wrong place
  standardPrompt:     "$",
  verbose:            verbose,
  debug:              debug,
  idleTimeOut:        5000,
  FirstPass:		  false,
  SecondPass:         false,
  onCommandTimeout: function( command, response, stream, connection ){
   //this.emit("msg", "response: [[" + response + " ]]")
   if(this.sshObj.debug){this.emit("msg", this.sshObj.server.host + ": host.onCommandTimeout")}

   var errorMessage, errorSource
   //this.emit("msg", this.sshObj.server.host +  ": fp:" +this.sshObj.FirstPass)
   
   if (response.indexOf("(Y,n)") != -1 && this.sshObj.FirstPass != true){
         if(this.sshObj.debug){this.emit("msg", this.sshObj.server.host + ": First prompt using correct input: Sending 'y' to the `(y,n):` prompt")}
         this.sshObj.sessionText += response + this.sshObj.enter
         this._buffer = ""
         this.sshObj.FirstPass = true
         
         stream.write("y" + this.sshObj.enter)
         return
   }

   if(this.sshObj.debug){this.emit("msg", this.sshObj.server.host + "Final timeout: All attempts completed")}
   if(this.sshObj.debug){this.emit("msg", this.sshObj.server.host + ": Timeout details:" + this.sshObj.enter + "Command: " + command + " " + this.sshObj.enter + "Response: " + response)}
   
   //everything failed so update sessionText and raise an error event that closes the connection   
   if(!errorMessage){errorMessage = "Command"}
   if(!errorSource){errorSource = "Command Timeout"}   
   this.emit("msg", this.sshObj.server.host + ": " + errorMessage + " timed out after " + (this.idleTime / 1000) + " seconds", errorSource, true) 
   //this.emit("end", response, this.sshObj)
   this.sshObj.sessionText += response + this.sshObj.enter
   this.close()
  },
  
  onEnd: function( sessionText, sshObj ) {
    if(this.sshObj.debug){this.emit("msg", sshObj.server.host + ": host.onEnd")}
    //show the full session output. self could be emailed or saved to a log file.
    this.emit("msg", "\nThis is the full session response:\n\n" + this.sshObj.sessionText + "\n")
    //this.close()
  }
}
//host1.hosts=[host]
//until npm published use the cloned dir path.
var SSH2Shell = require ('../lib/ssh2shell')

//run the commands in the shell session
var SSH = new SSH2Shell(host)
  
SSH.connect()
