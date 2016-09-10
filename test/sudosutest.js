var dotenv = require('dotenv');
dotenv.load();
/*
* Used `sudo visudo` to add `[username] ALL=(ALL) NOPASSWD: ALL` on the first test
* server to test no password required detecting normal prompt correctly to run the 
* next command
*/
var sshObj = {
  server:             {     
    host:         process.env.HOST,
    port:         process.env.PORT,
    userName:     process.env.USER_NAME,
    password:     process.env.PASSWORD
  },
  commands:           [
    "msg:Showing current directory",
    //"echo \$(pwd)",
    "ls -al",
    "sudo ls -al",
    "msg:Changing to " + process.env.secondaryUser + " via su [username]",
    "su " + process.env.secondaryUser,
    "msg:Showing user home directory",
    "cd \~",
    //"echo \$(pwd)",
    "ls -al",
    "msg:exiting user ",
    "exit",
    //"echo \$(pwd)",
    "ls -al",
    "msg:Changing user via sudo -u [username] -i",
    "sudo -u " + process.env.secondaryUser + " -i",
    "msg:Showing user directory",
    "cd \~",
    //"echo \$(pwd)",
    "ls -la",
    "msg: exit user",
    "exit"
  ],
  msg: {
    send: function( message ) {
      console.log(message);
    }
  },
  debug:              true,
  verbose:            false,
  suPassSent:         false, //used by commandProcessing to only send password once
  onCommandProcessing: function( command, response, sshObj, stream ) {
    //console.log("command processing:\ncommand: " + command + ", response: " + response + ", password sent: " + sshObj.rootPassSent + ", password: " + process.env.rootPassword);

    if (command === "su " + process.env.secondaryUser && response.indexOf("Password: ") != -1 && sshObj.suPassSent != true) {
      sshObj.commands.unshift("msg:Using secondary user password");
      //this is required to stop "bounce" without this the password would be sent multiple times
      sshObj.suPassSent = true;
      stream.write(process.env.secondUserPassword + "\n");
    } else if (command == "su root" && response.match(/:\s$/i) && sshObj.rootPassSent != true) {
      sshObj.commands.unshift("msg:Using root user password");
      //this is required to stop "bounce" without this the password would be sent multiple times
      sshObj.rootPassSent = true;
      stream.write(process.env.rootPassword + "\n");
    }
  },
  onEnd: function ( sessionText, sshObj ) {
    if(this.sshObj.debug){this.emit("msg", sshObj.server.host + ": host.onEnd")};
    //show the full session output. This could be emailed or saved to a log file.
    this.emit("msg", "\nThis is the full session responses:\n" + sessionText);
  }
};
//until npm published use the cloned dir path.
var SSH2Shell = require ('../lib/ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell(sshObj);
  
SSH.connect();
