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
  commands: [
    "ls -l",
    "`All done!`",
  ],
  msg: {
    send: function( message ) {
      console.log(message);
    }
  },
  debug:              true,
  connectedMessage:   "Connected",
  readyMessage:       "Running commands Now",
  closedMessage:      "Completed"
  };

//until npm published use the cloned dir path.
var SSH2Shell = require ('../lib/ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell(sshObj);

SSH.on ('end', function onEnd( sessionText, sshObj ) {
    //show the full session output. This could be emailed or saved to a log file.
    sshObj.msg.send("\nThis is the full session responses:\n" + sessionText);
  });

//debug: show content of sshObj
//console.log (sshObj);

SSH.connect();