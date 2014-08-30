ssh-shell
======================

[node.js](http://nodejs.org/) wrapper for [SSH2](https://github.com/mscdex/ssh2) 

`PLease note this code has not yet been tested!`

This is a class that wraps the node.js SSH2 shell command enabling the following actions:

* Sudo and sudo su password prompt detection and response.
* Run multiple commands sequentially.
* Ability to check the current command and conditions within the response text from it before the next command is run.
* Adding or removing command/s to be run based on the result of command/response tests.
* Identify progress by messages to outputted at different stages of the process. (connected, ready, command complete, all complete, connection closed)
* Current command and response text available to callback on command completion.
* Full session response text available to callback on connection close.
* A couple of message formats run from within the commands array that output to the message handle or to the session response text.
* Use of ssh key for authentication.

Version:
-------
v0.0.1

Installation:
------------
```
git clone https://github.com/cmp-202/ssh-shell.git
```

Requirements:
------------
* The nodejs [SSH2](https://github.com/mscdex/ssh2) package
* The following object to be passed to the class on creation or through static function:
```
sshObj = {
  server:             {       
    host:       "[IP Address]",
    port:       "[external port number]",
    userName:   "[user name]",
    password:   "[user password]",
    privateKey: [require('fs').readFileSync('/path/to/private/key/id_rsa') or ""],
    passPhrase: "[private key passphrase or empty string]"
  },
  Connection:         require ('ssh2'),
  commands:           ["Array", "of", "command", "strings", "or", "`Session Text notifications`", "or", "msg:output message handler notifications"],
  msg:                {
    send: function( message ) {
      [message handler code]
    }
  }, 
  verbose:            true/false, [determines if all command output is processed by message handler as it runs]
  connectedMessage:   "[on Connected message]",
  readyMessage:       "[on Ready message]",
  closedMessage:      "[on Close message]",
  onCommandComplete:  function( sshShellInst ) {
    [callback function, optional code to run on the completion of a command. sshShellInst is the instance object]
  },
  onEnd:              function( sshShellInst ) {
    [callback function, optional code to run at the end of the session. sshShellInst is the instance object]
  }
};
```    

Usage:
-------
This example shows:
* How to setup commands
* How to test the response of a command and add more commands and notifications in the onCommandComplete callback function
* Use the two notification types in the commands array: "\`full session text notification\`" and "msg:notification processed by the msg.send function". Neither of these command formats are run as commands in the shell.
* Connect using a key pair with pass phrase
* use sudo su with user password 

```

var sshObj = {
  server:             {     
    host:       "192.168.0.1",
    port:       "22",
    userName:   "myuser",
    password:   "mypassword",
    privateKey: require('fs').readFileSync('../id_rsa'),
    passPhrase: "myPassPhrase"
  },
  Connection:         require ('ssh2'),
  commands:           [
    "`Test session text message: passed`",
    "msg:console test notification: passed",
    "echo $(pwd)",
    "sudo su",
    "cd ~/",
    "ll",
    "echo $(pwd)",
    "ll"
  ],
  msg: {
    send: function( message ) {
      console.log(message);
    }
  },
  verbose:            false,
  connectedMessage:   "Connected",
  readyMessage:       "Running commands Now",
  closedMessage:      "Completed",
  onCommandComplete:  function( ssh2shellInst ) {
    //confirm it is the root home dir and change to roots .ssh folder
    if (ssh2shellInst.command == "echo $(pwd)" && ssh2shellInst.response.indexOf("/root") != -1 ) {
      ssh2shellInst.sshObj.commands.unshift("msg:This shows that the command and response check worked and that another command was added before the next ll command.");
      ssh2shellInst.sshObj.commands.unshift("cd .ssh");
    }
    //we are listing the dir so output it to the msg handler
    else if (ssh2shellInst.command == "ll"){      
      ssh2shellInst.sshObj.msg.send(ssh2shellInst.response);
    }
  },
  onEnd:              function( ssh2shellInst ) {
    //show the full session output. This could be emailed or saved to a log file.
    ssh2shellInst.sshObj.msg.send("\nThis is the full session responses:\n" + ssh2shellInst.sessionText);
  }
};

var SSHShell = require ('SSH2Shell');

//run the commands in the shell session
var SSH = new SSHShell(sshObj);
SSH.connect();

```

Verbose:
--------
when verbose is set to true each command response is passed to the msg.send function.
In the example above onEnd function could be left empty and verbose be set to true to see the result of each command in the console(any session text notifications would not be seen).