ssh2shell
======================

[node.js](http://nodejs.org/) wrapper for [ssh2](https://github.com/mscdex/ssh2) 

*This class enables the following functionality:*
* Sudo and sudo su password prompt detection and response using the users password.
* Run multiple commands sequentially within the context of the previous commands result.
* Ability to respond to prompts from a command.
* Ability to check the current command and conditions within the response text from it before the next command is run.
* Adding or removing command/s to be run based on the result of command/response tests.
* Progress messages: either static (on events) or dynamic in the callback functions.
* Full session response text available for processing in the onEnd callback function triggered when the connection is closed.
* Commands that are processed as notification messages to either the full session text or a message handler function and not processed in the shell.
* Create bash scripts on the fly, run them and then remove them.
* SSH tunneling to another server.

Code:
-----
The Class is written in coffee script and can be found here: `./src/ssh2shell.coffee`. It is much easier reading the coffee script code instead of coffee script output javascript file `./lib/ssh2shell.js`.
 
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
    host:         "[IP Address]",
    port:         "[external port number]",
    userName:     "[user name]",
    password:     "[user password. Even if key authentication is used this is required for sudo password prompt]",
    sudoPassword: "[used if the sudo password is different from the server password (used in tunneling) or ""]",
    passPhrase:   "[private key passphrase or empty string]",
    privateKey:   [require('fs').readFileSync('/path/to/private/key/id_rsa') or ""]
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
*This example shows:*
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
    sudoPassword: "",
    passPhrase: "myPassPhrase",
    privateKey: require('fs').readFileSync('../id_rsa')
  },
  commands:           [
    "`This is a message that will be added to the full sessionText`",
    "msg:This is a message that will be handled by the msg.send handler",
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

var SSH2Shell = require ('ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell(sshObj);
SSH.connect();

```
Authentication:
---------------
To use password authentication pass an empty string for the private key in the sshObj, otherwise pass a valid private key and passphrase if your private key requires one. 


**Trouble shooting:**

* If the passphrase is incorrect you will get an error saying it was unable able to process the public key from the private key or something similar. This confused me because it doesn't indicate the passphrase was the problem. Recheck your passphrase and try connecting manually to confirm it works.
* I did read of people having problems with the case of the passphrase or password is being used from an external file  and an \n being added causing it to fail. This produced the same result as the first issue. They had to trim the value when setting it.
* If your user password is incorrect the process will stall on sudo due to it presenting the password prompt a second time which the code doesn't currently handle (on my todo list). Using verbose set to true may show this is happening or it will show that no commands were run after a sudo or sudo su which should indicate it is the likely problem. 

Verbose:
--------
When verbose is set to true each command response is passed to the msg.send function. 
There are times when an unexpected prompt occurs leaving the session waiting for a response it will never get and so you will never see the final full session text. 
Rerunning the process with verbose set to true will show you where the process failed and enable you to add extra handling in the onCommandProcessing callback.

Responding to command prompts:
----------------------
When running commands there are cases that you might need to respond to specific prompt that results from the command being run.
The command response check method is the same as in the example for the onCommandComplete callback but in this case we use the onCommandProcessing callback and stream.write to send the response.
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

Bash scripts on the fly:
------------------------
If the commands you need to run would be better suited to a bash script as part of the process it is possible to generate or get the script on the fly. 
You can echo/printf the script content into a file as a command, ensure it is executible, run it and then delete it.
The other option is to curl or wget the script from a remote location and do the same but this has some risks associated with it. I like to know what is in the script I am running.

```
 commands: [ "some commands here",
  "if [ ! -f myscript.sh ]; then printf '#!/bin/bash\n
 #\n
 current=$(pwd);\n
 cd ..;\n
 if [ -f myfile ]; then
  sed \"/^[ \\t]*$/d\" ${current}/myfile | while read line; do\n
    printf \"Doing some stuff\";\n
    printf $line;\n
  done\n
 fi\n' > myscript.sh; 
fi",
"sudo chmod 700 myscript.sh",
"./myscript.sh",
"rm myscript.sh"
]
```

Tunneling through another server:
---------------------------------
One thing this functionality provides is another method to SSH tunnel through another server. 

*There are some conditions that need to be handled:* 

1. When you ssh to a new host through a primary host you are likely to encounter a prompt to add the key for the new host to continue which will stall the process. 
*Options:*
  * Tell ssh to not even ask in the first place by adding -oStrictHostKeyChecking=no to the shh command. (see: [auto accept host keys](http://xmodulo.com/2013/05/how-to-accept-ssh-host-keys-automatically-on-linux.html)).
  * Detect the ssh command and prompt then respond. See **Responding to command prompts** method outlined above.
2. If the primary host and secondary host user passwords are not the same then the sshObj.server.sudoPassword needs to be set. This enables the primary host to be authenticated using the sshObj.server.password but the secondary host to use a different password for sudo. In this case sudo commands can only be used on the secondary host because it will never use sshObj.server.password which is the password for the primary host.
3. Password authentication would work on the first server but won't be handled correctly on the second host automatically.
*Options:*
  * Using key authentication would resolve this by registering the primary server user public key in the autherized\_users file of the secondary host so no password is ever requested. Manually run `ssh-copy-id -i ~/.ssh/id_rsa.pub user@remote-host` and enter the password for the remote-host when prompted. [Keys tutorial](http://www.thegeekstuff.com/2008/11/3-steps-to-perform-ssh-login-without-password-using-ssh-keygen-ssh-copy-id/)
  * It would be possible to use the onCommandProcessing callback to detect the ssh command and password prompt then respond with the required password if key authentication is not an option. `if ( command.indexOf('ssh') != -1 && response.match(/[:]\s$/)) {stream.write(sshObj.server.password+'\n');}` or use the sudoPassword if the passwords differ `{stream.write(sshObj.server.sudoPassword+'\n');}`

**Note:** Remember to send an exit command as your last command to close the session correctly.

**Tunnelling Example:**

```
var sshObj = {
  server:             {     
    host:       "192.168.0.100",
    port:       "22",
    userName:   "firstuser",
    password:   "primaryPassword",
    sudoPassword: "secondaryPassword",
    passPhrase: "",
    privateKey: ""
  },
  commands:           [
    "echo $(pwd)",
    "msg:Connecting to second host",
    "ssh -oStrictHostKeyChecking=no seconduser@10.0.0.20",
    "`Connected to second host`",
    "echo $(pwd)",
    "sudo su",
    "cd ~/",
    "ll",
    "echo $(pwd)",
    "ll",
    "`Add an exit command to close the session on both hosts correctly`",
    "exit"
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
   //secondary host password authentication
   if ( command.indexOf('ssh') != -1 && response.match(/[:]\s$/)) {
    stream.write(sshObj.server.sudoPassword+'\n');
   }
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

var SSH2Shell = require ('ssh2shell');

//run the commands in the shell session
var SSH = new SSH2Shell(sshObj);
SSH.connect();

 
```

