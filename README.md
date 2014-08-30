ssh2shell
======================

[node.js](http://nodejs.org/) wrapper for [SSH2](https://github.com/mscdex/ssh2) 


This is a class that wraps the node.js ssh2 package shell command enabling the following actions:

* Sudo and sudo su password prompt detection and response.
* Run multiple commands sequentially.
* Ability to check the current command and conditions within the response text from it before the next command is run.
* Adding or removing command/s to be run based on the result of command/response tests.
* Identify progress by messages to outputted at different stages of the process. (connected, ready, command complete, all complete, connection closed)
* Current command and response text available to callback on command completion.
* Full session response text available to callback on connection close.
* A couple of message formats run from within the commands array that output to the message handle or to the session response text.
* Use of ssh key for authentication.

Code:
-----
The Class is written in coffee script and can be found here: `./src/ssh2shell.coffee`. It is much easier reading the coffee script code than the `./lib/ssh2shell.js` file is just the coffee script output.
 
Installation:
------------
```
npm install ssh2shell
```

Requirements:
------------
The class expects an object with following structure to be passed to its constructor:
```
sshObj = {
  server:             {       
    host:       "[IP Address]",
    port:       "[external port number]",
    userName:   "[user name]",
    password:   "[user password. Even if key authentication is used this is required for sudo password prompt]",
    privateKey: [require('fs').readFileSync('/path/to/private/key/id_rsa') or ""],
    passPhrase: "[private key passphrase or empty string]"
  },
  commands:           ["Array", "of", "command", "strings", "or", "`Session Text notifications`", "or", "msg:output message handler notifications"],
  msg:                {
    send: function( message ) {
      [message handler code]
    }
  }, 
  verbose:            true/false, [if true all command output is processed by message handler as it runs]
  connectedMessage:   "[on Connected message]",
  readyMessage:       "[on Ready message]",
  closedMessage:      "[on Close message]",
  onCommandProcessing: function( command, response, sshObj, stream ) {
    [callback function, optional code to run during the procesing of a command]
  },
  onCommandComplete:   function( command, response, sshObj ) {
    [callback function, optional code to run on the completion of a command before the next command is run]
  },
  onEnd:               function( sessionText, sshObj ) {
    [callback function, optional code to run at the end of the session]
  }
};
```    

Usage:
-------
This example shows:
* Use sudo su with user password
* How to setup commands
* How to test the response of a command and add more commands and notifications in the onCommandComplete callback function
* Use the two notification types in the commands array: "\`full session text notification\`" and "msg:notification processed by the msg.send function". Neither of these command formats are run as commands in the shell.
* Connect using a key pair with pass phrase
 

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
  onCommandProcessing: function( command, response, sshObj, stream ) {
    //nothing to do here
  },
  onCommandComplete:  function( command, response, sshObj ) {
    //confirm it is the root home dir and change to root's .ssh folder
    if (command == "echo $(pwd)" && response.indexOf("/root") != -1 ) {
      sshObj.commands.unshift("msg:This shows that the command and response check worked and that another command was added before the next ll command.");
      sshObj.commands.unshift("cd .ssh");
    }
    //we are listing the dir so output it to the msg handler
    else if (command == "ll"){      
      sshObj.msg.send(response);
    }
  },
  onEnd:              function( sessionText, sshObj ) {
    //show the full session output. This could be emailed or saved to a log file.
    sshObj.msg.send("\nThis is the full session responses:\n" + sessionText);
  }
};

var SSHShell = require ('ssh2shell');

//run the commands in the shell session
var SSH = new SSHShell(sshObj);
SSH.connect();

```

Verbose:
--------
When verbose is set to true each command response is passed to the msg.send function. 
There are times when an unexpected prompt occurs leaving the session waiting for a response it will never get and so you will never see the final full session text. 
Rerunning the process with verbose set to true will show you where the process failed and enable you to add extra handling in the onCommandProcessing callback.

Responding to prompts:
----------------------
When running commands there are cases that you might need to respond to specific prompts that result from the command being run.
The command response check method is the same as in the example for the onCommandComplete callback but in this case we use the onCommandProcessing callback and the method to send the reply is different.
The stream object is available in the onCommandProcessing function to output the response to the prompt directly as follows:

```
  onCommandProcessing:  function( command, response, sshObj, stream ) {
    //Check the command and prompt exits and respond with a 'y'
    if (command == "apt-get install nano" && response.indexOf("[y/N]?") != -1 ) {
      sshObj.msg.send('Sending install nano response');
      stream.write('y\n');
    }
  }
```