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
  onCommandProcessing: function( command, response, sshObj, stream ) {
    //nothing to do here
  },
  onCommandComplete:  function( command, response, sshObj ) {
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
SSH.connect();
