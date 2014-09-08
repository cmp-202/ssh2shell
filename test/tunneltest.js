var msg = {
  send: function( message ) {
    console.log(message);
  }
}

//Third host
var server3 = {
  server:              {
    host:         process.env.SERVER3_HOST,
    port:         process.env.SERVER3_PORT,
    userName:     process.env.SERVER3_USER_NAME,
    password:     process.env.SERVER3_PASSWORD,
    passPhrase:   process.env.SERVER3_PASS_PHRASE,
    privateKey:   ''
  },
  hosts:               [],
  commands:            [
    "msg:connected to host: passed",
    "sudo su",
    "cd ~/",
    "ll"
  ],
  msg:                 msg,
  verbose:             true,
  connectedMessage:    "",
  readyMessage:        "",
  closedMessage:       "",
  onCommandProcessing: function( command, response, sshObj, stream ) {
    //nothing to do here
  },
  onCommandComplete:   function( command, response, sshObj ) {
    //we are listing the dir so output it to the msg handler
    if (command.indexOf("cd") != -1){  
      sshObj.msg.send("Just ran a cd command:");    
      sshObj.msg.send(response);
    }
  },
  onEnd:               function( sessionText, sshObj ) {
    //show the full session output. This could be emailed or saved to a log file.
    sshObj.msg.send("\nSession text for " + sshObj.server.host + ":\n" + sessionText);
  }
}

//secondary host
var server2 = {
  server:              {
    host:         process.env.SERVER2_HOST,
    port:         process.env.SERVER2_PORT,
    userName:     process.env.SERVER2_USER_NAME,
    password:     process.env.SERVER2_PASSWORD,
    passPhrase:   process.env.SERVER2_PASS_PHRASE,
    privateKey:   ''
  },
  hosts:               [],
  commands:            [
    "msg:connected to host: passed",
    "sudo su",
    "cd ~/",
    "ll"
  ],
  msg:                 msg,
  verbose:             true,
  connectedMessage:    "",
  readyMessage:        "",
  closedMessage:       "",
  onCommandProcessing: function( command, response, sshObj, stream ) {
    //nothing to do here
  },
  onCommandComplete:   function( command, response, sshObj ) {
    //we are listing the dir so output it to the msg handler
    if (command == "sudo su"){      
      sshObj.msg.send("Just ran a sudo su command");
    }
  },
  onEnd:               function( sessionText, sshObj ) {
    //show the full session output. This could be emailed or saved to a log file.
    sshObj.msg.send("\nSession text for " + sshObj.server.host + ":\n" + sessionText);
  }
}


//primary host
var server1 = {
  server:              {
    host:         process.env.SERVER1_HOST,
    port:         process.env.SERVER1_PORT,
    userName:     process.env.SERVER1_USER_NAME,
    password:     process.env.SERVER1_PASSWORD,
    passPhrase:   process.env.SERVER1_PASS_PHRASE,
    privateKey:   require('fs').readFileSync(process.env.SERVER1_PRIV_KEY_PATH)
  },
  hosts:               [ server2, server3 ],
  commands:            [
    "msg:connected to host: passed",
    "ll"
  ],
  msg:                 msg,
  verbose:             true,
  connectedMessage:    "Connected to Staging",
  readyMessage:        "Running commands Now",
  closedMessage:       "Completed",
  onCommandProcessing: function( command, response, sshObj, stream ) {
    //nothing to do here
  },
  onCommandComplete:   function( command, response, sshObj ) {
    //we are listing the dir so output it to the msg handler
    if (command == "ll"){      
      sshObj.msg.send(response);
    }
  },
  onEnd:               function( sessionText, sshObj ) {
    //show the full session output. This could be emailed or saved to a log file.
    sshObj.msg.send("\nSession text for " + sshObj.server.host + ":\n" + sessionText);
  }
}

//until npm published use the cloned dir path.
var SSH2Shell = require ('../lib/ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell(server1);
SSH.connect();
