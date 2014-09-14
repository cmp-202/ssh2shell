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
    "`Test session text message: passed`",
    "msg:console test notification: passed",
    "ls -la",
    "sudo su",
    "cd ~/",
    "ls -la",
    "echo $(pwd)",
    "ls -la"
  ],
  msg: {
    send: function( message ) {
      console.log(message);
    }
  },
  connectedMessage:   "Connected",
  readyMessage:       "Running commands Now",
  closedMessage:      "Completed"
};
//until npm published use the cloned dir path.
var SSH2Shell = require ('../lib/ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell(sshObj);
  
SSH.on ('commandComplete', function onCommandComplete( command, response, sshObj ) {
    //confirm it is the root home dir and change to root's .ssh folder
    if (command == "echo $(pwd)" && response.indexOf("/root") != -1 ) {
      sshObj.commands.unshift("msg:This shows that the command and response check worked and that another command was added before the next ls command.");
      sshObj.commands.unshift("cd .ssh");
    }
    //we are listing the dir so output it to the msg handler
    else if (command == "ls -la"){      
      sshObj.msg.send(response);
    }
  });

SSH.on ('end', function onEnd( sessionText, sshObj ) {
    //show the full session output. This could be emailed or saved to a log file.
    sshObj.msg.send("\nThis is the full session responses:\n" + sessionText);
  });

SSH.connect();
