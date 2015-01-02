var dotenv = require('dotenv');
dotenv.load();

var sshObj = {
  server:             {     
    host:         process.env.HOST,
    port:         process.env.PORT,
    userName:     process.env.USER_NAME,
    password:     process.env.PASSWORD,
    passPhrase:   "",
    privateKey:   ""
  },
  commands:           [
    "msg:Showing current directory",
    "ls -la",
	"msg:Changing user via su [username]",
    "su secondaryUser",
    "ls -la",
	"exit",
	"msg:Changing user via sudo su [username]",
    "sudo su secondaryUser",
    "ls -la",
	"msg:Exiting from current user",
	"exit",
	"msg:Changing user via sudo -u [username] -i",
	"sudo -u secondaryUser -i",
    "ls -la"
  ],
  msg: {
    send: function( message ) {
      console.log(message);
    }
  },
  debug:			  true,
  suPassSent:		  false, //used by commandProcessing to only send password once
  connectedMessage:   "Connected",
  readyMessage:       "Running commands Now",
  closedMessage:      "Completed"
};
//until npm published use the cloned dir path.
var SSH2Shell = require ('../lib/ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell(sshObj);
//console.log (sshObj);

SSH.on ('commandProcessing', function onCommandProcessing( command, response, sshObj, stream ) {
    //confirm it is the root home dir and change to root's .ssh folder
    if (command == "su secondaryUser" && response.indexOf("Password: ") != -1 && sshObj.suPassSent == false) {
      sshObj.commands.unshift("msg:login using secondary user password");
	  //this is required to stop "bounce" without this the password would be sent multiple times
	  sshObj.suPassSent = true;
      stream.write("test\n");
    }
  });
  
SSH.on ('end', function onEnd( sessionText, sshObj ) {
    //show the full session output. This could be emailed or saved to a log file.
    sshObj.msg.send("\nThis is the full session responses:\n" + sessionText);
  });

SSH.connect();
