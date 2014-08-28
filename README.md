ssh-shell
======================

[node.js](http://nodejs.org/) wrapper for [SSH2](https://github.com/mscdex/ssh2) 

`PLease note this code has not yet been tested!`

This is a class that wraps the node.js SSH2 shell command enabling the following actions:

* Sudo and sudo su password prompt detection and response.
* Run multiple commands one after the other, detecting the previous command completion before running the next command.
* Detection of the current command and conditions within the response text before the next command is run.
* Adding or removing command/s to be run based on the result of command/response tests.
* Messages to output at different stages of the process. (connected, ready, command complete, all complete, connection closed)
* Current command and response text available to callback on command completion.
* Total response text at the connection close available to callback.
* Message format for commands object to enable two types of non-command output like a bash echo to full response text or output method.
* Use of ssh keys

Requirements:
------------
* The nodejs [SSH2](https://github.com/mscdex/ssh2) package
* The following object to be passed to the class on creation or through static function:
```
sshObj =
  server:         
    host:       "[IP Address]"
    port:       "[external port number]"
    userName:   "[non root user name, may need membership to sudo group]"
    password:   "[user password for sudo]"
    privateKey: "[private key for user to match public key in authorized_keys file]"
  Connection:         [SSH2Shell]
  commands:           [Array of command strings]
  msg: 
    send: ( message ) ->
      [message handler code]
  verbose:            [true/false determins if all command output is processed by message handler as it runs]
  connectedMessage:   "[on Connected message]"
  readyMessage:       "[on Ready message]"
  endMessage:         "[on End message]"
  onCommandComplete:  ( sshShellInst ) ->
    [callback function, optional code to run on the completion of a command before th enext command is run]
  onEnd: ( sessionText ) ->
    [callback function, optional code to run at the end of the session]
```    

Example
-------
(Code is in coffee script and is not tested it is an example only) 
This example would add the public keys from a git user to the authorized keys of a server login to give that user ssh access. 

This example shows:
* How to setup commands
* How to test the response of a command and add more commands if needed
* Use the two notification types in the commands array: "\`sessionText notification\`" and "msg notifications" that output using the msg.send function

```
Connection = require "SSH"
SSHShell = require "./SSH2Shell"

sshObj =
  server:         
    host:       "10.0.0.1"
    port:       "22"
    userName:   "nonRootUser"
    password:   "somePassword"
    privateKey: "private key string here for nonRootUser"
  Connection:         Connection
  commands:           [
    "`Giving a git user ssh access to server [this is text that will be shown in the final summary text]`"
    "cd ~/.ssh"
    "cp authorized_keys authorized_keys_bk"
    "if [ -f authorized_keys ]; then echo wget https://github.com/git-user.keys >> authorized_keys; else touch authorized_keys && echo wget https://github.com/git-user.keys' >> authorized_keys && chmod 600 authorized_keys;"
    "msg Added keys. [this is a message that will be outputted through the message.send function]"
    "sudo service ssh restart"
  ]
  msg: 
    send: ( message ) ->
      console.log message
  verbose:            false
  connectedMessage:   "Connected"
  readyMessage:       "Running commands Now"
  endMessage:         "Completed"
  onCommandComplete:  ( sshShellInst ) ->
    if sshShellInst.command is "sudo service ssh restart" and sshShellInst.response.indexOf "ssh start/running" isnt -1 and sshShellInst.triedRestart isnt true
      sshShellInst.msg.send "service restarted"
    else
      sshShellInst.commands.push("mv authorized_keys_bk authorized_keys")
      sshShellInst.commands.push("sudo service ssh restart")
      sshShellInst.triedRestart = true
  onEnd:              ( sessionText ) ->
    #show the full session output. This could be emailed or saved to a log file.
    sshShellInst.msg.send sessionText
  
#there are two methods to run the shell. One as an instance of the object and the other as a static method
#Instance:
SSH = new SSHShell(sshObj)
SSH.connect

#Static:
SSHShell.runShell(sshObj)

```
