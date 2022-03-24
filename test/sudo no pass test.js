var dotenv = require('dotenv').config();

/*
* Used `sudo visudo` to add `[username] ALL=(ALL) NOPASSWD: ALL` on the first test
* server to test no password required detecting normal prompt correctly to run the 
* next command
*/
var sshObj = {
  server:             {     
    host:         process.env.SERVER2_HOST,
    port:         process.env.PORT,
    userName:     process.env.SERVER2_USER_NAME,
    password:     process.env.SERVER2_PASSWORD
  },
  commands:           ["sudo apt-get update","sudo apt-get upgrade", "sudo apt autoremove"],
  userPromptSent:     false,
  debug:              true,
  verbose:            false,
  onCommandProcessing: function( command, response, sshObj, stream ) {
   //Check the command and prompt exits and respond with a 'y' but only does it once
   if (response.indexOf("[Y/n]") != -1 && !sshObj.userPromptSent) {
     sshObj.userPromptSent = true
     stream.write("y")
   }
  },
  onCommandComplete:   function( command, response, sshObj ) {
      if(sshObj.userPromptSent){
      sshObj.userPromptSent = false;
      }
  }
}
//until npm published use the cloned dir path.
var SSH2Shell = require ('../lib/ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell(sshObj);
var callback = function(sessionText, sshObj) {
		console.log(`Session End: ` + sessionText);
	}
SSH.connect(callback);
