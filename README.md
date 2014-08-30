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
    privateKey: "[optional private key for user to match public key in authorized_keys file]"
  },
  Connection:         require ('SSH2'),
  commands:           [Array of command strings],
  msg:                {
    send: ( message ) {
      [message handler code]
    }
  }, 
  verbose:            true/false, [determines if all command output is processed by message handler as it runs]
  connectedMessage:   "[on Connected message]",
  readyMessage:       "[on Ready message]",
  endMessage:         "[on End message]",
  onCommandComplete:  ( sshShellInst ) {
    [callback function, optional code to run on the completion of a command before the next command is run]
  },
  onEnd:              ( sessionText ) {
    [callback function, optional code to run at the end of the session]
  }
}
```    

Usage:
-------
This example would add the public keys from a git user to the authorized keys of a server login to give that user ssh access. 
Authentication is using the password in this case but adding the private key for a matching public key in the autherized_keys file on the server you are connecting to would work.

This example shows:
* How to setup commands
* How to test the response of a command and add more commands if needed
* Use the two notification types in the commands array: "\`sessionText notification\`" and "msg notifications" that output using the msg.send function

```
sshObj = {
  server:             {     
    host:       "10.0.0.1",
    port:       "22",
    userName:   "myusername",
    password:   "somepassword",
    privateKey: ""
  },
  Connection:         require ('SSH'),
  commands:           [
    "`Giving a git user ssh access to server [this is text that will be shown in the final summary text]`",
    "cd ~/.ssh",
    "cp authorized_keys authorized_keys_bk",
    "if [ -f authorized_keys ]; then echo wget https://github.com/git-user.keys >> authorized_keys; else touch authorized_keys && echo wget https://github.com/git-user.keys' >> authorized_keys && chmod 600 authorized_keys;",
    "msg Added keys. [this is a message that will be outputted through the message.send function]",
    "sudo service ssh restart"
  ],
  msg: {
    send: ( message ) {
      console.log(message);
    }
  },
  verbose:            false,
  connectedMessage:   "Connected",
  readyMessage:       "Running commands Now",
  endMessage:         "Completed",
  onCommandComplete:  ( sshShellInst ) {
    if (sshShellInst.command == "sudo service ssh restart" && sshShellInst.response.indexOf "ssh start/running" != -1 && sshShellInst.triedRestart != true) {
      sshShellInst.msg.send("service restarted");
    } else {
      sshShellInst.commands.push("mv authorized_keys_bk authorized_keys");
      sshShellInst.commands.push("sudo service ssh restart");
      sshShellInst.triedRestart = true;
    }
  },
  onEnd:              ( sessionText ) {
    #show the full session output. This could be emailed or saved to a log file.
    sshShellInst.msg.send(sessionText);
  }
}
#until npm published use the cloned dir path.
SSHShell = require ('./ssh-shell/lib/SSH2Shell');

#there are two methods to run the shell. One as an instance of the object and the other as a static method

#Instance:
SSH = new SSHShell(sshObj);
SSH.connect();

#Static:
SSHShell.runShell(sshObj);

```
